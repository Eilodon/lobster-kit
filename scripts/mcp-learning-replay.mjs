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
    windowDays: 14,
    reportOut: path.resolve(repoRoot, 'data/memory/learning-replay.report.json'),
    policyOut: path.resolve(repoRoot, 'data/memory/learning-replay.policy.json'),
    minAuditRows: 10,
    strict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db' && argv[i + 1]) out.db = path.resolve(repoRoot, argv[++i]);
    if (arg === '--window-days' && argv[i + 1]) out.windowDays = Number(argv[++i]);
    if (arg === '--report-out' && argv[i + 1]) out.reportOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--policy-out' && argv[i + 1]) out.policyOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--min-audit-rows' && argv[i + 1]) out.minAuditRows = Number(argv[++i]);
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

function safeJsonParse(raw, fallback = {}) {
  try {
    return JSON.parse(String(raw ?? '{}'));
  } catch {
    return fallback;
  }
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

function tableHasColumn(dbPath, tableName, columnName) {
  const rows = querySqliteJson(dbPath, `PRAGMA table_info(${tableName});`);
  return rows.some((row) => String(row?.name || '') === columnName);
}

function selectExpr(dbPath, tableName, columnName, fallbackExpr = '0', alias = columnName) {
  return tableHasColumn(dbPath, tableName, columnName)
    ? columnName
    : `${fallbackExpr} AS ${alias}`;
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.db)) {
    throw new Error(`DB not found: ${path.relative(repoRoot, args.db)}`);
  }

  const windowDays = Math.max(1, Math.floor(Number(args.windowDays) || 14));
  const minAuditRows = Math.max(1, Math.floor(Number(args.minAuditRows) || 10));
  const now = Date.now();
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000;

  const generatedAuditRows = querySqliteJson(
    args.db,
    `
    SELECT tool_name, need, status, reason, metadata, created_at
    FROM generated_tool_audit
    WHERE created_at >= ${windowStart}
    ORDER BY created_at DESC
    LIMIT 2000;
    `
  );

  const shadowRows = querySqliteJson(
    args.db,
    `
    SELECT primary_top_tool, primary_top_score, shadow_top_tool, shadow_top_score, top1_agreement, metadata, created_at
    FROM recommender_shadow_audit
    WHERE created_at >= ${windowStart}
    ORDER BY created_at DESC
    LIMIT 4000;
    `
  );

  const p99Expr = selectExpr(args.db, 'tool_performance', 'latency_p99_ms', 'latency_p95_ms');
  const sampleCountExpr = selectExpr(
    args.db,
    'tool_performance',
    'latency_sample_count',
    'call_count',
    'latency_sample_count'
  );
  const perfRows = querySqliteJson(
    args.db,
    `
    SELECT
      tool_name,
      call_count,
      success_rate,
      fallback_rate,
      latency_p95_ms,
      ${p99Expr},
      latency_p50_ms,
      ${sampleCountExpr},
      user_satisfaction
    FROM tool_performance
    ORDER BY last_called DESC
    LIMIT 1000;
    `
  );

  const statusCounts = Object.fromEntries(
    Array.from(countBy(generatedAuditRows, (row) => String(row.status || 'unknown')).entries()).sort()
  );
  const byTool = new Map();
  for (const row of generatedAuditRows) {
    const tool = String(row.tool_name || 'unknown_tool');
    if (!byTool.has(tool)) {
      byTool.set(tool, { accepted: 0, rejected: 0, promoted: 0, quarantined: 0, total: 0 });
    }
    const slot = byTool.get(tool);
    const status = String(row.status || '').toLowerCase();
    slot.total += 1;
    if (status === 'accepted') slot.accepted += 1;
    if (status === 'rejected') slot.rejected += 1;
    if (status === 'promoted') slot.promoted += 1;
    if (status === 'quarantined') slot.quarantined += 1;
  }

  const disagreementByTool = new Map();
  for (const row of shadowRows) {
    const tool = String(row.primary_top_tool || '');
    if (!tool) continue;
    if (!disagreementByTool.has(tool)) {
      disagreementByTool.set(tool, { n: 0, disagree: 0, regret: 0, samplePct: 0 });
    }
    const slot = disagreementByTool.get(tool);
    slot.n += 1;
    if (!Boolean(row.top1_agreement)) slot.disagree += 1;
    const regret = Math.max(0, Number(row.shadow_top_score || 0) - Number(row.primary_top_score || 0));
    slot.regret += regret;
    const meta = safeJsonParse(row.metadata, {});
    slot.samplePct += Number(meta.shadow_sample_percent || 0);
  }

  const qualityByTool = new Map();
  for (const row of perfRows) {
    const tool = String(row.tool_name || '');
    if (!tool) continue;
    const calls = Math.max(0, Number(row.call_count || 0));
    const success = clamp01(Number(row.success_rate || 0));
    const errorRate = clamp01(1 - success);
    const fallbackRate = clamp01(Number(row.fallback_rate || 0));
    const p95 = Math.max(0, Number(row.latency_p95_ms || 0));
    const p99 = Math.max(0, Number(row.latency_p99_ms || 0));
    const p50 = Math.max(0, Number(row.latency_p50_ms || 0));
    const sampleCount = Math.max(0, Number(row.latency_sample_count || 0));
    const satisfaction = clamp01(Number(row.user_satisfaction || 0.5));
    qualityByTool.set(tool, {
      calls,
      errorRate,
      fallbackRate,
      p95,
      p99,
      p50,
      sampleCount,
      satisfaction,
    });
  }

  const toolPolicy = [];
  for (const [tool, gov] of byTool.entries()) {
    const disagreement = disagreementByTool.get(tool) || { n: 0, disagree: 0, regret: 0, samplePct: 0 };
    const quality = qualityByTool.get(tool) || {
      calls: 0,
      errorRate: 0,
      fallbackRate: 0,
      p95: 0,
      p99: 0,
      p50: 0,
      sampleCount: 0,
      satisfaction: 0.5,
    };
    const disagreeRate = disagreement.n > 0 ? clamp01(disagreement.disagree / disagreement.n) : 0;
    const avgRegret = disagreement.n > 0 ? clamp01(disagreement.regret / disagreement.n) : 0;
    const acceptance = gov.total > 0 ? clamp01((gov.accepted + gov.promoted) / gov.total) : 0;
    const rejection = gov.total > 0 ? clamp01((gov.rejected + gov.quarantined) / gov.total) : 0;

    const penalty = clamp01(
      avgRegret * 0.45 +
        disagreeRate * 0.25 +
        quality.errorRate * 0.2 +
        quality.fallbackRate * 0.1
    );
    const boost = clamp01(
      acceptance * 0.4 +
        (1 - quality.errorRate) * 0.25 +
        (1 - quality.fallbackRate) * 0.2 +
        quality.satisfaction * 0.15
    );
    const quarantineSuggested = rejection >= 0.6 || penalty >= 0.65;

    toolPolicy.push({
      tool,
      governance: gov,
      disagreement_rate: disagreeRate,
      avg_regret: avgRegret,
      quality,
      recommended_penalty: penalty,
      recommended_boost: boost,
      quarantine_suggested: quarantineSuggested,
    });
  }

  toolPolicy.sort((a, b) => b.recommended_penalty - a.recommended_penalty);

  const policy = {
    generated_at: new Date().toISOString(),
    db: path.relative(repoRoot, args.db),
    window_days: windowDays,
    replay_source: {
      generated_tool_audit_rows: generatedAuditRows.length,
      recommender_shadow_rows: shadowRows.length,
      performance_rows: perfRows.length,
    },
    recommender_overrides: toolPolicy.map((row) => ({
      tool: row.tool,
      penalty: Number(row.recommended_penalty.toFixed(4)),
      boost: Number(row.recommended_boost.toFixed(4)),
      reasons: [
        `disagreement_rate=${row.disagreement_rate.toFixed(4)}`,
        `avg_regret=${row.avg_regret.toFixed(4)}`,
        `error_rate=${row.quality.errorRate.toFixed(4)}`,
        `fallback_rate=${row.quality.fallbackRate.toFixed(4)}`,
      ],
    })),
    governance_policy: {
      quarantine_candidates: toolPolicy
        .filter((row) => row.quarantine_suggested)
        .map((row) => row.tool),
      status_counts: statusCounts,
    },
    route_policy_training: {
      method: 'runtime_route_feedback_memory + offline_audit_replay',
      notes: 'Use recommender_overrides as priors for next online scoring window.',
    },
  };

  const report = {
    generated_at: new Date().toISOString(),
    db: path.relative(repoRoot, args.db),
    window_days: windowDays,
    summary: {
      generated_tool_audit_rows: generatedAuditRows.length,
      recommender_shadow_rows: shadowRows.length,
      distinct_tools_with_policy: toolPolicy.length,
      quarantine_candidates: policy.governance_policy.quarantine_candidates.length,
      status_counts: statusCounts,
    },
    top_penalty_tools: toolPolicy.slice(0, 12),
    policy_out: path.relative(repoRoot, args.policyOut),
  };

  ensureParent(args.reportOut);
  ensureParent(args.policyOut);
  fs.writeFileSync(args.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(args.policyOut, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');

  console.log(`mcp-learning-replay db=${path.relative(repoRoot, args.db)}`);
  console.log(`mcp-learning-replay report=${path.relative(repoRoot, args.reportOut)}`);
  console.log(`mcp-learning-replay policy=${path.relative(repoRoot, args.policyOut)}`);
  console.log(
    `mcp-learning-replay summary audit_rows=${generatedAuditRows.length} shadow_rows=${shadowRows.length} policy_tools=${toolPolicy.length} quarantine_candidates=${policy.governance_policy.quarantine_candidates.length}`
  );

  if (args.strict) {
    const strictFail =
      generatedAuditRows.length < minAuditRows ||
      shadowRows.length === 0 ||
      toolPolicy.length === 0;
    if (strictFail) {
      console.error(
        `mcp-learning-replay: FAIL strict checks not met (min_audit_rows=${minAuditRows}).`
      );
      process.exit(2);
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp-learning-replay: FAIL ${message}`);
  process.exit(1);
}
