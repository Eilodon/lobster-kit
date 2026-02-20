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

const args = parseArgs(process.argv.slice(2));
const limit = clampPositiveInt(args.limit, 30);
const minCalls = clampPositiveInt(args.minCalls, 20);

if (!fs.existsSync(args.db)) {
  console.error(`telemetry-report: DB not found at ${path.relative(repoRoot, args.db)}`);
  process.exit(1);
}

const db = new Database(args.db, { readonly: true });

const rows = db.prepare(`
  SELECT
    tool_name,
    call_count,
    success_rate,
    avg_latency_ms,
    latency_p95_ms,
    fallback_rate,
    last_called
  FROM tool_performance
  WHERE tool_name LIKE 'clawkit_%'
  ORDER BY last_called DESC
  LIMIT ?
`).all(limit);

const audits = db.prepare(`
  SELECT
    status,
    COUNT(*) AS count
  FROM generated_tool_audit
  GROUP BY status
`).all();

db.close();

if (rows.length === 0) {
  console.log('telemetry-report: no cognitive tool data yet.');
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

if (audits.length > 0) {
  const summary = audits.map((entry) => `${entry.status}:${entry.count}`).join(' ');
  console.log(`generated_tool_audit: ${summary}`);
}

if (breaches > 0) {
  console.error(`telemetry-report: ${breaches} tool(s) breached thresholds.`);
  process.exit(2);
}

console.log('telemetry-report: PASS');
