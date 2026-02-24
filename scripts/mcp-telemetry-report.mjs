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
    db: path.resolve(repoRoot, 'data/memory/eidolon_learning.db'),
    maxErrorRate: 0.2,
    maxP95Ms: 2200,
    minCalls: 20,
    limit: 30,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db' && argv[i + 1]) out.db = path.resolve(repoRoot, argv[++i]);
    if (arg === '--max-error-rate' && argv[i + 1]) out.maxErrorRate = Number(argv[++i]);
    if (arg === '--max-p95-ms' && argv[i + 1]) out.maxP95Ms = Number(argv[++i]);
    if (arg === '--min-calls' && argv[i + 1]) out.minCalls = Number(argv[++i]);
    if (arg === '--limit' && argv[i + 1]) out.limit = Number(argv[++i]);
  }
  return out;
}

function clampPositiveInt(v, fallback) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function pct(v) {
  return `${(v * 100).toFixed(2)}%`;
}

function querySqliteJson(dbPath, sql) {
  const output = execFileSync('sqlite3', ['-cmd', '.timeout 5000', '-json', dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!output.trim()) {
    return [];
  }
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

const args = parseArgs(process.argv.slice(2));
const limit = clampPositiveInt(args.limit, 30);
const minCalls = clampPositiveInt(args.minCalls, 20);

if (!fs.existsSync(args.db)) {
  console.error(`telemetry-report: DB not found at ${path.relative(repoRoot, args.db)}`);
  process.exit(1);
}

const rows = tableExists(args.db, 'tool_performance')
  ? querySqliteJson(
      args.db,
      `
      SELECT
        tool_name,
        call_count,
        success_rate,
        ${selectExpr(args.db, 'tool_performance', 'avg_latency_ms')},
        ${selectExpr(args.db, 'tool_performance', 'latency_p95_ms', 'avg_latency_ms')},
        ${selectExpr(args.db, 'tool_performance', 'fallback_rate', '0.0')},
        last_called
      FROM tool_performance
      WHERE tool_name LIKE 'eidolon_%'
      ORDER BY last_called DESC
      LIMIT ${limit};
      `
    )
  : [];

const audits = tableExists(args.db, 'generated_tool_audit')
  ? querySqliteJson(
      args.db,
      `
      SELECT status, COUNT(*) AS count
      FROM generated_tool_audit
      GROUP BY status;
      `
    )
  : [];

let shadowSummary = null;
if (tableExists(args.db, 'recommender_shadow_audit')) {
  const overlapExpr = tableHasColumn(args.db, 'recommender_shadow_audit', 'top3_overlap_ratio')
    ? 'top3_overlap_ratio'
    : '0.0';
  const shadowRows = querySqliteJson(
    args.db,
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN top1_agreement = 1 THEN 1 ELSE 0 END) AS agreements,
      AVG(${overlapExpr}) AS avg_top3_overlap
    FROM recommender_shadow_audit;
    `
  );
  shadowSummary = shadowRows[0] || null;
}

function printAuditSummaries() {
  if (audits.length > 0) {
    const summary = audits.map((entry) => `${entry.status}:${entry.count}`).join(' ');
    console.log(`generated_tool_audit: ${summary}`);
  }

  if (shadowSummary && Number(shadowSummary.total ?? 0) > 0) {
    const total = Number(shadowSummary.total ?? 0);
    const agreements = Number(shadowSummary.agreements ?? 0);
    const top1AgreementRate = agreements / Math.max(total, 1);
    const top1DisagreementRate = 1 - top1AgreementRate;
    const avgTop3Overlap = Number(shadowSummary.avg_top3_overlap ?? 0);
    console.log(
      `recommender_shadow_audit: total=${total} top1_agree=${pct(top1AgreementRate)} top1_disagree=${pct(top1DisagreementRate)} avg_top3_overlap=${pct(avgTop3Overlap)}`
    );
  }
}

if (rows.length === 0) {
  console.log(`telemetry-report db=${path.relative(repoRoot, args.db)}`);
  console.log('telemetry-report: no cognitive tool data yet.');
  printAuditSummaries();
  process.exit(0);
}

console.log(`telemetry-report db=${path.relative(repoRoot, args.db)}`);
console.log(`thresholds: max_error_rate=${args.maxErrorRate} max_p95_ms=${args.maxP95Ms} min_calls=${minCalls}`);

let breaches = 0;
for (const row of rows) {
  const calls = Number(row.call_count ?? 0);
  const successRate = Number(row.success_rate ?? 0);
  const errorRate = 1 - successRate;
  const p95 = Number(row.latency_p95_ms ?? row.avg_latency_ms ?? 0);
  const fallbackRate = Number(row.fallback_rate ?? 0);

  const gated = calls >= minCalls;
  const breached = gated && (errorRate > args.maxErrorRate || p95 > args.maxP95Ms);
  if (breached) breaches++;

  const marker = breached ? 'BREACH' : 'OK';
  console.log(
    `- [${marker}] ${row.tool_name} calls=${calls} error=${pct(errorRate)} p95=${Math.round(p95)}ms fallback=${pct(fallbackRate)}`
  );
}

printAuditSummaries();

if (breaches > 0) {
  console.error(`telemetry-report: ${breaches} tool(s) breached thresholds.`);
  process.exit(2);
}

console.log('telemetry-report: PASS');
