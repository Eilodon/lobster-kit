#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PROFILE_TO_FILE = {
  development: 'packages/mcp/env/mcp.development.env.example',
  staging: 'packages/mcp/env/mcp.staging.env.example',
  production: 'packages/mcp/env/mcp.production.env.example',
};

function parseArgs(argv) {
  const out = {
    profile: 'development',
    envFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--profile' && argv[i + 1]) {
      out.profile = argv[++i];
      continue;
    }
    if (arg === '--env-file' && argv[i + 1]) {
      out.envFile = argv[++i];
      continue;
    }
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

function parseBoolean(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function loadEnvProfile(profile, envFile) {
  const profileFile = PROFILE_TO_FILE[profile];
  const target = envFile
    ? path.resolve(repoRoot, envFile)
    : profileFile
      ? path.resolve(repoRoot, profileFile)
      : null;

  const fileEnv = {};
  if (target && fs.existsSync(target)) {
    const contents = fs.readFileSync(target, 'utf8');
    Object.assign(fileEnv, parseEnvContents(contents));
  }

  return {
    target,
    values: {
      ...fileEnv,
      ...process.env,
    },
  };
}

function getConfig(values) {
  return {
    cognitiveToolsEnabled: parseBoolean(values.COGNITIVE_TOOLS_ENABLED, true),
    reasonChainEnabled: parseBoolean(values.REASON_CHAIN_ENABLED, true),
    contextCompressionEnabled: parseBoolean(values.CONTEXT_COMPRESSION_ENABLED, true),
    orchestratorEnabled: parseBoolean(values.ORCHESTRATOR_ENABLED, false),
    toolGenExperimentalEnabled: parseBoolean(values.TOOL_GEN_EXPERIMENTAL_ENABLED, false),
    toolGenOracleExecution: parseBoolean(values.TOOL_GEN_ORACLE_EXECUTION, false),
    generatedToolMax: Math.floor(parseNumber(values.TOOL_GEN_MAX_DYNAMIC_TOOLS, 32)),
    canaryPercent: parseNumber(values.COGNITIVE_CANARY_PERCENT, 100),
    shadowModeEnabled: parseBoolean(values.COGNITIVE_SHADOW_MODE_ENABLED, false),
    shadowSamplePercent: parseNumber(values.COGNITIVE_SHADOW_SAMPLE_PERCENT, 100),
    rollbackErrorRate: parseNumber(values.COGNITIVE_AUTO_ROLLBACK_ERROR_RATE, 0.35),
    rollbackP95Ms: parseNumber(values.COGNITIVE_AUTO_ROLLBACK_P95_MS, 3000),
    rollbackMinCalls: Math.floor(parseNumber(values.COGNITIVE_AUTO_ROLLBACK_MIN_CALLS, 20)),
  };
}

function validate(profile, cfg) {
  const errors = [];
  const warnings = [];

  if (cfg.canaryPercent < 0 || cfg.canaryPercent > 100) {
    errors.push('COGNITIVE_CANARY_PERCENT must be within [0, 100].');
  }
  if (cfg.shadowSamplePercent < 0 || cfg.shadowSamplePercent > 100) {
    errors.push('COGNITIVE_SHADOW_SAMPLE_PERCENT must be within [0, 100].');
  }
  if (cfg.rollbackErrorRate <= 0 || cfg.rollbackErrorRate >= 1) {
    errors.push('COGNITIVE_AUTO_ROLLBACK_ERROR_RATE must be within (0, 1).');
  }
  if (cfg.rollbackP95Ms < 200) {
    errors.push('COGNITIVE_AUTO_ROLLBACK_P95_MS must be >= 200ms.');
  }
  if (cfg.rollbackMinCalls < 5) {
    errors.push('COGNITIVE_AUTO_ROLLBACK_MIN_CALLS must be >= 5.');
  }
  if (cfg.generatedToolMax < 1 || cfg.generatedToolMax > 128) {
    errors.push('TOOL_GEN_MAX_DYNAMIC_TOOLS must be within [1, 128].');
  }

  if (!cfg.cognitiveToolsEnabled && (cfg.reasonChainEnabled || cfg.contextCompressionEnabled || cfg.orchestratorEnabled)) {
    warnings.push('Cognitive sub-flags are enabled while COGNITIVE_TOOLS_ENABLED=false.');
  }
  if (cfg.rollbackErrorRate > 0.4) {
    warnings.push('Rollback error threshold is high; failures may persist longer before rollback.');
  }
  if (cfg.rollbackP95Ms > 8000) {
    warnings.push('Rollback p95 threshold is high; latency incidents may be detected late.');
  }
  if (profile === 'staging' && cfg.canaryPercent > 25) {
    warnings.push('Staging canary is above 25%; recommended <= 25% for first rollout.');
  }
  if (profile === 'production' && cfg.canaryPercent > 10) {
    warnings.push('Production canary is above 10%; consider gradual increase only after stable telemetry.');
  }
  if (profile !== 'development' && !cfg.shadowModeEnabled) {
    errors.push('COGNITIVE_SHADOW_MODE_ENABLED must be true outside development.');
  }
  if (cfg.shadowModeEnabled && cfg.shadowSamplePercent < 50 && profile !== 'development') {
    warnings.push('Shadow sample below 50% may hide regressions during rollout.');
  }
  if (profile !== 'development' && cfg.toolGenExperimentalEnabled) {
    errors.push('TOOL_GEN_EXPERIMENTAL_ENABLED must be false outside development.');
  }
  if (profile !== 'development' && cfg.toolGenOracleExecution) {
    errors.push('TOOL_GEN_ORACLE_EXECUTION must be false outside development.');
  }
  if (profile === 'production' && cfg.orchestratorEnabled) {
    warnings.push('ORCHESTRATOR_ENABLED=true in production is risky; keep disabled by default.');
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    warnings.push(`Node ${process.versions.node} detected. Recommended runtime is Node >= 20.`);
  }

  return { errors, warnings };
}

function printSummary(profile, source, cfg, warnings, errors) {
  console.log(`mcp-rollout-preflight profile=${profile}`);
  console.log(`env_source=${source ? path.relative(repoRoot, source) : 'process.env'}`);
  console.log('config:');
  console.log(`- COGNITIVE_TOOLS_ENABLED=${cfg.cognitiveToolsEnabled}`);
  console.log(`- REASON_CHAIN_ENABLED=${cfg.reasonChainEnabled}`);
  console.log(`- CONTEXT_COMPRESSION_ENABLED=${cfg.contextCompressionEnabled}`);
  console.log(`- ORCHESTRATOR_ENABLED=${cfg.orchestratorEnabled}`);
  console.log(`- TOOL_GEN_EXPERIMENTAL_ENABLED=${cfg.toolGenExperimentalEnabled}`);
  console.log(`- TOOL_GEN_ORACLE_EXECUTION=${cfg.toolGenOracleExecution}`);
  console.log(`- TOOL_GEN_MAX_DYNAMIC_TOOLS=${cfg.generatedToolMax}`);
  console.log(`- COGNITIVE_CANARY_PERCENT=${cfg.canaryPercent}`);
  console.log(`- COGNITIVE_SHADOW_MODE_ENABLED=${cfg.shadowModeEnabled}`);
  console.log(`- COGNITIVE_SHADOW_SAMPLE_PERCENT=${cfg.shadowSamplePercent}`);
  console.log(`- COGNITIVE_AUTO_ROLLBACK_ERROR_RATE=${cfg.rollbackErrorRate}`);
  console.log(`- COGNITIVE_AUTO_ROLLBACK_P95_MS=${cfg.rollbackP95Ms}`);
  console.log(`- COGNITIVE_AUTO_ROLLBACK_MIN_CALLS=${cfg.rollbackMinCalls}`);

  if (warnings.length > 0) {
    console.log('warnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  if (errors.length > 0) {
    console.error('errors:');
    for (const error of errors) console.error(`- ${error}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const profile = String(args.profile || 'development').toLowerCase();

if (!Object.prototype.hasOwnProperty.call(PROFILE_TO_FILE, profile) && !args.envFile) {
  console.error(`Unknown profile "${profile}". Use development|staging|production or pass --env-file.`);
  process.exit(1);
}

const loaded = loadEnvProfile(profile, args.envFile);
const config = getConfig(loaded.values);
const result = validate(profile, config);

printSummary(profile, loaded.target, config, result.warnings, result.errors);

if (result.errors.length > 0) {
  process.exit(1);
}

console.log('preflight: PASS');
