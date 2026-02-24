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
    reportOut: path.resolve(repoRoot, 'data/memory/security-suite.report.json'),
    metricsOut: path.resolve(repoRoot, 'data/memory/phase-e-metrics.json'),
    windowDays: 7,
    strict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db' && argv[i + 1]) out.db = path.resolve(repoRoot, argv[++i]);
    if (arg === '--report-out' && argv[i + 1]) out.reportOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--metrics-out' && argv[i + 1]) out.metricsOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--window-days' && argv[i + 1]) out.windowDays = Number(argv[++i]);
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

function metadataCompliant(rawMetadata) {
  let metadata;
  try {
    metadata = JSON.parse(String(rawMetadata ?? '{}'));
  } catch {
    return false;
  }
  return (
    metadata?.audit_schema === 'generated_tool_audit.v1' &&
    typeof metadata?.decision_actor === 'string' && metadata.decision_actor.length > 0 &&
    typeof metadata?.decision_source === 'string' && metadata.decision_source.length > 0 &&
    typeof metadata?.runtime_profile === 'string' && metadata.runtime_profile.length > 0 &&
    metadata?.immutable === true
  );
}

function boolCheck(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

function runSuite(args) {
  if (!fs.existsSync(args.db)) {
    throw new Error(`DB not found: ${path.relative(repoRoot, args.db)}`);
  }

  const now = Date.now();
  const windowMs = Math.max(1, Number(args.windowDays) || 7) * 24 * 60 * 60 * 1000;
  const windowStart = now - windowMs;
  const probeReason = `security_probe_${now}`;
  const probeTool = `security_probe_tool_${now}`;

  const db = new Database(args.db);
  const checks = [];

  try {
    const tableExists = Number(
      db.prepare(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='generated_tool_audit'`
      ).get()?.c ?? 0
    ) > 0;
    checks.push(boolCheck('table_exists', tableExists, 'generated_tool_audit table presence'));

    const updateTriggerExists = Number(
      db.prepare(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='trigger' AND name='trg_generated_tool_audit_immutable_update'`
      ).get()?.c ?? 0
    ) > 0;
    checks.push(boolCheck('immutable_update_trigger', updateTriggerExists, 'immutable UPDATE trigger presence'));

    const deleteTriggerExists = Number(
      db.prepare(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='trigger' AND name='trg_generated_tool_audit_immutable_delete'`
      ).get()?.c ?? 0
    ) > 0;
    checks.push(boolCheck('immutable_delete_trigger', deleteTriggerExists, 'immutable DELETE trigger presence'));

    let probeInserted = false;
    let updateBlocked = false;
    let deleteBlocked = false;
    let probeStillExists = false;

    try {
      const metadata = JSON.stringify({
        audit_schema: 'generated_tool_audit.v1',
        decision_actor: 'security_suite',
        decision_source: 'mcp-security-suite.mjs',
        runtime_profile: process.env.MCP_ENV_PROFILE || 'unknown',
        immutable: true,
      });

      db.prepare(
        `INSERT INTO generated_tool_audit (tool_name, need, status, reason, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(probeTool, 'tool_generator_review', 'accepted', probeReason, metadata, now);
      probeInserted = true;
    } catch {
      probeInserted = false;
    }
    checks.push(boolCheck('probe_insert', probeInserted, 'insert immutable audit probe'));

    if (probeInserted) {
      try {
        db.prepare(`UPDATE generated_tool_audit SET reason=? WHERE reason=?`).run('mutated', probeReason);
        updateBlocked = false;
      } catch {
        updateBlocked = true;
      }

      try {
        db.prepare(`DELETE FROM generated_tool_audit WHERE reason=?`).run(probeReason);
        deleteBlocked = false;
      } catch {
        deleteBlocked = true;
      }

      const probeCount = Number(
        db.prepare(`SELECT COUNT(*) AS c FROM generated_tool_audit WHERE reason=?`).get(probeReason)?.c ?? 0
      );
      probeStillExists = probeCount > 0;
    }

    checks.push(boolCheck('probe_update_blocked', updateBlocked, 'UPDATE blocked by immutability trigger'));
    checks.push(boolCheck('probe_delete_blocked', deleteBlocked, 'DELETE blocked by immutability trigger'));
    checks.push(boolCheck('probe_row_preserved', probeStillExists, 'probe row remains after blocked update/delete'));

    const recentAudits = db.prepare(
      `SELECT tool_name, status, reason, metadata, created_at
       FROM generated_tool_audit
       WHERE created_at >= ?
         AND status IN ('accepted', 'rejected', 'promoted')
       ORDER BY created_at DESC
       LIMIT 500`
    ).all(windowStart);

    const compliantCount = recentAudits.filter((row) => metadataCompliant(row.metadata)).length;
    const provenanceComplianceRate = recentAudits.length > 0
      ? clamp01(compliantCount / recentAudits.length)
      : 1;
    const provenanceAllCompliant = provenanceComplianceRate >= 1;
    checks.push(
      boolCheck(
        'provenance_metadata_compliant',
        provenanceAllCompliant,
        `compliant=${compliantCount}/${recentAudits.length}`
      )
    );

    const passed = checks.filter((entry) => entry.ok).length;
    const securitySuitePassRate = checks.length > 0 ? clamp01(passed / checks.length) : 0;
    const requiredAuditImmutable =
      updateTriggerExists && deleteTriggerExists && updateBlocked && deleteBlocked && probeStillExists;

    return {
      generated_at: new Date().toISOString(),
      db: path.relative(repoRoot, args.db),
      window_days: Math.max(1, Number(args.windowDays) || 7),
      checks,
      summary: {
        checks_total: checks.length,
        checks_passed: passed,
        security_suite_pass_rate: securitySuitePassRate,
        required_audit_immutable: requiredAuditImmutable,
        provenance_compliance_rate: provenanceComplianceRate,
        recent_audit_rows: recentAudits.length,
      },
      phase_metrics: {
        window_days: Math.max(1, Number(args.windowDays) || 7),
        phase: {
          security_suite_pass_rate: securitySuitePassRate,
          required_audit_immutable: requiredAuditImmutable,
        },
        global: {
          max_error_rate: 0,
          max_rollback_count: 0,
        },
      },
    };
  } finally {
    db.close();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runSuite(args);

  ensureParent(args.reportOut);
  ensureParent(args.metricsOut);

  fs.writeFileSync(args.reportOut, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(args.metricsOut, `${JSON.stringify(result.phase_metrics, null, 2)}\n`, 'utf8');

  const s = result.summary;
  console.log(`mcp-security-suite db=${result.db}`);
  console.log(`mcp-security-suite report=${path.relative(repoRoot, args.reportOut)}`);
  console.log(`mcp-security-suite metrics=${path.relative(repoRoot, args.metricsOut)}`);
  console.log(
    `mcp-security-suite summary checks=${s.checks_passed}/${s.checks_total} security_pass_rate=${(s.security_suite_pass_rate * 100).toFixed(2)}% required_audit_immutable=${s.required_audit_immutable} provenance=${(s.provenance_compliance_rate * 100).toFixed(2)}% rows=${s.recent_audit_rows}`
  );

  if (args.strict && (s.security_suite_pass_rate < 1 || !s.required_audit_immutable)) {
    console.error('mcp-security-suite: FAIL strict checks not met.');
    process.exit(2);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp-security-suite: FAIL ${message}`);
  process.exit(1);
}
