#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    phase: 'A',
    metrics: null,
    slo: path.resolve(repoRoot, 'docs/runtime-migration/slo/phase-gates.v1.json'),
    telemetryDb: null,
    telemetryMaxErrorRate: 0.2,
    telemetryMaxP95Ms: 2200,
    telemetryMinCalls: 30,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--phase' && argv[i + 1]) out.phase = String(argv[++i]).toUpperCase();
    if (arg === '--metrics' && argv[i + 1]) out.metrics = path.resolve(repoRoot, argv[++i]);
    if (arg === '--slo' && argv[i + 1]) out.slo = path.resolve(repoRoot, argv[++i]);
    if (arg === '--telemetry-db' && argv[i + 1]) out.telemetryDb = path.resolve(repoRoot, argv[++i]);
    if (arg === '--telemetry-max-error-rate' && argv[i + 1]) out.telemetryMaxErrorRate = Number(argv[++i]);
    if (arg === '--telemetry-max-p95-ms' && argv[i + 1]) out.telemetryMaxP95Ms = Number(argv[++i]);
    if (arg === '--telemetry-min-calls' && argv[i + 1]) out.telemetryMinCalls = Number(argv[++i]);
  }
  return out;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${path.relative(repoRoot, filePath)}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function querySqliteJson(dbPath, sql) {
  const output = execFileSync('sqlite3', ['-cmd', '.timeout 5000', '-json', dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!output.trim()) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [];
}

function tableExists(dbPath, tableName) {
  const rows = querySqliteJson(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`
  );
  return rows.length > 0;
}

function tableHasColumn(dbPath, tableName, columnName) {
  if (!tableExists(dbPath, tableName)) return false;
  const rows = querySqliteJson(dbPath, `PRAGMA table_info(${tableName});`);
  return rows.some((row) => String(row?.name || '') === columnName);
}

function selectExpr(dbPath, tableName, columnName, fallbackExpr = '0', alias = columnName) {
  return tableHasColumn(dbPath, tableName, columnName)
    ? columnName
    : `${fallbackExpr} AS ${alias}`;
}

function evaluateTelemetryBreaches(args) {
  if (!args.telemetryDb) return null;
  if (!fs.existsSync(args.telemetryDb)) {
    throw new Error(`Telemetry DB not found: ${path.relative(repoRoot, args.telemetryDb)}`);
  }
  if (!tableExists(args.telemetryDb, 'tool_performance')) {
    return {
      considered: 0,
      breaches: [],
      thresholds: {
        maxErrorRate: Number(args.telemetryMaxErrorRate),
        maxP95Ms: Number(args.telemetryMaxP95Ms),
        minCalls: Math.max(1, Math.floor(Number(args.telemetryMinCalls) || 30)),
      },
    };
  }

  const p95Expr = selectExpr(args.telemetryDb, 'tool_performance', 'latency_p95_ms', 'avg_latency_ms');
  const rows = querySqliteJson(
    args.telemetryDb,
    `
    SELECT
      tool_name,
      call_count,
      success_rate,
      ${p95Expr}
    FROM tool_performance
    WHERE tool_name LIKE 'clawkit_%';
    `
  );

  const minCalls = Math.max(1, Math.floor(Number(args.telemetryMinCalls) || 30));
  const maxErrorRate = Number(args.telemetryMaxErrorRate);
  const maxP95Ms = Number(args.telemetryMaxP95Ms);
  const breaches = [];
  let considered = 0;

  for (const row of rows) {
    const calls = Number(row.call_count ?? 0);
    if (calls < minCalls) continue;
    considered++;

    const successRate = Number(row.success_rate ?? 0);
    const errorRate = 1 - successRate;
    const p95 = Number(row.latency_p95_ms ?? 0);
    if (errorRate > maxErrorRate || p95 > maxP95Ms) {
      breaches.push({
        tool: row.tool_name,
        calls,
        errorRate,
        p95,
      });
    }
  }

  return {
    considered,
    breaches,
    thresholds: { maxErrorRate, maxP95Ms, minCalls },
  };
}

function evaluateGate(expected, observed, key) {
  if (key.startsWith('max_')) {
    if (typeof observed !== 'number') return { ok: false, msg: `${key} missing/invalid` };
    return { ok: observed <= expected, msg: `${key}: observed=${observed} expected<=${expected}` };
  }

  if (key.startsWith('min_')) {
    if (typeof observed !== 'number') return { ok: false, msg: `${key} missing/invalid` };
    return { ok: observed >= expected, msg: `${key}: observed=${observed} expected>=${expected}` };
  }

  if (key.startsWith('required_')) {
    return {
      ok: observed === expected,
      msg: `${key}: observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}`,
    };
  }

  if (typeof expected === 'number') {
    if (typeof observed !== 'number') return { ok: false, msg: `${key} missing/invalid` };
    return { ok: observed === expected, msg: `${key}: observed=${observed} expected=${expected}` };
  }

  return {
    ok: observed === expected,
    msg: `${key}: observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}`,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.metrics) {
    console.error(
      'Usage: node scripts/runtime-phase-gate.mjs --phase <A|B|C|D|E|F> --metrics <file.json> [--slo <file.json>] [--telemetry-db <db.sqlite>] [--telemetry-max-error-rate <n>] [--telemetry-max-p95-ms <n>] [--telemetry-min-calls <n>]'
    );
    process.exit(1);
  }

  const slo = readJson(args.slo);
  const metrics = readJson(args.metrics);

  const phase = args.phase;
  const expected = slo?.phase_gates?.[phase];
  if (!expected || typeof expected !== 'object') {
    console.error(`Unknown phase "${phase}" in SLO file.`);
    process.exit(1);
  }

  const observed = metrics?.phase && typeof metrics.phase === 'object' ? metrics.phase : {};
  const globalObserved = metrics?.global && typeof metrics.global === 'object' ? metrics.global : {};

  const errors = [];
  const warnings = [];

  const stableDays = Number(metrics?.window_days ?? 0);
  const requiredWindow = Number(slo?.stable_window_days ?? 7);
  if (!Number.isFinite(stableDays) || stableDays < requiredWindow) {
    errors.push(`window_days: observed=${stableDays} expected>=${requiredWindow}`);
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    const observedValue = observed[key];
    const check = evaluateGate(expectedValue, observedValue, key);
    if (!check.ok) errors.push(check.msg);
  }

  const globalSpec = slo?.global && typeof slo.global === 'object' ? slo.global : {};
  for (const [key, expectedValue] of Object.entries(globalSpec)) {
    const observedValue = globalObserved[key];
    const check = evaluateGate(expectedValue, observedValue, key);
    if (!check.ok) warnings.push(`global:${check.msg}`);
  }

  const requireTelemetryGate = phase !== 'A';
  if (requireTelemetryGate && !args.telemetryDb) {
    errors.push('telemetry-db is required for phase B-F promotion checks.');
  }

  const telemetry = evaluateTelemetryBreaches(args);
  if (telemetry) {
    if (telemetry.considered === 0) {
      warnings.push(`telemetry:no tools reached min_calls=${telemetry.thresholds.minCalls}`);
    }
    if (telemetry.breaches.length > 0) {
      for (const breach of telemetry.breaches) {
        errors.push(
          `telemetry:tool=${breach.tool} calls=${breach.calls} error_rate=${breach.errorRate.toFixed(4)} p95=${Math.round(breach.p95)}ms`
        );
      }
    }
  }

  console.log(`runtime-phase-gate phase=${phase}`);
  console.log(`metrics_source=${path.relative(repoRoot, args.metrics)}`);
  console.log(`slo_source=${path.relative(repoRoot, args.slo)}`);
  if (telemetry) {
    const telemetryPath = path.relative(repoRoot, args.telemetryDb);
    const t = telemetry.thresholds;
    console.log(
      `telemetry_source=${telemetryPath} thresholds=max_error_rate:${t.maxErrorRate} max_p95_ms:${t.maxP95Ms} min_calls:${t.minCalls} considered=${telemetry.considered} breaches=${telemetry.breaches.length}`
    );
  }

  if (warnings.length > 0) {
    console.log('warnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (errors.length > 0) {
    console.error('errors:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(2);
  }

  console.log('runtime-phase-gate: PASS');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runtime-phase-gate: FAIL ${message}`);
  process.exit(1);
}
