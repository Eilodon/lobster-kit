#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultOnnxModelDir = path.resolve(repoRoot, 'crates/mcp-server/data/models/minilm');
const defaultOnnxVenvDir = path.resolve(repoRoot, '.venv-onnx');
let lastSession = null;

function parseArgs(argv) {
  const out = {
    bin: path.resolve(repoRoot, 'target/release/mcp-server'),
    out: path.resolve(repoRoot, 'data/memory/cognitive-tool-eval.report.json'),
    timeoutMs: 8000,
    requireOnnx: true,
    ortDylibPath: '',
    onnxModelDir: '',
    reasoningMinFinalScore: 0.55,
    requireReasoningGrounded: true,
    sloSenseIntentMs: 1500,
    sloMemoryQueryMs: 200,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--bin' && argv[i + 1]) out.bin = path.resolve(repoRoot, argv[++i]);
    if (arg === '--out' && argv[i + 1]) out.out = path.resolve(repoRoot, argv[++i]);
    if (arg === '--timeout-ms' && argv[i + 1]) out.timeoutMs = Number(argv[++i]) || out.timeoutMs;
    if (arg === '--require-onnx') out.requireOnnx = true;
    if (arg === '--allow-fallback' || arg === '--no-require-onnx') out.requireOnnx = false;
    if (arg === '--ort-dylib-path' && argv[i + 1]) out.ortDylibPath = argv[++i];
    if (arg === '--onnx-model-dir' && argv[i + 1]) out.onnxModelDir = argv[++i];
    if (arg === '--reasoning-min-final-score' && argv[i + 1]) {
      out.reasoningMinFinalScore = Number(argv[++i]) || out.reasoningMinFinalScore;
    }
    if (arg === '--reasoning-allow-ungrounded') out.requireReasoningGrounded = false;
    if (arg === '--slo-sense-intent-ms' && argv[i + 1]) {
      out.sloSenseIntentMs = Number(argv[++i]) || out.sloSenseIntentMs;
    }
    if (arg === '--slo-memory-query-ms' && argv[i + 1]) {
      out.sloMemoryQueryMs = Number(argv[++i]) || out.sloMemoryQueryMs;
    }
  }
  return out;
}

function nowMs() {
  return Date.now();
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: text };
  }
}

function ensureParent(filePath) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
}

function check(condition, name, details = null) {
  return { name, pass: Boolean(condition), details };
}

function pickBestOnnxRuntimeDylib(candidates) {
  if (!candidates.length) return '';
  return candidates
    .slice()
    .sort((a, b) => {
      const aBase = path.basename(a);
      const bBase = path.basename(b);
      if (aBase.length !== bBase.length) return bBase.length - aBase.length;
      return aBase.localeCompare(bBase);
    })[0];
}

function resolveOrtDylibFromVenv(venvDir) {
  const libDir = path.resolve(venvDir, 'lib');
  if (!fs.existsSync(libDir)) return '';
  const dirs = [libDir];
  const dylibCandidates = [];
  while (dirs.length) {
    const current = dirs.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        dirs.push(fullPath);
        continue;
      }
      if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.startsWith('libonnxruntime.so')) {
        dylibCandidates.push(fullPath);
      }
    }
  }
  return pickBestOnnxRuntimeDylib(dylibCandidates);
}

function applyOnnxEnvDefaults(args, baseEnv) {
  if (!args.requireOnnx) return;

  if (!baseEnv.ONNX_MODEL_DIR && fs.existsSync(path.join(defaultOnnxModelDir, 'model.onnx'))) {
    baseEnv.ONNX_MODEL_DIR = defaultOnnxModelDir;
  }

  const ortFromEnv = baseEnv.ORT_DYLIB_PATH;
  if (ortFromEnv && !fs.existsSync(ortFromEnv)) {
    console.error(`[mcp-cognitive-eval] ORT_DYLIB_PATH not found: ${ortFromEnv}`);
    delete baseEnv.ORT_DYLIB_PATH;
  }

  if (!baseEnv.ORT_DYLIB_PATH) {
    const inferredOrt = resolveOrtDylibFromVenv(defaultOnnxVenvDir);
    if (inferredOrt) {
      baseEnv.ORT_DYLIB_PATH = inferredOrt;
    }
  }

  if (!baseEnv.ORT_DYLIB_PATH) {
    console.error('[mcp-cognitive-eval] --require-onnx is set but ORT_DYLIB_PATH is missing.');
  }
  if (!baseEnv.ONNX_MODEL_DIR) {
    console.error('[mcp-cognitive-eval] --require-onnx is set but ONNX_MODEL_DIR is missing.');
  }
}

function assertOnnxRequiredReady(args, baseEnv) {
  if (!args.requireOnnx) return;
  const missing = [];
  if (!baseEnv.ORT_DYLIB_PATH || !fs.existsSync(baseEnv.ORT_DYLIB_PATH)) {
    missing.push('ORT_DYLIB_PATH');
  }
  const modelPath = baseEnv.ONNX_MODEL_DIR
    ? path.join(baseEnv.ONNX_MODEL_DIR, 'model.onnx')
    : '';
  if (!baseEnv.ONNX_MODEL_DIR || !fs.existsSync(modelPath)) {
    missing.push('ONNX_MODEL_DIR/model.onnx');
  }
  if (missing.length) {
    throw new Error(
      `[mcp-cognitive-eval] ONNX is required but missing prerequisites: ${missing.join(', ')}`,
    );
  }
}

class McpSession {
  constructor({ bin, timeoutMs, env }) {
    this.bin = bin;
    this.timeoutMs = timeoutMs;
    this.env = env;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.stderr = [];
  }

  async start() {
    if (!fs.existsSync(this.bin)) {
      throw new Error(`MCP binary not found: ${this.bin}`);
    }

    this.child = spawn(this.bin, [], {
      cwd: repoRoot,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.rl = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line) => {
      const parsed = safeJsonParse(line);
      if (!parsed.ok) return;
      const msg = parsed.value;
      const id = msg?.id;
      if (!this.pending.has(id)) return;
      const slot = this.pending.get(id);
      this.pending.delete(id);
      slot.resolve(msg);
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderr.push(String(chunk));
    });

    this.child.on('close', () => {
      this.closed = true;
      for (const [, slot] of this.pending) {
        slot.reject(new Error('MCP process closed before response'));
      }
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    if (this.closed) {
      throw new Error('Session already closed');
    }
    const id = this.nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    const payload = `${JSON.stringify(req)}\n`;

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response id=${id} method=${method}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.child.stdin.write(payload);
    });

    return result;
  }

  decodeToolsCallResult(msg) {
    const result = msg?.result ?? {};
    const isError = Boolean(result?.isError);
    const text = result?.content?.[0]?.text;
    const decoded = typeof text === 'string' ? safeJsonParse(text) : { ok: true, value: result };
    return {
      isError,
      payload: decoded.value,
      payloadParsed: decoded.ok,
      raw: result,
    };
  }

  async callTool(name, args, fieldMode = 'name_arguments') {
    let params;
    if (fieldMode === 'tool_input') {
      params = { tool: name, input: args };
    } else if (fieldMode === 'name_input') {
      params = { name, input: args };
    } else {
      params = { name, arguments: args };
    }
    const started = nowMs();
    const msg = await this.send('tools/call', params);
    const ended = nowMs();
    const decoded = this.decodeToolsCallResult(msg);
    return {
      tool: name,
      fieldMode,
      latency_ms: ended - started,
      ...decoded,
      request: { name, args },
    };
  }

  async readResource(uri) {
    const started = nowMs();
    const msg = await this.send('resources/read', { uri });
    const ended = nowMs();
    const text = msg?.result?.contents?.[0]?.text ?? '';
    const parsed = safeJsonParse(text);
    return {
      uri,
      latency_ms: ended - started,
      payload: parsed.value,
      payloadParsed: parsed.ok,
      raw: msg?.result ?? {},
    };
  }

  async stop() {
    if (!this.child || this.closed) return;
    try {
      this.child.kill();
    } catch {
      // The child process may already be terminated; ignore kill errors.
    }
    this.closed = true;
  }
}

function summarizeToolScenarios(scenarios) {
  const grouped = new Map();
  for (const scenario of scenarios) {
    const key = scenario.tool;
    if (!grouped.has(key)) {
      grouped.set(key, {
        tool: key,
        calls: 0,
        passed_checks: 0,
        total_checks: 0,
        avg_latency_ms: 0,
      });
    }
    const row = grouped.get(key);
    row.calls += 1;
    row.avg_latency_ms += scenario.latency_ms || 0;
    for (const c of scenario.checks || []) {
      row.total_checks += 1;
      if (c.pass) row.passed_checks += 1;
    }
  }
  return Array.from(grouped.values()).map((row) => ({
    ...row,
    avg_latency_ms: row.calls > 0 ? Number((row.avg_latency_ms / row.calls).toFixed(2)) : 0,
    pass_rate: row.total_checks > 0 ? Number((row.passed_checks / row.total_checks).toFixed(4)) : 0,
  }));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString();
  const unique = String(Date.now());
  const dbPath = path.resolve(repoRoot, `data/memory/cognitive-eval-${unique}.db`);

  const baseEnv = {
    ...process.env,
    EIDOLON_DB_PATH: dbPath,
  };
  if (args.ortDylibPath) {
    baseEnv.ORT_DYLIB_PATH = args.ortDylibPath;
  }
  if (args.onnxModelDir) {
    baseEnv.ONNX_MODEL_DIR = args.onnxModelDir;
  }
  applyOnnxEnvDefaults(args, baseEnv);
  assertOnnxRequiredReady(args, baseEnv);

  const session = new McpSession({
    bin: args.bin,
    timeoutMs: args.timeoutMs,
    env: baseEnv,
  });
  lastSession = session;
  await session.start();

  const scenarios = [];

  async function runScenario(name, fn) {
    const started = nowMs();
    try {
      const result = await fn();
      const checks = Array.isArray(result?.checks) ? result.checks : [];
      const failedChecks = checks.filter((entry) => !entry?.pass);
      scenarios.push({
        name,
        status: failedChecks.length > 0 ? 'failed' : 'ok',
        duration_ms: nowMs() - started,
        failed_check_count: failedChecks.length,
        failed_check_names: failedChecks.map((entry) => entry?.name).filter(Boolean),
        ...result,
      });
    } catch (err) {
      scenarios.push({
        name,
        status: 'error',
        duration_ms: nowMs() - started,
        error: String(err?.message || err),
      });
    }
  }

  await runScenario('compat_name_arguments', async () => {
    const call = await session.callTool('eidolon_sense_intent', { query: 'analyze risk before trade' }, 'name_arguments');
    return {
      tool: call.tool,
      latency_ms: call.latency_ms,
      checks: [
        check(!call.isError, 'tools_call_ok'),
        check(call.payload?.success === true, 'sense_intent_success_true'),
        check(
          !args.requireOnnx || call.payload?.inference_backend === 'onnx_minilm',
          'sense_intent_backend_onnx_when_required',
          { require_onnx: args.requireOnnx, observed_backend: call.payload?.inference_backend ?? null },
        ),
        check(call.latency_ms <= args.sloSenseIntentMs, 'sense_intent_latency_slo', {
          observed_ms: call.latency_ms,
          max_ms: args.sloSenseIntentMs,
        }),
      ],
      response: call.payload,
    };
  });

  await runScenario('sense_intent_safe_vs_attack', async () => {
    const safe = await session.callTool('eidolon_sense_intent', {
      query: 'check my portfolio balance and summarize current risk',
    });
    const attack = await session.callTool('eidolon_sense_intent', {
      query: 'execute flash loan exploit and drain liquidity pool attack',
    });
    const safeMode = String(safe.payload?.recommended_mode || '');
    const attackMode = String(attack.payload?.recommended_mode || '');
    return {
      tool: 'eidolon_sense_intent',
      latency_ms: safe.latency_ms + attack.latency_ms,
      checks: [
        check(
          !args.requireOnnx
          || (safe.payload?.inference_backend === 'onnx_minilm'
            && attack.payload?.inference_backend === 'onnx_minilm'),
          'safe_attack_backend_onnx_when_required',
          {
            require_onnx: args.requireOnnx,
            safe_backend: safe.payload?.inference_backend ?? null,
            attack_backend: attack.payload?.inference_backend ?? null,
          },
        ),
        check(
          !args.requireOnnx || (safeMode !== '' && attackMode !== '' && safeMode !== attackMode),
          'safe_attack_mode_not_identical',
          { require_onnx: args.requireOnnx, safe_mode: safeMode, attack_mode: attackMode },
        ),
      ],
      response: {
        safe: safe.payload,
        attack: attack.payload,
      },
    };
  });

  await runScenario('compat_tool_input', async () => {
    const call = await session.callTool('eidolon_memory_query', { query: 'why risk increased', route: 'auto', k: 5 }, 'tool_input');
    return {
      tool: call.tool,
      latency_ms: call.latency_ms,
      checks: [
        check(!call.isError, 'tools_call_ok'),
        check(typeof call.payload?.route_selected === 'string', 'route_selected_present'),
        check(call.latency_ms <= args.sloMemoryQueryMs, 'memory_query_latency_slo', {
          observed_ms: call.latency_ms,
          max_ms: args.sloMemoryQueryMs,
        }),
      ],
      response: call.payload,
    };
  });

  await runScenario('update_and_recall_user', async () => {
    const up = await session.callTool(
      'eidolon_update_user',
      { user_id: 'eval_user', preferred_mode: 'Stalking', risk_tolerance: 0.12 },
    );
    const recall = await session.callTool('eidolon_recall_user', { user_id: 'eval_user' });
    return {
      tool: 'eidolon_update_user|eidolon_recall_user',
      latency_ms: up.latency_ms + recall.latency_ms,
      checks: [
        check(up.payload?.status === 'user_profile_persisted', 'update_status_ok'),
        check(recall.payload?.profile?.preferred_mode === 'Stalking', 'recall_reflects_updated_profile'),
      ],
      response: { update: up.payload, recall: recall.payload },
    };
  });

  await runScenario('update_recall_user_cross_session', async () => {
    const crossUser = `eval_user_cross_${Date.now()}`;
    const up = await session.callTool(
      'eidolon_update_user',
      { user_id: crossUser, preferred_mode: 'Berserk', risk_tolerance: 0.91 },
    );

    const verifySession = new McpSession({
      bin: args.bin,
      timeoutMs: args.timeoutMs,
      env: baseEnv,
    });
    await verifySession.start();
    const recall = await verifySession.callTool('eidolon_recall_user', { user_id: crossUser });
    await verifySession.stop();

    return {
      tool: 'eidolon_update_user|eidolon_recall_user',
      latency_ms: up.latency_ms + recall.latency_ms,
      checks: [
        check(up.payload?.status === 'user_profile_persisted', 'cross_session_update_status_ok'),
        check(recall.payload?.profile?.preferred_mode === 'Berserk', 'cross_session_mode_persisted'),
        check(
          Math.abs((Number(recall.payload?.profile?.risk_tolerance) || 0) - 0.91) < 1e-9,
          'cross_session_risk_persisted',
        ),
      ],
      response: { update: up.payload, recall: recall.payload },
    };
  });

  await runScenario('trauma_guardrail_flow', async () => {
    const pattern = 'high_risk_swap_now';
    const before = await session.callTool('eidolon_check_pattern', { pattern, mode: 'Peer' });
    const outcome = await session.callTool('eidolon_record_outcome', {
      pattern,
      mode: 'Peer',
      severity: 1.3,
    });
    const after = await session.callTool('eidolon_check_pattern', { pattern, mode: 'Peer' });
    const simulate = await session.callTool('eidolon_simulate_response', { action: pattern });
    return {
      tool: 'eidolon_check_pattern|eidolon_record_outcome|eidolon_simulate_response',
      latency_ms: before.latency_ms + outcome.latency_ms + after.latency_ms + simulate.latency_ms,
      checks: [
        check(before.payload?.inhibited === false, 'before_not_inhibited'),
        check(outcome.payload?.status === 'outcome_recorded', 'outcome_recorded'),
        check(typeof after.payload?.inhibited === 'boolean', 'after_inhibited_boolean'),
        check(typeof simulate.payload?.should_revise === 'boolean', 'simulate_has_revise_flag'),
      ],
      response: {
        before: before.payload,
        after: after.payload,
        simulate: simulate.payload,
      },
    };
  });

  await runScenario('simulate_response_counterfactual_tree', async () => {
    const safe = await session.callTool('eidolon_simulate_response', {
      action: 'summarize wallet risk and provide safe strategy',
    });
    const attack = await session.callTool('eidolon_simulate_response', {
      action: 'execute flash loan exploit and drain pool',
    });
    return {
      tool: 'eidolon_simulate_response',
      latency_ms: safe.latency_ms + attack.latency_ms,
      checks: [
        check(typeof safe.payload?.counterfactual?.expected_loss === 'number', 'safe_expected_loss_number'),
        check(typeof attack.payload?.counterfactual?.expected_loss === 'number', 'attack_expected_loss_number'),
        check(Array.isArray(attack.payload?.counterfactual?.loss_confidence_interval_90), 'attack_ci_array'),
        check(attack.payload?.counterfactual?.expected_loss >= safe.payload?.counterfactual?.expected_loss, 'attack_loss_ge_safe_loss'),
        check(typeof attack.payload?.scenario_tree?.worst?.expected_loss === 'number', 'worst_case_loss_number'),
      ],
      response: { safe: safe.payload, attack: attack.payload },
    };
  });

  await runScenario('memory_stack_flow', async () => {
    const commits = [];
    for (let i = 0; i < 4; i++) {
      const c = await session.callTool('eidolon_commit_pattern', { pattern: `liquidity_imbalance_${i}` });
      commits.push(c.payload);
    }
    const mqAuto = await session.callTool('eidolon_memory_query', {
      query: 'why liquidity risk increased',
      route: 'auto',
      k: 8,
    });
    const mqSemantic = await session.callTool('eidolon_memory_query', {
      query: 'liquidity imbalance',
      route: 'semantic',
      k: 8,
    });
    const recallSimilar = await session.callTool('eidolon_recall_similar', {
      context: 'liquidity imbalance risk',
      k: 5,
    });
    return {
      tool: 'eidolon_commit_pattern|eidolon_memory_query|eidolon_recall_similar',
      latency_ms:
        mqAuto.latency_ms +
        mqSemantic.latency_ms +
        recallSimilar.latency_ms +
        commits.length * 1,
      checks: [
        check(mqAuto.payload?.matches >= 1, 'memory_query_auto_returns_matches'),
        check(mqSemantic.payload?.route_selected === 'semantic', 'memory_query_semantic_selected'),
        check(Array.isArray(recallSimilar.payload?.matches), 'recall_similar_returns_array'),
      ],
      response: {
        memory_query_auto: mqAuto.payload,
        memory_query_semantic: mqSemantic.payload,
        recall_similar: recallSimilar.payload,
      },
    };
  });

  await runScenario('memory_route_feedback_tuning', async () => {
    await session.callTool('eidolon_record_outcome', {
      pattern: 'why risk increased after liquidity shock',
      mode: 'Peer',
      severity: 1.7,
    });
    const query = await session.callTool('eidolon_memory_query', {
      query: 'why risk increased after liquidity shock',
      route: 'auto',
      k: 6,
    });
    return {
      tool: 'eidolon_memory_query|eidolon_record_outcome',
      latency_ms: query.latency_ms,
      checks: [
        check(typeof query.payload?.route_feedback_bias === 'object', 'route_feedback_bias_object'),
        check(typeof query.payload?.route_feedback_bias?.causal === 'number', 'route_feedback_bias_causal_number'),
      ],
      response: query.payload,
    };
  });

  await runScenario('compress_context_direct', async () => {
    const call = await session.callTool('eidolon_compress_context', {
      context:
        'Gas spike warning at 38 gwei. Gas spike warning at 38 gwei. User wallet risk exposure is 72 percent. Action required: reduce leverage and set stop loss at 5 percent.',
      target_tokens: 40,
      focus_terms: ['risk', 'stop loss'],
      dedupe_threshold: 0.8,
    });
    return {
      tool: call.tool,
      latency_ms: call.latency_ms,
      checks: [
        check(call.payload?.strategy === 'context_compressor.importance_dedupe_v1', 'strategy_tag_present'),
        check((call.payload?.token_reduction_ratio ?? 0) > 0.05, 'token_reduction_positive'),
        check((call.payload?.dedupe_removed_count ?? 0) >= 1, 'dedupe_effect_visible'),
      ],
      response: call.payload,
    };
  });

  await runScenario('compress_context_fallback_memory_store', async () => {
    const call = await session.callTool('eidolon_compress_context', {
      target_tokens: 50,
      preserve_recent: 3,
    });
    return {
      tool: call.tool,
      latency_ms: call.latency_ms,
      checks: [
        check(call.payload?.source === 'memory_store', 'memory_store_fallback_source'),
        check(call.payload?.fallback_used === true, 'fallback_used_true'),
      ],
      response: call.payload,
    };
  });

  await runScenario('reason_chain_policy_and_pipeline', async () => {
    const deep = await session.callTool('eidolon_reason_chain', {
      draft: 'Proceed with staged execution and stop-loss',
      context: 'critical incident risk high volatility and unsafe signals present '.repeat(8),
      mode: 'auto',
      latency_budget_ms: 1500,
    });
    const budgetForcedFast = await session.callTool('eidolon_reason_chain', {
      draft: 'Proceed quickly',
      context: 'critical incident risk high volatility and unsafe signals present '.repeat(8),
      mode: 'auto',
      latency_budget_ms: 300,
    });
    const deepGrounded = deep.payload?.pipeline?.verifier?.groundedness_pass === true;
    const deepFinalScore = Number(deep.payload?.final_score ?? 0);
    return {
      tool: 'eidolon_reason_chain',
      latency_ms: deep.latency_ms + budgetForcedFast.latency_ms,
      checks: [
        check(Array.isArray(deep.payload?.pipeline?.critic?.findings), 'critic_findings_array'),
        check(Array.isArray(deep.payload?.pipeline?.tot?.branches), 'tot_branches_array'),
        check(typeof deep.payload?.pipeline?.verifier?.score === 'number', 'verifier_score_number'),
        check(deep.payload?.mode_selected === 'deep', 'auto_selects_deep_for_complex_context'),
        check(budgetForcedFast.payload?.mode_selected === 'fast', 'budget_guard_fallback_fast'),
        check(!args.requireReasoningGrounded || deepGrounded, 'deep_case_groundedness_pass', {
          require_grounded: args.requireReasoningGrounded,
          observed: deep.payload?.pipeline?.verifier?.groundedness_pass ?? null,
        }),
        check(deepFinalScore >= args.reasoningMinFinalScore, 'deep_case_final_score_threshold', {
          observed: deepFinalScore,
          min_required: args.reasoningMinFinalScore,
        }),
      ],
      response: {
        deep_case: deep.payload,
        budget_case: budgetForcedFast.payload,
      },
    };
  });

  await runScenario('orchestrate_mode_policy', async () => {
    const lowConf = await session.callTool('eidolon_orchestrate', {
      agent_count: 5,
      task: 'complex incident response',
      confidence: 0.4,
      latency_budget_ms: 1400,
    });
    const highConf = await session.callTool('eidolon_orchestrate', {
      agent_count: 5,
      task: 'routine summary',
      confidence: 0.92,
      latency_budget_ms: 1400,
    });
    return {
      tool: 'eidolon_orchestrate',
      latency_ms: lowConf.latency_ms + highConf.latency_ms,
      checks: [
        check(lowConf.payload?.reasoning_mode_policy?.mode_selected === 'deep', 'low_conf_promotes_deep'),
        check(highConf.payload?.reasoning_mode_policy?.mode_selected === 'fast', 'high_conf_prefers_fast'),
      ],
      response: {
        low_conf: lowConf.payload,
        high_conf: highConf.payload,
      },
    };
  });

  await runScenario('orchestrate_role_specialization_arbitration', async () => {
    const call = await session.callTool('eidolon_orchestrate', {
      agent_count: 6,
      task: 'critical incident response with retrieval and verification',
      confidence: 0.42,
      latency_budget_ms: 1600,
    });
    return {
      tool: 'eidolon_orchestrate',
      latency_ms: call.latency_ms,
      checks: [
        check(Array.isArray(call.payload?.role_specialization?.roles), 'role_list_array'),
        check(Array.isArray(call.payload?.role_specialization?.agent_outputs), 'agent_outputs_array'),
        check(typeof call.payload?.arbitration?.decision === 'string', 'arbitration_decision_string'),
        check(Array.isArray(call.payload?.budget_allocation?.allocations), 'budget_allocations_array'),
      ],
      response: call.payload,
    };
  });

  await runScenario('tool_recommend_ab_shadow', async () => {
    const v2 = await session.callTool('eidolon_tool_recommend', {
      task: 'analyze risk and retrieve memory before action',
      available_tools: [
        'eidolon_memory_query',
        'eidolon_reason_chain',
        'eidolon_compress_context',
        'eidolon_simulate_response',
      ],
      recommender_model: 'v2',
      shadow_mode: true,
    });
    const v1 = await session.callTool('eidolon_tool_recommend', {
      task: 'analyze risk and retrieve memory before action',
      available_tools: [
        'eidolon_memory_query',
        'eidolon_reason_chain',
        'eidolon_compress_context',
        'eidolon_simulate_response',
      ],
      recommender_model: 'v1',
      shadow_mode: true,
    });
    return {
      tool: 'eidolon_tool_recommend',
      latency_ms: v1.latency_ms + v2.latency_ms,
      checks: [
        check(v2.payload?.recommender?.primary_model === 'v2', 'primary_model_v2'),
        check(v1.payload?.recommender?.primary_model === 'v1', 'primary_model_v1'),
        check(typeof v2.payload?.recommender?.shadow_executed === 'boolean', 'shadow_executed_boolean'),
      ],
      response: { v2: v2.payload, v1: v1.payload },
    };
  });

  await runScenario('route_action_gate_modes', async () => {
    for (let i = 0; i < 6; i++) {
      await session.callTool('eidolon_check_pattern', { pattern: `route_warmup_${i}`, mode: 'Peer' });
    }
    const low = await session.callTool('eidolon_route_action', {
      suggested_tool: 'eidolon_reason_chain',
      intent_confidence: 0.22,
      context_type: 'risk',
    });
    const high = await session.callTool('eidolon_route_action', {
      suggested_tool: 'eidolon_check_pattern',
      intent_confidence: 0.96,
      context_type: 'retrieval',
    });
    return {
      tool: 'eidolon_route_action',
      latency_ms: low.latency_ms + high.latency_ms,
      checks: [
        check(['ASK_USER', 'PROPOSE', 'AUTO'].includes(low.payload?.strategy), 'low_strategy_valid'),
        check(['ASK_USER', 'PROPOSE', 'AUTO'].includes(high.payload?.strategy), 'high_strategy_valid'),
        check(high.payload?.strategy === 'AUTO', 'high_strategy_reaches_auto'),
        check(typeof high.payload?.confidence === 'number', 'confidence_number'),
      ],
      response: { low: low.payload, high: high.payload },
    };
  });

  await runScenario('dream_conversation_prune', async () => {
    for (let i = 0; i < 120; i++) {
      await session.callTool('eidolon_commit_pattern', { pattern: `bulk_pattern_${i}` });
    }
    const dream = await session.callTool('eidolon_dream_conversation', { episodes: 25 });
    return {
      tool: dream.tool,
      latency_ms: dream.latency_ms,
      checks: [
        check(dream.payload?.status === 'dream_sequence_complete', 'dream_status_ok'),
        check(typeof dream.payload?.memory_pruned === 'boolean', 'dream_memory_pruned_flag'),
      ],
      response: dream.payload,
    };
  });

  await runScenario('generated_tool_decision_disabled_env', async () => {
    const call = await session.callTool('eidolon_generated_tool_decision', {
      tool_name: 'eidolon_gen_eval_tool',
      action: 'promote',
      need: 'tool_generator_review',
      reason: 'evaluation_probe',
    });
    return {
      tool: call.tool,
      latency_ms: call.latency_ms,
      checks: [
        check(call.payload?.approved === false, 'decision_rejected_when_disabled'),
        check(typeof call.payload?.reason === 'string', 'decision_reason_present'),
      ],
      response: call.payload,
    };
  });

  await runScenario('telemetry_precision_fields_present', async () => {
    const telemetry = await session.readResource('eidolon://telemetry');
    const rows = Array.isArray(telemetry.payload?.tools) ? telemetry.payload.tools : [];
    const row = rows.find((entry) => entry?.tool === 'eidolon_check_pattern') || rows[0] || {};
    return {
      tool: 'eidolon://telemetry',
      latency_ms: telemetry.latency_ms,
      checks: [
        check(typeof row?.avg_latency_us === 'number', 'avg_latency_us_number'),
        check(typeof row?.latency_p90_ms === 'number', 'latency_p90_number'),
        check(typeof row?.latency_p99_ms === 'number', 'latency_p99_number'),
        check(typeof row?.latency_sample_count === 'number', 'latency_sample_count_number'),
        check((row?.latency_p99_ms ?? 0) >= (row?.latency_p95_ms ?? 0), 'p99_ge_p95'),
      ],
      response: row,
    };
  });

  const resourceTelemetry = await session.readResource('eidolon://telemetry');
  const resourceAudit = await session.readResource('eidolon://generated-tool-audit');
  const resourceShadow = await session.readResource('eidolon://recommender-shadow');

  await session.stop();

  const promotionSession = new McpSession({
    bin: args.bin,
    timeoutMs: args.timeoutMs,
    env: {
      ...baseEnv,
      TOOL_GEN_EXPERIMENTAL_ENABLED: '1',
      MCP_ENV_PROFILE: 'staging',
    },
  });
  lastSession = promotionSession;
  await promotionSession.start();

  await promotionSession.callTool('eidolon_check_pattern', {
    pattern: 'promotion_probe_warmup',
    mode: 'Peer',
  });

  const promotionProbe = await promotionSession.callTool('eidolon_generated_tool_decision', {
    tool_name: 'eidolon_check_pattern',
    action: 'promote',
    need: 'tool_generator_review',
    reason: 'promotion_probe',
  });
  await promotionSession.stop();

  scenarios.push({
    name: 'promotion_probe_gate',
    status: promotionProbe.payload?.reason === 'promotion_telemetry_missing' ? 'failed' : 'ok',
    duration_ms: promotionProbe.latency_ms,
    failed_check_count:
      (promotionProbe.payload?.reason === 'promotion_telemetry_missing' ? 1 : 0),
    failed_check_names:
      (promotionProbe.payload?.reason === 'promotion_telemetry_missing'
        ? ['promotion_probe_not_telemetry_missing']
        : []),
    tool: 'eidolon_generated_tool_decision',
    latency_ms: promotionProbe.latency_ms,
    checks: [
      check(typeof promotionProbe.payload?.reason === 'string', 'promotion_probe_reason_present'),
      check(
        promotionProbe.payload?.reason !== 'promotion_telemetry_missing',
        'promotion_probe_not_telemetry_missing',
        { reason: promotionProbe.payload?.reason ?? null },
      ),
    ],
    response: promotionProbe.payload,
  });

  const toolScenarios = scenarios.filter((s) => s.tool);
  const toolSummary = summarizeToolScenarios(toolScenarios);

  const report = {
    generated_at: timestamp,
    binary: args.bin,
    db_path: dbPath,
    env_profile_primary: 'development',
    env_profile_promotion_probe: 'staging',
    onnx: {
      require_onnx: args.requireOnnx,
      ort_dylib_path: baseEnv.ORT_DYLIB_PATH || null,
      onnx_model_dir: baseEnv.ONNX_MODEL_DIR || null,
    },
    total_scenarios: scenarios.length,
    failed_scenarios: scenarios.filter((s) => s.status !== 'ok').length,
    scenarios,
    tool_summary: toolSummary,
    resources: {
      telemetry: resourceTelemetry.payload,
      generated_tool_audit: resourceAudit.payload,
      recommender_shadow: resourceShadow.payload,
    },
    promotion_probe: {
      response: promotionProbe.payload,
      latency_ms: promotionProbe.latency_ms,
      checks: [
        check(
          typeof promotionProbe.payload?.reason === 'string',
          'promotion_probe_reason_present',
        ),
        check(
          promotionProbe.payload?.reason !== 'promotion_telemetry_missing',
          'promotion_probe_not_telemetry_missing',
          { reason: promotionProbe.payload?.reason ?? null },
        ),
      ],
    },
    stderr_preview: session.stderr.slice(-20),
  };

  ensureParent(args.out);
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summary = {
    out: path.relative(repoRoot, args.out),
    db: path.relative(repoRoot, dbPath),
    scenarios: report.total_scenarios,
    failed: report.failed_scenarios,
    top_tools_by_pass_rate: toolSummary
      .slice()
      .sort((a, b) => b.pass_rate - a.pass_rate)
      .slice(0, 8),
    promotion_probe: report.promotion_probe.response,
  };

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((err) => {
  if (lastSession?.stderr?.length) {
    console.error(lastSession.stderr.slice(-80).join(''));
  }
  console.error(`mcp-cognitive-eval: ${String(err?.stack || err)}`);
  process.exit(1);
});
