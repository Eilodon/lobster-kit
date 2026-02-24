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
    reportOut: path.resolve(repoRoot, 'data/memory/autopilot-drift.report.json'),
    metricsOut: path.resolve(repoRoot, 'data/memory/phase-p2-autopilot-metrics.json'),
    maxErrorRate: 0.22,
    maxFallbackRate: 0.35,
    maxP95Ms: 2200,
    maxP99P50Ratio: 3.0,
    minSampleCount: 30,
    adaptiveWarmup: true,
    warmupMaxCalls: 30,
    strict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db' && argv[i + 1]) out.db = path.resolve(repoRoot, argv[++i]);
    if (arg === '--report-out' && argv[i + 1]) out.reportOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--metrics-out' && argv[i + 1]) out.metricsOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--max-error-rate' && argv[i + 1]) out.maxErrorRate = Number(argv[++i]);
    if (arg === '--max-fallback-rate' && argv[i + 1]) out.maxFallbackRate = Number(argv[++i]);
    if (arg === '--max-p95-ms' && argv[i + 1]) out.maxP95Ms = Number(argv[++i]);
    if (arg === '--max-p99-p50-ratio' && argv[i + 1]) out.maxP99P50Ratio = Number(argv[++i]);
    if (arg === '--min-sample-count' && argv[i + 1]) out.minSampleCount = Number(argv[++i]);
    if (arg === '--warmup-max-calls' && argv[i + 1]) out.warmupMaxCalls = Number(argv[++i]);
    if (arg === '--no-adaptive-warmup') out.adaptiveWarmup = false;
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

function parseRows(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB not found: ${path.relative(repoRoot, dbPath)}`);
  }
  const p99Expr = selectExpr(dbPath, 'tool_performance', 'latency_p99_ms', 'latency_p95_ms');
  const sampleCountExpr = selectExpr(
    dbPath,
    'tool_performance',
    'latency_sample_count',
    'call_count',
    'latency_sample_count'
  );
  return querySqliteJson(
    dbPath,
    `
    SELECT
      tool_name,
      call_count,
      success_rate,
      fallback_rate,
      latency_p50_ms,
      latency_p95_ms,
      ${p99Expr},
      ${sampleCountExpr},
      last_called
    FROM tool_performance
    ORDER BY last_called DESC
    LIMIT 500;
    `
  );
}

function isSyntheticRowTool(toolName) {
  const name = String(toolName || '');
  if (!name) return true;
  if (name.startsWith('tools/call.')) return true;
  if (name.includes('/')) return true;
  return false;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = parseRows(args.db);

  const thresholds = {
    max_error_rate: clamp01(Number(args.maxErrorRate)),
    max_fallback_rate: clamp01(Number(args.maxFallbackRate)),
    max_p95_ms: Math.max(1, Number(args.maxP95Ms) || 2200),
    max_p99_p50_ratio: Math.max(1, Number(args.maxP99P50Ratio) || 3.0),
    min_sample_count: Math.max(1, Math.floor(Number(args.minSampleCount) || 30)),
    adaptive_warmup: Boolean(args.adaptiveWarmup),
    warmup_max_calls: Math.max(1, Math.floor(Number(args.warmupMaxCalls) || Number(args.minSampleCount) || 30)),
  };

  const evaluated = [];
  let warmupExemptCount = 0;
  let warmupRiskCount = 0;
  let skippedSyntheticRows = 0;
  let weightedErrors = 0;
  let totalCalls = 0;
  for (const row of rows) {
    const tool = String(row.tool_name || '');
    if (!tool) continue;
    if (isSyntheticRowTool(tool)) {
      skippedSyntheticRows += 1;
      continue;
    }
    const calls = Math.max(0, Number(row.call_count || 0));
    const successRate = clamp01(Number(row.success_rate || 0));
    const errorRate = clamp01(1 - successRate);
    const fallbackRate = clamp01(Number(row.fallback_rate || 0));
    const p50 = Math.max(0, Number(row.latency_p50_ms || 0));
    const p95 = Math.max(0, Number(row.latency_p95_ms || 0));
    const p99 = Math.max(0, Number(row.latency_p99_ms || 0));
    const sampleCount = Math.max(0, Number(row.latency_sample_count || 0));
    const p99P50Ratio = p50 > 0 ? p99 / Math.max(1e-6, p50) : p99;

    const failures = [];
    const warmupNotes = [];
    const warmupActive =
      thresholds.adaptive_warmup &&
      calls < thresholds.warmup_max_calls;
    const sampleTooLow = sampleCount < thresholds.min_sample_count;
    const warmupExempt = sampleTooLow && warmupActive;
    if (sampleTooLow && !warmupExempt) {
      failures.push(`sample_count_below_min:${sampleCount}<${thresholds.min_sample_count}`);
    } else if (sampleTooLow && warmupExempt) {
      warmupNotes.push(`sample_count_below_min:${sampleCount}<${thresholds.min_sample_count}`);
    }
    if (errorRate > thresholds.max_error_rate && !warmupActive) {
      failures.push(`error_rate_exceeds:${errorRate.toFixed(4)}>${thresholds.max_error_rate.toFixed(4)}`);
    } else if (errorRate > thresholds.max_error_rate && warmupActive) {
      warmupNotes.push(
        `error_rate_exceeds:${errorRate.toFixed(4)}>${thresholds.max_error_rate.toFixed(4)}`
      );
    }
    if (fallbackRate > thresholds.max_fallback_rate && !warmupActive) {
      failures.push(
        `fallback_rate_exceeds:${fallbackRate.toFixed(4)}>${thresholds.max_fallback_rate.toFixed(4)}`
      );
    } else if (fallbackRate > thresholds.max_fallback_rate && warmupActive) {
      warmupNotes.push(
        `fallback_rate_exceeds:${fallbackRate.toFixed(4)}>${thresholds.max_fallback_rate.toFixed(4)}`
      );
    }
    if (p95 > thresholds.max_p95_ms && !warmupActive) {
      failures.push(`p95_exceeds:${p95.toFixed(2)}>${thresholds.max_p95_ms.toFixed(2)}`);
    } else if (p95 > thresholds.max_p95_ms && warmupActive) {
      warmupNotes.push(`p95_exceeds:${p95.toFixed(2)}>${thresholds.max_p95_ms.toFixed(2)}`);
    }
    if (p99P50Ratio > thresholds.max_p99_p50_ratio && !warmupActive) {
      failures.push(
        `p99_p50_ratio_exceeds:${p99P50Ratio.toFixed(3)}>${thresholds.max_p99_p50_ratio.toFixed(3)}`
      );
    } else if (p99P50Ratio > thresholds.max_p99_p50_ratio && warmupActive) {
      warmupNotes.push(
        `p99_p50_ratio_exceeds:${p99P50Ratio.toFixed(3)}>${thresholds.max_p99_p50_ratio.toFixed(3)}`
      );
    }

    const severe =
      errorRate > thresholds.max_error_rate * 1.25 ||
      fallbackRate > thresholds.max_fallback_rate * 1.25 ||
      p95 > thresholds.max_p95_ms * 1.25;

    evaluated.push({
      tool,
      calls,
      error_rate: errorRate,
      fallback_rate: fallbackRate,
      latency_p50_ms: p50,
      latency_p95_ms: p95,
      latency_p99_ms: p99,
      latency_sample_count: sampleCount,
      p99_p50_ratio: p99P50Ratio,
      autopilot_pass: failures.length === 0,
      warmup_exempt: warmupExempt,
      warmup_active: warmupActive,
      warmup_risk: warmupActive && warmupNotes.length > 0,
      warmup_notes: warmupNotes,
      severe,
      failures,
    });
    if (warmupExempt) {
      warmupExemptCount += 1;
    }
    if (warmupActive && warmupNotes.length > 0) {
      warmupRiskCount += 1;
    }

    weightedErrors += calls * errorRate;
    totalCalls += calls;
  }

  const quarantines = evaluated.filter((row) => !row.autopilot_pass);
  const severeDriftTools = quarantines.filter((row) => row.severe).map((row) => row.tool);
  const canaryRollbackRequired = severeDriftTools.length > 0;

  const hooks = [];
  if (canaryRollbackRequired) {
    hooks.push({
      action: 'rollback_canary',
      reason: 'severe_drift_detected',
      tools: severeDriftTools,
      progression: 'freeze',
      target_percent: 0,
    });
  } else if (quarantines.length > 0) {
    hooks.push({
      action: 'freeze_canary',
      reason: 'drift_detected',
      tools: quarantines.map((row) => row.tool),
      progression: 'freeze',
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    db: path.relative(repoRoot, args.db),
    thresholds,
    summary: {
      tools_evaluated: evaluated.length,
      skipped_synthetic_rows: skippedSyntheticRows,
      warmup_exempt_tool_count: warmupExemptCount,
      warmup_risk_tool_count: warmupRiskCount,
      quarantine_required: quarantines.length > 0,
      quarantine_tool_count: quarantines.length,
      canary_rollback_required: canaryRollbackRequired,
      weighted_error_rate: totalCalls > 0 ? clamp01(weightedErrors / totalCalls) : 0,
    },
    quarantine_candidates: quarantines,
    canary_hooks: hooks,
  };

  const metrics = {
    window_days: 1,
    phase: {
      autopilot_quarantine_required: quarantines.length > 0 ? 1 : 0,
      autopilot_drift_tool_count: quarantines.length,
      autopilot_warmup_exempt_tool_count: warmupExemptCount,
      autopilot_warmup_risk_tool_count: warmupRiskCount,
      autopilot_canary_rollback_required: canaryRollbackRequired ? 1 : 0,
    },
    global: {
      max_error_rate: report.summary.weighted_error_rate,
      max_rollback_count: canaryRollbackRequired ? 1 : 0,
    },
  };

  ensureParent(args.reportOut);
  ensureParent(args.metricsOut);
  fs.writeFileSync(args.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(args.metricsOut, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');

  console.log(`mcp-autopilot-drift db=${path.relative(repoRoot, args.db)}`);
  console.log(`mcp-autopilot-drift report=${path.relative(repoRoot, args.reportOut)}`);
  console.log(`mcp-autopilot-drift metrics=${path.relative(repoRoot, args.metricsOut)}`);
  console.log(
    `mcp-autopilot-drift summary evaluated=${evaluated.length} quarantines=${quarantines.length} canary_rollback=${canaryRollbackRequired}`
  );

  if (args.strict && (quarantines.length > 0 || canaryRollbackRequired)) {
    console.error('mcp-autopilot-drift: FAIL strict checks not met.');
    process.exit(2);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp-autopilot-drift: FAIL ${message}`);
  process.exit(1);
}
