#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    dataset: path.resolve(repoRoot, 'docs/runtime-migration/slo/context-benchmark.dataset.json'),
    reportOut: path.resolve(repoRoot, 'data/memory/context-benchmark.report.json'),
    metricsOut: path.resolve(repoRoot, 'data/memory/phase-d-metrics.json'),
    mcpBin: null,
    timeoutMs: 15000,
    strict: false,
    minTokenReduction: 0.3,
    minFactualRetention: 0.9,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dataset' && argv[i + 1]) out.dataset = path.resolve(repoRoot, argv[++i]);
    if (arg === '--report-out' && argv[i + 1]) out.reportOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--metrics-out' && argv[i + 1]) out.metricsOut = path.resolve(repoRoot, argv[++i]);
    if (arg === '--mcp-bin' && argv[i + 1]) out.mcpBin = path.resolve(repoRoot, argv[++i]);
    if (arg === '--timeout-ms' && argv[i + 1]) out.timeoutMs = Number(argv[++i]);
    if (arg === '--strict') out.strict = true;
    if (arg === '--min-token-reduction' && argv[i + 1]) out.minTokenReduction = Number(argv[++i]);
    if (arg === '--min-factual-retention' && argv[i + 1]) out.minFactualRetention = Number(argv[++i]);
  }

  return out;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${path.relative(repoRoot, filePath)}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function tokenCount(text) {
  return String(text ?? '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
}

function factToPatterns(fact) {
  if (typeof fact === 'string') return [fact];
  if (fact && typeof fact === 'object' && Array.isArray(fact.patterns)) {
    return fact.patterns.map((entry) => String(entry));
  }
  return [];
}

function factMatches(compressedLower, fact) {
  const patterns = factToPatterns(fact).map((entry) => entry.toLowerCase().trim()).filter(Boolean);
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => compressedLower.includes(pattern));
}

function deriveFocusTerms(requiredFacts) {
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'after', 'before',
    'should', 'within', 'user', 'wallet', 'percent', 'is', 'at', 'to', 'of', 'in',
  ]);
  const terms = new Set();
  for (const fact of requiredFacts) {
    for (const pattern of factToPatterns(fact)) {
      const tokens = String(pattern)
        .toLowerCase()
        .split(/[^a-z0-9x]+/g)
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const token of tokens) {
        if (token.length < 3) continue;
        if (stopwords.has(token)) continue;
        terms.add(token);
      }
    }
  }
  return Array.from(terms).slice(0, 12);
}

function isMcpBinaryFresh(binPath) {
  if (!fs.existsSync(binPath)) return false;
  const binMtime = fs.statSync(binPath).mtimeMs;
  const watchedInputs = [
    path.resolve(repoRoot, 'crates/mcp-server/src/main.rs'),
    path.resolve(repoRoot, 'crates/mcp-server/Cargo.toml'),
    path.resolve(repoRoot, 'crates/mcp-server/Cargo.lock'),
  ];
  return watchedInputs.every((entry) => !fs.existsSync(entry) || fs.statSync(entry).mtimeMs <= binMtime);
}

function resolveMcpCommand(args) {
  if (args.mcpBin) {
    return { cmd: args.mcpBin, cmdArgs: [] };
  }

  const debugBin = path.resolve(repoRoot, 'crates/mcp-server/target/debug/mcp-server');
  if (isMcpBinaryFresh(debugBin)) {
    return { cmd: debugBin, cmdArgs: [] };
  }

  const releaseBin = path.resolve(repoRoot, 'crates/mcp-server/target/release/mcp-server');
  if (isMcpBinaryFresh(releaseBin)) {
    return { cmd: releaseBin, cmdArgs: [] };
  }

  return {
    cmd: 'cargo',
    cmdArgs: ['run', '--manifest-path', 'crates/mcp-server/Cargo.toml', '--quiet'],
  };
}

function startMcpProcess(args) {
  const resolved = resolveMcpCommand(args);
  const child = spawn(resolved.cmd, resolved.cmdArgs, {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let reqId = 1;
  const pending = new Map();

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const id = parsed?.id;
    if (!pending.has(id)) return;
    const entry = pending.get(id);
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(parsed?.result ?? null);
  });

  child.stderr.on('data', () => {
    // keep stderr attached for debugging in CI logs, but do not parse.
  });

  child.on('exit', () => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('MCP process exited before response'));
    }
    pending.clear();
  });

  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = reqId++;
      const payload = {
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? {},
      };
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout after ${args.timeoutMs}ms for method=${method}`));
      }, args.timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  function stop() {
    child.kill();
    rl.close();
  }

  return { call, stop, resolved };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = readJson(args.dataset);
  const cases = Array.isArray(dataset?.cases) ? dataset.cases : [];
  if (cases.length === 0) {
    throw new Error('Dataset has no cases.');
  }

  const mcp = startMcpProcess(args);
  await new Promise((resolve) => setTimeout(resolve, 800));

  const caseResults = [];
  let failures = 0;

  try {
    for (const entry of cases) {
      const id = String(entry?.id ?? `case-${caseResults.length + 1}`);
      const context = String(entry?.context ?? '');
      const targetTokens = Number(entry?.target_tokens ?? 40);
      const requiredFacts = Array.isArray(entry?.required_facts) ? entry.required_facts : [];
      const focusTerms = Array.isArray(entry?.focus_terms) && entry.focus_terms.length > 0
        ? entry.focus_terms.map((item) => String(item).toLowerCase())
        : deriveFocusTerms(requiredFacts);
      const preserveRecent = Number(entry?.preserve_recent ?? 1);

      const started = Date.now();
      let result;
      let error = null;
      try {
        result = await mcp.call('eidolon_compress_context', {
          context,
          target_tokens: targetTokens,
          focus_terms: focusTerms,
          preserve_recent: Number.isFinite(preserveRecent) ? preserveRecent : 1,
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      const latencyMs = Date.now() - started;

      if (error) {
        failures += 1;
        caseResults.push({
          id,
          ok: false,
          error,
          latency_ms: latencyMs,
        });
        continue;
      }

      const compressedText = String(result?.compressed_context ?? '');
      const originalTokens = Number(result?.original_tokens ?? tokenCount(context));
      const compressedTokens = Number(result?.compressed_tokens ?? tokenCount(compressedText));
      const tokenReductionRatio = originalTokens > 0
        ? clamp01(1 - compressedTokens / originalTokens)
        : 0;

      const compressedLower = compressedText.toLowerCase();
      const matchedFacts = requiredFacts.filter((fact) => factMatches(compressedLower, fact)).length;
      const factualRetention = requiredFacts.length > 0
        ? clamp01(matchedFacts / requiredFacts.length)
        : 1;

      caseResults.push({
        id,
        ok: true,
        latency_ms: latencyMs,
        original_tokens: originalTokens,
        compressed_tokens: compressedTokens,
        token_reduction_ratio: tokenReductionRatio,
        factual_retention: factualRetention,
        required_facts_total: requiredFacts.length,
        required_facts_matched: matchedFacts,
        focus_terms: focusTerms,
        compressed_context: compressedText,
      });
    }
  } finally {
    mcp.stop();
  }

  const successRows = caseResults.filter((row) => row.ok);
  const avgReduction = successRows.length > 0
    ? clamp01(successRows.reduce((sum, row) => sum + row.token_reduction_ratio, 0) / successRows.length)
    : 0;
  const avgRetention = successRows.length > 0
    ? clamp01(successRows.reduce((sum, row) => sum + row.factual_retention, 0) / successRows.length)
    : 0;

  const summary = {
    case_count: caseResults.length,
    success_count: successRows.length,
    failure_count: failures,
    average_token_reduction_ratio: avgReduction,
    average_factual_retention: avgRetention,
  };

  const report = {
    generated_at: new Date().toISOString(),
    dataset: path.relative(repoRoot, args.dataset),
    mcp_command: [mcp.resolved.cmd, ...mcp.resolved.cmdArgs].join(' '),
    summary,
    cases: caseResults,
  };

  const phaseMetrics = {
    window_days: 7,
    phase: {
      min_mcp_token_reduction_ratio: avgReduction,
      min_factual_retention: avgRetention,
    },
    global: {
      max_error_rate: caseResults.length > 0 ? clamp01(failures / caseResults.length) : 0,
      max_rollback_count: 0,
    },
  };

  ensureParent(args.reportOut);
  ensureParent(args.metricsOut);
  fs.writeFileSync(args.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(args.metricsOut, `${JSON.stringify(phaseMetrics, null, 2)}\n`, 'utf8');

  console.log(`context-benchmark dataset=${path.relative(repoRoot, args.dataset)}`);
  console.log(`context-benchmark report=${path.relative(repoRoot, args.reportOut)}`);
  console.log(`context-benchmark metrics=${path.relative(repoRoot, args.metricsOut)}`);
  console.log(
    `context-benchmark summary cases=${summary.case_count} success=${summary.success_count} failures=${summary.failure_count} token_reduction=${(summary.average_token_reduction_ratio * 100).toFixed(2)}% factual_retention=${(summary.average_factual_retention * 100).toFixed(2)}%`
  );

  if (args.strict) {
    const failed =
      summary.failure_count > 0 ||
      summary.average_token_reduction_ratio < args.minTokenReduction ||
      summary.average_factual_retention < args.minFactualRetention;
    if (failed) {
      console.error('context-benchmark: FAIL strict thresholds not met.');
      process.exit(2);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`context-benchmark: FAIL ${message}`);
  process.exit(1);
});
