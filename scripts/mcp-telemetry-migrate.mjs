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
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db' && argv[i + 1]) out.db = path.resolve(repoRoot, argv[++i]);
    if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
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

function runSql(dbPath, sql) {
  execFileSync('sqlite3', ['-cmd', '.timeout 5000', dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.db)) {
    throw new Error(`DB not found: ${path.relative(repoRoot, args.db)}`);
  }
  if (!tableExists(args.db, 'tool_performance')) {
    throw new Error('Missing table: tool_performance');
  }

  const additions = [
    ['avg_latency_us', 'REAL NOT NULL DEFAULT 0'],
    ['latency_p90_ms', 'REAL NOT NULL DEFAULT 0'],
    ['latency_p99_ms', 'REAL NOT NULL DEFAULT 0'],
    ['latency_sample_count', 'INTEGER NOT NULL DEFAULT 0'],
  ];

  const applied = [];
  for (const [name, spec] of additions) {
    if (tableHasColumn(args.db, 'tool_performance', name)) continue;
    const sql = `ALTER TABLE tool_performance ADD COLUMN ${name} ${spec};`;
    if (!args.dryRun) runSql(args.db, sql);
    applied.push(name);
  }

  const updateBatch = `
    BEGIN;
    UPDATE tool_performance SET avg_latency_us = CASE WHEN avg_latency_us <= 0 THEN avg_latency_ms * 1000.0 ELSE avg_latency_us END;
    UPDATE tool_performance SET latency_p90_ms = CASE WHEN latency_p90_ms <= 0 THEN latency_p95_ms ELSE latency_p90_ms END;
    UPDATE tool_performance SET latency_p99_ms = CASE WHEN latency_p99_ms <= 0 THEN latency_p95_ms ELSE latency_p99_ms END;
    UPDATE tool_performance SET latency_sample_count = CASE WHEN latency_sample_count <= 0 THEN call_count ELSE latency_sample_count END;
    COMMIT;
  `;
  if (!args.dryRun) {
    runSql(args.db, updateBatch);
  }

  const stats = querySqliteJson(
    args.db,
    `
    SELECT
      COUNT(*) AS rows_total,
      SUM(CASE WHEN latency_p99_ms > 0 THEN 1 ELSE 0 END) AS rows_with_p99,
      SUM(CASE WHEN latency_sample_count > 0 THEN 1 ELSE 0 END) AS rows_with_sample_count,
      SUM(CASE WHEN avg_latency_us > 0 THEN 1 ELSE 0 END) AS rows_with_latency_us
    FROM tool_performance;
    `
  )[0] || {};

  console.log(`mcp-telemetry-migrate db=${path.relative(repoRoot, args.db)}`);
  console.log(`mcp-telemetry-migrate dry_run=${args.dryRun}`);
  console.log(
    `mcp-telemetry-migrate columns_added=${applied.length > 0 ? applied.join(',') : 'none'}`
  );
  console.log(
    `mcp-telemetry-migrate rows_total=${Number(stats.rows_total || 0)} rows_with_p99=${Number(stats.rows_with_p99 || 0)} rows_with_sample_count=${Number(stats.rows_with_sample_count || 0)} rows_with_latency_us=${Number(stats.rows_with_latency_us || 0)}`
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp-telemetry-migrate: FAIL ${message}`);
  process.exit(1);
}
