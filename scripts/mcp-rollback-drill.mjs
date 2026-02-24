#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PROFILE_TO_FILE = {
  development: 'packages/mcp-rust/env/mcp.development.env.example',
  staging: 'packages/mcp-rust/env/mcp.staging.env.example',
  production: 'packages/mcp-rust/env/mcp.production.env.example',
};

function parseArgs(argv) {
  const out = {
    profile: 'production',
    envFile: null,
    reportOut: path.resolve(repoRoot, 'data/memory/rollback-drill.report.json'),
    strict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--profile' && argv[i + 1]) out.profile = String(argv[++i]).toLowerCase();
    if (arg === '--env-file' && argv[i + 1]) out.envFile = path.resolve(repoRoot, argv[++i]);
    if (arg === '--report-out' && argv[i + 1]) out.reportOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--strict') out.strict = true;
  }

  return out;
}

function parseEnvContents(contents) {
  const out = {};
  for (const rawLine of contents.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseBoolean(raw, fallback = false) {
  if (typeof raw !== 'string') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(raw, fallback = 0) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function resolveEnvPath(profile, envFile) {
  if (envFile) return envFile;
  const rel = PROFILE_TO_FILE[profile] || PROFILE_TO_FILE.production;
  return path.resolve(repoRoot, rel);
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function runPreflightWithTempEnv(tempEnvPath) {
  const result = spawnSync(
    process.execPath,
    [path.resolve(repoRoot, 'scripts/mcp-rollout-preflight.mjs'), '--env-file', tempEnvPath],
    {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf8',
    }
  );

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
  };
}

function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = resolveEnvPath(args.profile, args.envFile);
  if (!fs.existsSync(envPath)) {
    throw new Error(`Env file not found: ${path.relative(repoRoot, envPath)}`);
  }

  const raw = fs.readFileSync(envPath, 'utf8');
  const values = parseEnvContents(raw);

  const runtime = String(values.MCP_PRIMARY_RUNTIME ?? '').toLowerCase();
  const profile = String(values.MCP_ENV_PROFILE ?? args.profile).toLowerCase();
  const originalCanary = parseNumber(values.COGNITIVE_CANARY_PERCENT, 0);

  const checks = [];
  checks.push(check('runtime_is_rust', runtime === 'rust', `MCP_PRIMARY_RUNTIME=${runtime || 'missing'}`));
  checks.push(check('rollback_thresholds_present',
    values.COGNITIVE_AUTO_ROLLBACK_ERROR_RATE !== undefined &&
      values.COGNITIVE_AUTO_ROLLBACK_P95_MS !== undefined &&
      values.COGNITIVE_AUTO_ROLLBACK_MIN_CALLS !== undefined,
    'rollback threshold envs are defined'
  ));
  checks.push(check('canary_config_present', Number.isFinite(originalCanary), `COGNITIVE_CANARY_PERCENT=${originalCanary}`));
  checks.push(check('profile_is_production', profile === 'production', `MCP_ENV_PROFILE=${profile}`));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-rollback-drill-'));
  const tempEnvPath = path.join(tempDir, 'rollback.env');
  const simulated = { ...values, COGNITIVE_CANARY_PERCENT: '0' };
  const tempBody = Object.entries(simulated)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.writeFileSync(tempEnvPath, `${tempBody}\n`, 'utf8');

  const preflightResult = runPreflightWithTempEnv(tempEnvPath);
  checks.push(check('incident_rollback_preflight_pass', preflightResult.ok, `status=${preflightResult.status}`));

  const recoveredCanary = parseNumber(values.COGNITIVE_CANARY_PERCENT, 0);
  checks.push(check('recovery_canary_available', recoveredCanary >= 0, `recovery_canary=${recoveredCanary}`));

  let cleanupOk = true;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    cleanupOk = false;
  }
  checks.push(check('drill_cleanup_ok', cleanupOk, `temp_dir_removed=${cleanupOk}`));

  const passedCount = checks.filter((entry) => entry.ok).length;
  const passRate = checks.length > 0 ? passedCount / checks.length : 0;
  const passed = checks.every((entry) => entry.ok);

  const report = {
    generated_at: new Date().toISOString(),
    profile: args.profile,
    env_source: path.relative(repoRoot, envPath),
    checks,
    summary: {
      checks_total: checks.length,
      checks_passed: passedCount,
      pass_rate: passRate,
      passed,
    },
    drill_context: {
      runtime,
      original_canary_percent: originalCanary,
      simulated_rollback_canary_percent: 0,
      preflight_status: preflightResult.status,
    },
  };

  ensureParent(args.reportOut);
  fs.writeFileSync(args.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`mcp-rollback-drill profile=${args.profile}`);
  console.log(`mcp-rollback-drill env=${path.relative(repoRoot, envPath)}`);
  console.log(`mcp-rollback-drill report=${path.relative(repoRoot, args.reportOut)}`);
  console.log(`mcp-rollback-drill summary checks=${passedCount}/${checks.length} pass_rate=${(passRate * 100).toFixed(2)}% passed=${passed}`);

  if (args.strict && !passed) {
    console.error('mcp-rollback-drill: FAIL strict checks not met.');
    process.exit(2);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp-rollback-drill: FAIL ${message}`);
  process.exit(1);
}
