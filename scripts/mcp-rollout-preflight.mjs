#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
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

function parseCsv(raw, fallback) {
  const source = typeof raw === 'string' && raw.trim().length > 0 ? raw : fallback;
  return String(source)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      if (entry === 'dev') return 'development';
      if (entry === 'prod') return 'production';
      if (entry === 'stage') return 'staging';
      return entry;
    });
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
  const runtimeProfileRaw = String(values.MCP_ENV_PROFILE ?? values.RUNTIME_ENV ?? values.NODE_ENV ?? 'development')
    .toLowerCase();
  const runtimeProfile = runtimeProfileRaw === 'dev'
    ? 'development'
    : runtimeProfileRaw === 'prod'
      ? 'production'
      : runtimeProfileRaw === 'stage'
        ? 'staging'
        : runtimeProfileRaw;

  return {
    runtimeProfile,
    primaryRuntime: String(values.MCP_PRIMARY_RUNTIME ?? 'rust').toLowerCase(),
    cognitiveToolsEnabled: parseBoolean(values.COGNITIVE_TOOLS_ENABLED, true),
    reasonChainEnabled: parseBoolean(values.REASON_CHAIN_ENABLED, true),
    contextCompressionEnabled: parseBoolean(values.CONTEXT_COMPRESSION_ENABLED, true),
    orchestratorEnabled: parseBoolean(values.ORCHESTRATOR_ENABLED, false),
    toolGenExperimentalEnabled: parseBoolean(values.TOOL_GEN_EXPERIMENTAL_ENABLED, false),
    toolGenOracleExecution: parseBoolean(values.TOOL_GEN_ORACLE_EXECUTION, false),
    toolGenAllowedEnvs: parseCsv(values.TOOL_GEN_ALLOWED_ENVS, 'development,staging'),
    generatedToolMax: Math.floor(parseNumber(values.TOOL_GEN_MAX_DYNAMIC_TOOLS, 32)),
    toolGenPromoteMinCalls: Math.floor(parseNumber(values.TOOL_GEN_PROMOTE_MIN_CALLS, 30)),
    toolGenPromoteMaxErrorRate: parseNumber(values.TOOL_GEN_PROMOTE_MAX_ERROR_RATE, 0.15),
    toolGenPromoteMaxP95Ms: parseNumber(values.TOOL_GEN_PROMOTE_MAX_P95_MS, 1800),
    toolGenPromoteMaxFallbackRate: parseNumber(values.TOOL_GEN_PROMOTE_MAX_FALLBACK_RATE, 0.2),
    toolGenPromoteMinSatisfaction: parseNumber(values.TOOL_GEN_PROMOTE_MIN_SATISFACTION, 0.7),
    canaryPercent: parseNumber(values.COGNITIVE_CANARY_PERCENT, 100),
    shadowModeEnabled: parseBoolean(values.COGNITIVE_SHADOW_MODE_ENABLED, false),
    shadowSamplePercent: parseNumber(values.COGNITIVE_SHADOW_SAMPLE_PERCENT, 100),
    rollbackErrorRate: parseNumber(values.COGNITIVE_AUTO_ROLLBACK_ERROR_RATE, 0.35),
    rollbackP95Ms: parseNumber(values.COGNITIVE_AUTO_ROLLBACK_P95_MS, 3000),
    rollbackMinCalls: Math.floor(parseNumber(values.COGNITIVE_AUTO_ROLLBACK_MIN_CALLS, 20)),
    recommenderPrimary: String(values.COGNITIVE_RECOMMENDER_PRIMARY ?? 'v2').toLowerCase(),
    recommenderShadow: String(values.COGNITIVE_RECOMMENDER_SHADOW ?? 'v1').toLowerCase(),
    reasoningLatencyBudgetMs: Math.floor(parseNumber(values.COGNITIVE_REASONING_LATENCY_BUDGET_MS, 1200)),
  };
}

function validate(profile, cfg) {
  const errors = [];
  const warnings = [];
  const allowedEnvSet = new Set(['development', 'staging', 'production']);

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
  if (cfg.toolGenPromoteMinCalls < 1) {
    errors.push('TOOL_GEN_PROMOTE_MIN_CALLS must be >= 1.');
  }
  if (cfg.toolGenPromoteMaxErrorRate < 0 || cfg.toolGenPromoteMaxErrorRate > 1) {
    errors.push('TOOL_GEN_PROMOTE_MAX_ERROR_RATE must be within [0, 1].');
  }
  if (cfg.toolGenPromoteMaxP95Ms < 1) {
    errors.push('TOOL_GEN_PROMOTE_MAX_P95_MS must be >= 1.');
  }
  if (cfg.toolGenPromoteMaxFallbackRate < 0 || cfg.toolGenPromoteMaxFallbackRate > 1) {
    errors.push('TOOL_GEN_PROMOTE_MAX_FALLBACK_RATE must be within [0, 1].');
  }
  if (cfg.toolGenPromoteMinSatisfaction < 0 || cfg.toolGenPromoteMinSatisfaction > 1) {
    errors.push('TOOL_GEN_PROMOTE_MIN_SATISFACTION must be within [0, 1].');
  }
  if (!allowedEnvSet.has(cfg.runtimeProfile)) {
    warnings.push(`MCP_ENV_PROFILE=${cfg.runtimeProfile} is unusual; expected development|staging|production.`);
  }
  if (cfg.toolGenAllowedEnvs.length === 0) {
    errors.push('TOOL_GEN_ALLOWED_ENVS must include at least one environment.');
  }
  for (const envName of cfg.toolGenAllowedEnvs) {
    if (!allowedEnvSet.has(envName)) {
      errors.push(`TOOL_GEN_ALLOWED_ENVS contains invalid value: ${envName}`);
    }
  }
  if (profile !== cfg.runtimeProfile) {
    warnings.push(`Profile mismatch: --profile=${profile} but MCP_ENV_PROFILE=${cfg.runtimeProfile}.`);
  }
  if (cfg.toolGenExperimentalEnabled && !cfg.toolGenAllowedEnvs.includes(cfg.runtimeProfile)) {
    errors.push(`TOOL_GEN_EXPERIMENTAL_ENABLED=true but runtime profile ${cfg.runtimeProfile} is not in TOOL_GEN_ALLOWED_ENVS.`);
  }
  if (cfg.toolGenAllowedEnvs.includes('production')) {
    warnings.push('TOOL_GEN_ALLOWED_ENVS includes production. Keep disabled unless rollout has explicit approval.');
  }
  if (!['v1', 'v2'].includes(cfg.recommenderPrimary)) {
    errors.push('COGNITIVE_RECOMMENDER_PRIMARY must be v1 or v2.');
  }
  if (!['v1', 'v2'].includes(cfg.recommenderShadow)) {
    errors.push('COGNITIVE_RECOMMENDER_SHADOW must be v1 or v2.');
  }
  if (cfg.recommenderPrimary === cfg.recommenderShadow) {
    warnings.push('Recommender primary and shadow are identical; A/B shadow signal will be weak.');
  }
  if (cfg.reasoningLatencyBudgetMs < 200) {
    errors.push('COGNITIVE_REASONING_LATENCY_BUDGET_MS must be >= 200.');
  }
  if (!['rust', 'node'].includes(cfg.primaryRuntime)) {
    errors.push('MCP_PRIMARY_RUNTIME must be rust or node.');
  }
  if (profile !== 'development' && cfg.primaryRuntime !== 'rust') {
    errors.push('MCP_PRIMARY_RUNTIME must be rust outside development.');
  }
  if (profile === 'production' && cfg.primaryRuntime !== 'rust') {
    errors.push('Production runtime must be rust.');
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
  console.log(`- MCP_ENV_PROFILE=${cfg.runtimeProfile}`);
  console.log(`- MCP_PRIMARY_RUNTIME=${cfg.primaryRuntime}`);
  console.log(`- COGNITIVE_TOOLS_ENABLED=${cfg.cognitiveToolsEnabled}`);
  console.log(`- REASON_CHAIN_ENABLED=${cfg.reasonChainEnabled}`);
  console.log(`- CONTEXT_COMPRESSION_ENABLED=${cfg.contextCompressionEnabled}`);
  console.log(`- ORCHESTRATOR_ENABLED=${cfg.orchestratorEnabled}`);
  console.log(`- TOOL_GEN_EXPERIMENTAL_ENABLED=${cfg.toolGenExperimentalEnabled}`);
  console.log(`- TOOL_GEN_ORACLE_EXECUTION=${cfg.toolGenOracleExecution}`);
  console.log(`- TOOL_GEN_ALLOWED_ENVS=${cfg.toolGenAllowedEnvs.join(',')}`);
  console.log(`- TOOL_GEN_MAX_DYNAMIC_TOOLS=${cfg.generatedToolMax}`);
  console.log(`- TOOL_GEN_PROMOTE_MIN_CALLS=${cfg.toolGenPromoteMinCalls}`);
  console.log(`- TOOL_GEN_PROMOTE_MAX_ERROR_RATE=${cfg.toolGenPromoteMaxErrorRate}`);
  console.log(`- TOOL_GEN_PROMOTE_MAX_P95_MS=${cfg.toolGenPromoteMaxP95Ms}`);
  console.log(`- TOOL_GEN_PROMOTE_MAX_FALLBACK_RATE=${cfg.toolGenPromoteMaxFallbackRate}`);
  console.log(`- TOOL_GEN_PROMOTE_MIN_SATISFACTION=${cfg.toolGenPromoteMinSatisfaction}`);
  console.log(`- COGNITIVE_CANARY_PERCENT=${cfg.canaryPercent}`);
  console.log(`- COGNITIVE_SHADOW_MODE_ENABLED=${cfg.shadowModeEnabled}`);
  console.log(`- COGNITIVE_SHADOW_SAMPLE_PERCENT=${cfg.shadowSamplePercent}`);
  console.log(`- COGNITIVE_AUTO_ROLLBACK_ERROR_RATE=${cfg.rollbackErrorRate}`);
  console.log(`- COGNITIVE_AUTO_ROLLBACK_P95_MS=${cfg.rollbackP95Ms}`);
  console.log(`- COGNITIVE_AUTO_ROLLBACK_MIN_CALLS=${cfg.rollbackMinCalls}`);
  console.log(`- COGNITIVE_RECOMMENDER_PRIMARY=${cfg.recommenderPrimary}`);
  console.log(`- COGNITIVE_RECOMMENDER_SHADOW=${cfg.recommenderShadow}`);
  console.log(`- COGNITIVE_REASONING_LATENCY_BUDGET_MS=${cfg.reasoningLatencyBudgetMs}`);

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
