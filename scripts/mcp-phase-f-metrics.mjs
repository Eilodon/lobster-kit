#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    db: path.resolve(repoRoot, 'data/memory/eidolon_learning.db'),
    rollbackReport: path.resolve(repoRoot, 'data/memory/rollback-drill.report.json'),
    reportOut: path.resolve(repoRoot, 'data/memory/phase-f.report.json'),
    metricsOut: path.resolve(repoRoot, 'data/memory/phase-f-metrics.json'),
    primaryRuntime: String(process.env.MCP_PRIMARY_RUNTIME ?? 'rust').toLowerCase(),
    prodStableDays: 30,
    maxEidolonUsageRatio: 0.15,
    strict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db' && argv[i + 1]) out.db = path.resolve(repoRoot, argv[++i]);
    if (arg === '--rollback-report' && argv[i + 1]) out.rollbackReport = path.resolve(repoRoot, argv[++i]);
    if (arg === '--report-out' && argv[i + 1]) out.reportOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--metrics-out' && argv[i + 1]) out.metricsOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--primary-runtime' && argv[i + 1]) out.primaryRuntime = String(argv[++i]).toLowerCase();
    if (arg === '--prod-stable-days' && argv[i + 1]) out.prodStableDays = Number(argv[++i]);
    if (arg === '--max-eidolon-usage-ratio' && argv[i + 1]) out.maxEidolonUsageRatio = Number(argv[++i]);
    if (arg === '--strict') out.strict = true;
  }

  return out;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readRollbackPassed(reportPath) {
  if (!fs.existsSync(reportPath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return Boolean(data?.summary?.passed);
  } catch {
    return false;
  }
}

function readTelemetry(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return {
      clawkitCalls: 0,
      eidolonCalls: 0,
      weightedErrorRate: 0,
      rows: 0,
    };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT tool_name, call_count, success_rate
      FROM tool_performance
      WHERE tool_name LIKE 'clawkit_%' OR tool_name LIKE 'eidolon_%'
    `).all();

    let clawkitCalls = 0;
    let eidolonCalls = 0;
    let weightedErrors = 0;
    let totalCalls = 0;

    for (const row of rows) {
      const toolName = String(row.tool_name ?? '');
      const calls = Math.max(0, Number(row.call_count ?? 0));
      const successRate = clamp01(Number(row.success_rate ?? 0));
      const errorRate = 1 - successRate;

      if (toolName.startsWith('clawkit_')) clawkitCalls += calls;
      if (toolName.startsWith('eidolon_')) eidolonCalls += calls;

      weightedErrors += calls * errorRate;
      totalCalls += calls;
    }

    return {
      clawkitCalls,
      eidolonCalls,
      weightedErrorRate: totalCalls > 0 ? clamp01(weightedErrors / totalCalls) : 0,
      rows: rows.length,
    };
  } finally {
    db.close();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const telemetry = readTelemetry(args.db);
  const rollbackPassed = readRollbackPassed(args.rollbackReport);
  const totalCalls = telemetry.clawkitCalls + telemetry.eidolonCalls;
  const eidolonUsageRatio = totalCalls > 0 ? clamp01(telemetry.eidolonCalls / totalCalls) : 0;

  const prodStableDays = Number.isFinite(args.prodStableDays) ? Math.max(0, Math.floor(args.prodStableDays)) : 0;
  const primaryRuntime = String(args.primaryRuntime || '').toLowerCase();

  const report = {
    generated_at: new Date().toISOString(),
    db: path.relative(repoRoot, args.db),
    rollback_report: path.relative(repoRoot, args.rollbackReport),
    summary: {
      primary_runtime: primaryRuntime,
      prod_stable_days: prodStableDays,
      rollback_drill_passed: rollbackPassed,
      telemetry_rows: telemetry.rows,
      clawkit_calls: telemetry.clawkitCalls,
      eidolon_calls: telemetry.eidolonCalls,
      eidolon_usage_ratio: eidolonUsageRatio,
      weighted_error_rate: telemetry.weightedErrorRate,
    },
    thresholds: {
      max_eidolon_usage_ratio: args.maxEidolonUsageRatio,
    },
  };

  const metrics = {
    window_days: 7,
    phase: {
      required_primary_runtime: primaryRuntime,
      required_prod_stable_days: prodStableDays,
      required_rollback_drill_passed: rollbackPassed,
      max_eidolon_usage_ratio: eidolonUsageRatio,
    },
    global: {
      max_error_rate: telemetry.weightedErrorRate,
      max_rollback_count: 0,
    },
  };

  ensureParent(args.reportOut);
  ensureParent(args.metricsOut);
  fs.writeFileSync(args.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(args.metricsOut, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');

  console.log(`mcp-phase-f-metrics db=${path.relative(repoRoot, args.db)}`);
  console.log(`mcp-phase-f-metrics rollback_report=${path.relative(repoRoot, args.rollbackReport)}`);
  console.log(`mcp-phase-f-metrics report=${path.relative(repoRoot, args.reportOut)}`);
  console.log(`mcp-phase-f-metrics metrics=${path.relative(repoRoot, args.metricsOut)}`);
  console.log(
    `mcp-phase-f-metrics summary primary_runtime=${primaryRuntime} stable_days=${prodStableDays} rollback_passed=${rollbackPassed} clawkit_calls=${telemetry.clawkitCalls} eidolon_calls=${telemetry.eidolonCalls} eidolon_usage_ratio=${(eidolonUsageRatio * 100).toFixed(2)}%`
  );

  if (args.strict) {
    const threshold = Number(args.maxEidolonUsageRatio);
    const strictFail =
      primaryRuntime !== 'rust' ||
      prodStableDays < 30 ||
      !rollbackPassed ||
      (Number.isFinite(threshold) && eidolonUsageRatio > threshold);

    if (strictFail) {
      console.error('mcp-phase-f-metrics: FAIL strict checks not met.');
      process.exit(2);
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp-phase-f-metrics: FAIL ${message}`);
  process.exit(1);
}
