#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    phase: 'A',
    metrics: null,
    slo: path.resolve(repoRoot, 'docs/runtime-migration/slo/phase-gates.v1.json'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--phase' && argv[i + 1]) out.phase = String(argv[++i]).toUpperCase();
    if (arg === '--metrics' && argv[i + 1]) out.metrics = path.resolve(repoRoot, argv[++i]);
    if (arg === '--slo' && argv[i + 1]) out.slo = path.resolve(repoRoot, argv[++i]);
  }
  return out;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${path.relative(repoRoot, filePath)}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function evaluateGate(expected, observed, key) {
  if (key.startsWith('max_')) {
    if (typeof observed !== 'number') return { ok: false, msg: `${key} missing/invalid` };
    return { ok: observed <= expected, msg: `${key}: observed=${observed} expected<=${expected}` };
  }

  if (key.startsWith('min_')) {
    if (typeof observed !== 'number') return { ok: false, msg: `${key} missing/invalid` };
    return { ok: observed >= expected, msg: `${key}: observed=${observed} expected>=${expected}` };
  }

  if (key.startsWith('required_')) {
    return { ok: observed === expected, msg: `${key}: observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}` };
  }

  if (typeof expected === 'number') {
    if (typeof observed !== 'number') return { ok: false, msg: `${key} missing/invalid` };
    return { ok: observed === expected, msg: `${key}: observed=${observed} expected=${expected}` };
  }

  return { ok: observed === expected, msg: `${key}: observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}` };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.metrics) {
    console.error('Usage: node scripts/runtime-phase-gate.mjs --phase <A|B|C|D|E|F> --metrics <file.json> [--slo <file.json>]');
    process.exit(1);
  }

  const slo = readJson(args.slo);
  const metrics = readJson(args.metrics);

  const phase = args.phase;
  const expected = slo?.phase_gates?.[phase];
  if (!expected || typeof expected !== 'object') {
    console.error(`Unknown phase "${phase}" in SLO file.`);
    process.exit(1);
  }

  const observed = (metrics?.phase && typeof metrics.phase === 'object') ? metrics.phase : {};
  const globalObserved = (metrics?.global && typeof metrics.global === 'object') ? metrics.global : {};

  const errors = [];
  const warnings = [];

  const stableDays = Number(metrics?.window_days ?? 0);
  const requiredWindow = Number(slo?.stable_window_days ?? 7);
  if (!Number.isFinite(stableDays) || stableDays < requiredWindow) {
    errors.push(`window_days: observed=${stableDays} expected>=${requiredWindow}`);
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    const observedValue = observed[key];
    const check = evaluateGate(expectedValue, observedValue, key);
    if (!check.ok) errors.push(check.msg);
  }

  const globalSpec = (slo?.global && typeof slo.global === 'object') ? slo.global : {};
  for (const [key, expectedValue] of Object.entries(globalSpec)) {
    const observedValue = globalObserved[key];
    const check = evaluateGate(expectedValue, observedValue, key);
    if (!check.ok) warnings.push(`global:${check.msg}`);
  }

  console.log(`runtime-phase-gate phase=${phase}`);
  console.log(`metrics_source=${path.relative(repoRoot, args.metrics)}`);
  console.log(`slo_source=${path.relative(repoRoot, args.slo)}`);

  if (warnings.length > 0) {
    console.log('warnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (errors.length > 0) {
    console.error('errors:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(2);
  }

  console.log('runtime-phase-gate: PASS');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runtime-phase-gate: FAIL ${message}`);
  process.exit(1);
}
