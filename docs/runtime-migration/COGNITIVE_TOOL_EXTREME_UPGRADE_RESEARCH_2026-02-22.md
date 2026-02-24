# Cognitive Tool Extreme Upgrade Research (Empirical, 2026-02-22)

## 1) Scope and Method

Evaluation scope:
- All current cognitive tools exposed by MCP runtime (`eidolon_*`).
- Real runtime invocation via `tools/call` against `packages/mcp-rust/target/release/mcp-rust`.
- Multi-scenario evaluation: compatibility fields, guardrail flow, retrieval/compression/reasoning/orchestration/governance.

Artifacts:
- Runner script: `scripts/mcp-cognitive-eval.mjs`
- JSON report: `data/memory/cognitive-tool-eval.report.json`
- Isolated telemetry DB from test run:
  - `data/memory/cognitive-eval-1771742344905.db`

Run command:
```bash
pnpm mcp:cognitive:eval
```

## 2) High-Level Verdict

- Practical value is real and non-trivial for LLM operator workflows.
- Most useful now: `memory_query`, `compress_context`, `tool_recommend`, `reason_chain`.
- Safety value is meaningful: `check_pattern` + `simulate_response` + `record_outcome`.
- Key limitations are architectural, not cosmetic:
  - intent/routing confidence model saturation,
  - weak cross-session user-memory persistence,
  - shallow causal scoring,
  - heuristic embedding/reasoning fallbacks.

## 3) Per-Tool Utility Assessment

| Tool | Current Utility | Potential Ceiling | Current Constraint |
|---|---|---|---|
| `eidolon_sense_intent` | Medium-Low | Very High | In test, safe and malicious prompts both returned same mode/confidence (flat behavior when no strong backend signal). |
| `eidolon_route_action` | Medium | Very High | `AUTO` effectively unreachable in observed runtime due confidence composition saturation. |
| `eidolon_recall_user` | Medium | High | Works in-session, but cross-session persistence behavior is inconsistent in real process restarts. |
| `eidolon_update_user` | Medium | High | Returns success and works in-session; persistence semantics need hard verification/fix. |
| `eidolon_check_pattern` | High | High | Guardrail state transitions worked as expected after negative outcome injection. |
| `eidolon_simulate_response` | Medium-High | High | Useful for inhibition-aware revise/no-revise gate; still rule-based. |
| `eidolon_record_outcome` | High | Very High | Strong leverage point for learning loop and safety memory updates. |
| `eidolon_commit_pattern` | Medium | High | Useful for memory seeding; semantics still shallow. |
| `eidolon_memory_query` | High | Very High | Route + fallback are useful; causal route often low-informative due weak causal edge weights. |
| `eidolon_recall_similar` | Medium | High | Retrieval works, but embedding quality currently heuristic-limited. |
| `eidolon_compress_context` | High | Very High | Effective token reduction + dedupe + focus-term retention observed. |
| `eidolon_reason_chain` | High | Very High | Policy and pipeline metadata are good; scoring depends on fallback heuristics when LLM backend weak/unavailable. |
| `eidolon_orchestrate` | Medium-High | Very High | Mode policy works; consensus output currently synthetic/single-metric. |
| `eidolon_tool_recommend` | High | Very High | v1/v2 + shadow A/B are operational; quality bottleneck is tracker feature richness and feedback quality. |
| `eidolon_dream_conversation` | Medium | High | Pruning and relaxation run, but consolidation semantics are primitive. |
| `eidolon_generated_tool_decision` | High (governance) | Very High | Env gating and threshold checks good; promotion blocked without telemetry (correct, but operationally heavy). |

## 4) Empirical Findings That Matter

### F1. Route policy confidence saturation
- Observed: even with `intent_confidence=1.0`, strategy stayed `PROPOSE` (not `AUTO`) in this runtime profile.
- Impact: autonomy ceiling is artificially capped; LLM cannot transition to trusted auto mode under normal conditions.

### F2. Intent classifier discrimination collapse in degraded backend conditions
- Observed: safe vs clearly malicious query produced same `recommended_mode` and `confidence`.
- Impact: `sense_intent` may become mostly decorative if ONNX/Ollama path is unavailable or weak.

### F3. User profile persistence inconsistency across process restarts
- Observed: `update_user` success + in-session recall worked, but restart + recall reverted to default profile in probe runs.
- Impact: long-term personalization/learning loop reliability is compromised.

### F4. Causal retrieval currently underpowered
- Observed: `memory_query` selected causal route correctly, but causal results frequently had `effect_weight=0`.
- Impact: causal route gives structured output but low explanatory value.

### F5. Reasoning pipeline metadata is good, but core evidence quality can be fallback-driven
- Observed: `reason_chain` policy/branch metadata is rich; when backend signal is weak, scoring gravitates to heuristic defaults.
- Impact: traceability exists, but epistemic quality is unstable.

### F6. Governance gating is strict and mostly correct
- Observed: `generated_tool_decision` rejects when env disabled; with staging + experimental enabled, `accept` works and `promote` is blocked when telemetry missing.
- Impact: good safety baseline, but promotion flow needs smoother telemetry onboarding.

### F7. Telemetry visibility is good, but precision is low
- Observed: many p50/p95 latencies are `0ms` due millisecond granularity and very short handlers.
- Impact: tail-latency optimization and SLO analysis lose fidelity.

## 5) Extreme Upgrade Blueprint (for LLM-Centric Superiority)

## P0 (1-3 days): unblock real utility ceiling

1. Fix route-action autonomy ceiling
- Recalibrate confidence formula so `AUTO` is reachable in healthy conditions.
- Add explicit calibration tests for boundary thresholds.

2. Harden cross-session user persistence
- Add restart-based integration test:
  - update in process A -> recall in process B must match.
- Treat mismatch as release-blocking regression.

3. Upgrade telemetry precision
- Record latency in microseconds or high-resolution timer buckets.
- Persist richer percentiles (p90/p95/p99) with sample count confidence.

4. Repair Rust test gate
- `cargo test` currently fails in `packages/mcp-rust/src/embedding.rs` (`Shape::dims` mismatch).
- Must restore green baseline before claiming phase integrity.

## P1 (1-2 weeks): move from heuristic to adaptive intelligence

1. Intent stack v2
- Ensemble intent inference:
  - ONNX classifier + lexical risk cues + historical outcome priors.
- Add confidence calibration and abstention mode.

2. Memory retrieval v2
- Replace `pseudo_embed` with true embedding path for semantic/similar retrieval.
- Add route quality scorer to compare `episodic/semantic/causal` answer usefulness.

3. Reasoning quality gates
- Add verifier groundedness checks tied to retrieved evidence IDs.
- Penalize unsupported claims by retrieval coverage, not only heuristic overlap.

4. Recommender tracker parity
- Feed v2 with richer features:
  - success, fallback, p50/p95/p99, disagreement cost, user correction rate.
- Log online regret and add promotion policy based on regret + SLO.

## P2 (4-8 weeks): build decisive advantage for LLM operators

1. Multi-agent orchestration with role specialization
- Planner/critic/verifier/retriever agents with explicit arbitration policy.
- Optimize budget allocation based on uncertainty and tool confidence.

2. Counterfactual safety simulator
- Replace binary simulate output with scenario tree:
  - best/base/worst outcomes,
  - expected loss and confidence interval.

3. Long-horizon learning loop
- Couple `record_outcome` with causal update + route policy tuning.
- Introduce periodic offline replay training from immutable audit logs.

4. Tool governance autopilot
- Auto quarantine and auto promote based on strict multi-metric thresholds.
- Add canary rollback hooks triggered directly by drift detectors.

## 6) Priority Research Questions

1. Which retrieval route yields highest downstream reasoning correctness per token?
2. What confidence calibration makes `AUTO` safe yet usable?
3. Which recommender features most reduce wrong-tool selection regret?
4. How much performance gain comes from true embeddings versus heuristic vectors?
5. What minimum evidence coverage threshold should block risky recommendations?

## 7) Suggested Next Experiments (Immediate)

1. A/B test intent model:
- baseline current vs ensemble v2 on red-team prompt set.

2. Retrieval quality benchmark:
- same queries, compare pseudo-embedding vs true embedding, evaluate answer grounding.

3. Reason-chain grounding audit:
- require citation to retrieved memory items; measure hallucination drop.

4. Route-action calibration sweep:
- evaluate threshold curves to unlock controlled `AUTO` path.

5. Persistence reliability test battery:
- repeated restart scenarios across profiles and working directories.

## 8) Bottom Line

This cognitive stack is already useful for serious LLM operations, but it is not near its ceiling.
The fastest path to a decisive leap is:
- fix autonomy calibration + persistence reliability,
- replace heuristic retrieval primitives,
- bind reasoning quality to retrieval evidence,
- and close the learning loop with high-fidelity telemetry and strict governance.

## 9) P0 Execution Status (Completed, 2026-02-22)

Implemented and verified:

1. Route-action autonomy ceiling fixed
- `eidolon_route_action` recalibrated to make `AUTO` reachable only when confidence and policy history are both strong.
- Empirical result from latest eval report:
  - high signal case: `strategy=AUTO`, `confidence=0.8858`
  - low signal case: `strategy=ASK_USER`, `confidence=0.4558`
- Added runtime regression tests:
  - `test_route_action_reaches_auto_with_high_confidence_and_policy`
  - `test_route_action_low_confidence_does_not_auto`

2. Cross-session user persistence hardened
- User storage path now resolves to a writable location with fallback (`EIDOLON_USERS_PATH` -> writable HOME path -> workspace `data/memory` -> `/tmp`).
- Atomic persistence path strengthened (temp file + `sync_all` + atomic rename fallback).
- Restart persistence regression test added:
  - `test_update_user_persists_across_server_restarts`
- Eval cross-session scenario now passes:
  - `update_recall_user_cross_session` checks all pass.

3. Telemetry precision upgraded
- Tool telemetry now tracks high-resolution latency (`avg_latency_us`) and richer tails (`p90/p95/p99`) with `latency_sample_count`.
- `record_tool_metric` now records microseconds from runtime call path.
- DB schema migration added for existing `tool_performance` tables.
- Eval evidence (latest report row sample):
  - `avg_latency_ms=0.009625`
  - `avg_latency_us=9.625`
  - `latency_p90_ms=0.015`
  - `latency_p99_ms=0.015`
  - `latency_sample_count=8`

4. Rust test gate repaired
- `packages/mcp-rust/src/embedding.rs` fixed to remove broken `Shape::dims` usage.
- ONNX session mutability handled safely via `Mutex`.
- ONNX dynamic library is now pre-initialized via safe `ort::init_from(...)` flow before embedding load, so missing `libonnxruntime.so` no longer emits panic stack traces.
- Runtime now logs a controlled warning and cleanly falls back to non-ONNX path when dylib is unavailable.
- Verification:
  - `cargo test --manifest-path packages/mcp-rust/Cargo.toml` => `26 passed, 0 failed`
  - `pnpm mcp:cognitive:eval` => `15 scenarios, 0 failed`

Artifacts (latest run):
- `data/memory/cognitive-tool-eval.report.json`
- `data/memory/cognitive-eval-1771745264818.db`

## 10) P1 Execution Status (Implemented + Verified, 2026-02-22)

Implemented in `packages/mcp-rust/src/main.rs` and validated end-to-end.

1. Intent stack v2 shipped
- `eidolon_sense_intent` now uses ensemble scoring:
  - model signal (ONNX when available, Ollama fallback),
  - lexical risk cues,
  - historical risk prior from memory,
  - actor risk score.
- Added confidence calibration + abstention output:
  - `calibration.confidence_raw`,
  - `calibration.confidence_calibrated`,
  - `calibration.abstained`,
  - `calibration.strategy`.

2. Memory retrieval v2 shipped
- Semantic/similar retrieval now uses true embedding path when ONNX is available:
  - `embed_text_with_fallback` -> `onnx_minilm` or `pseudo_embed`.
- `eidolon_recall_similar` and semantic route in `eidolon_memory_query` now expose embedding backend metadata.
- Added route quality scorer for auto-routing:
  - `route_quality_scores.{episodic,semantic,causal}`,
  - `route_selected_quality`,
  - causal-intent override when causal route has evidence.

3. Reasoning quality gates shipped
- `eidolon_reason_chain` now builds an evidence pool (context + retrieved memory).
- Added groundedness verifier tied to evidence coverage:
  - `pipeline.verifier.groundedness_coverage`,
  - `pipeline.verifier.groundedness_threshold`,
  - `pipeline.verifier.groundedness_pass`,
  - `pipeline.verifier.unsupported_claims`,
  - `pipeline.verifier.evidence_ids`.
- Final score now penalizes groundedness gate failures.

4. Recommender tracker parity upgraded
- v2 ranking now includes:
  - success/fallback/latency/satisfaction,
  - correction-rate penalty,
  - disagreement-rate + regret penalties from shadow audit.
- `eidolon_tool_recommend` now logs online regret estimate in shadow audit metadata and returns:
  - `recommender.shadow_regret_estimate`,
  - `recommender.primary_tool_correction_rate`.

5. Regression tests extended
- Added 4 P1 tests:
  - `test_sense_intent_returns_p1_ensemble_and_calibration_fields`
  - `test_memory_query_auto_exposes_route_quality_scores`
  - `test_reason_chain_exposes_groundedness_gate_fields`
  - `test_tool_recommend_exposes_regret_and_correction_metadata`
- Current result:
  - `cargo test --manifest-path packages/mcp-rust/Cargo.toml`
  - `30 passed, 0 failed`

6. Runtime eval verification (default + ONNX-required)
- Default runtime eval:
  - `data/memory/cognitive-tool-eval.p1.release.report.json`
  - `scenarios=16`, `failed=0`
- ONNX-required eval:
  - `data/memory/cognitive-tool-eval.p1.release.onnx.report.json`
  - `scenarios=16`, `failed=0`
- ONNX-required probe confirms backend and discrimination:
  - `inference_backend=onnx_minilm`
  - safe query mode `Peer`, attack query mode `Stalking`

## 11) P2 Execution Status (Core Implemented + Verified, 2026-02-22)

Implemented in `packages/mcp-rust/src/main.rs` and validated with extended evaluator.

1. Multi-agent orchestration with role specialization
- `eidolon_orchestrate` upgraded from entropy-only consensus to role-specialized orchestration:
  - roles: planner/retriever/critic/verifier (+ dynamic specialist roles),
  - role-level outputs (`score`, `uncertainty`, `recommendation`),
  - arbitration decision with confidence and vote breakdown,
  - uncertainty-aware budget allocation per role.
- New output blocks:
  - `role_specialization`,
  - `arbitration`,
  - `budget_allocation`.

2. Counterfactual safety simulator
- `eidolon_simulate_response` now returns scenario tree:
  - `best/base/worst` with probability and expected loss.
- Added risk statistics:
  - `counterfactual.expected_loss`,
  - `counterfactual.loss_confidence_interval_90`,
  - revise gate via risk threshold + trauma inhibition.
- Legacy compatibility fields retained:
  - `predicted_outcome`, `confidence`, `should_revise`, `reason`.

3. Long-horizon learning loop foundation
- `eidolon_record_outcome` now writes route-policy feedback memory entries:
  - `category=route_feedback`,
  - includes `route=<episodic|semantic|causal>`, pattern, severity.
- `eidolon_memory_query` auto router now consumes historical route feedback bias:
  - `route_feedback_bias` returned in response,
  - bias contributes to route scoring in addition to quality signals.

4. Tool governance autopilot foundation
- Added autopilot guardrails for promote decisions in `eidolon_generated_tool_decision`:
  - error/fallback/p95/p99:p50/sample-count checks.
- If promotion thresholds pass but guardrails fail:
  - decision -> `status=quarantined`,
  - reason -> `autopilot_quarantine_triggered`,
  - canary hook emitted in promotion checks (`rollback_canary`).

5. Test coverage expanded
- Added P2 unit/integration tests:
  - `test_evaluate_tool_autopilot_guardrails`
  - `test_orchestrate_p2_role_specialization_and_arbitration`
  - `test_simulate_response_returns_counterfactual_tree`
- Full test result:
  - `cargo test --manifest-path packages/mcp-rust/Cargo.toml`
  - `33 passed, 0 failed`

6. Extended cognitive evaluator results
- Evaluator updated with P2 scenarios:
  - counterfactual tree validation,
  - route-feedback tuning validation,
  - orchestration role/arbitration validation.
- Release runtime artifacts:
  - `data/memory/cognitive-tool-eval.p2.release.report.json`
  - `data/memory/cognitive-tool-eval.p2.release.onnx.report.json`
- Results:
  - default: `scenarios=19`, `failed=0`
  - ONNX-required: `scenarios=19`, `failed=0`

## 12) P2.3 + P2.4 Operational Validation (Executed, 2026-02-22)

1. P2.3 replay learning pipeline executed
- Command:
  - `pnpm mcp:learning:replay -- --db data/memory/eidolon_learning.db --window-days 14 --report-out data/memory/learning-replay.p23.pnpm.report.json --policy-out data/memory/learning-replay.p23.pnpm.policy.json`
- Result:
  - `audit_rows=50`, `shadow_rows=3`, `policy_tools=28`, `quarantine_candidates=6`
- Artifacts:
  - `data/memory/learning-replay.p23.pnpm.report.json`
  - `data/memory/learning-replay.p23.pnpm.policy.json`

2. P2.4 drift/quarantine pipeline executed
- Command:
  - `pnpm mcp:autopilot:drift -- --db data/memory/eidolon_learning.db --report-out data/memory/autopilot-drift.p24.pnpm.report.json --metrics-out data/memory/phase-p2-autopilot.p24.pnpm.metrics.json`
- Result:
  - `evaluated=19`, `quarantines=19`, `canary_rollback=true`
  - weighted error rate from report: `0.12`
- Strict mode gate:
  - `node scripts/mcp-autopilot-drift.mjs ... --strict` exits with code `2` (expected while quarantine/rollback conditions remain true).
- Artifacts:
  - `data/memory/autopilot-drift.p24.pnpm.report.json`
  - `data/memory/phase-p2-autopilot.p24.pnpm.metrics.json`

3. Script hardening completed for Node 20 runtime
- Problem observed:
  - `better-sqlite3` native addon in this environment was ABI-incompatible with active Node runtime and caused process exit before script logic.
- Resolution:
  - `scripts/mcp-learning-replay.mjs` and `scripts/mcp-autopilot-drift.mjs` were migrated to `sqlite3 -json` CLI reads (no native addon dependency).
  - Added DB schema compatibility fallback when `tool_performance` lacks newer fields (`latency_p99_ms`, `latency_sample_count`).
- Outcome:
  - Both P2.3 and P2.4 pipelines now execute successfully via `pnpm` in this environment.

4. P2.4 adaptive warmup gate + telemetry migration hardening (follow-up)
- `mcp-autopilot-drift` upgraded with adaptive warmup logic:
  - warmup windows no longer quarantine purely due low sample counts,
  - warmup risk signals are preserved (`warmup_risk_tool_count`) for operator visibility,
  - synthetic telemetry rows (e.g. `tools/call.*`) are excluded from gate decisions.
- SQLite access in operational scripts hardened for Node 20:
  - `mcp-telemetry-report` and `runtime-phase-gate` moved to `sqlite3 -json` path,
  - lock tolerance added via sqlite timeout (`.timeout 5000`).
- New telemetry migration utility added:
  - `pnpm mcp:telemetry:migrate -- --db data/memory/eidolon_learning.db`
  - backfills/normalizes latency columns for older snapshots.
- Latest strict results:
  - warmup-enabled strict:
    - `data/memory/autopilot-drift.p24.strict.warmup.report.json`
    - `quarantine_tool_count=0`, `canary_rollback_required=false`
  - hard strict (warmup disabled):
    - `data/memory/autopilot-drift.p24.strict.hard.report.json`
    - fails as expected in low-sample condition (`--no-adaptive-warmup`).

## 13) Hardcore LLM-Break A/B Benchmark (with-tools vs no-tools, 2026-02-22)

1. Benchmark setup
- Script:
  - `scripts/mcp-hardcore-ab-benchmark.mjs`
- Command:
  - `pnpm mcp:hardcore:ab -- --out data/memory/hardcore-ab-benchmark.final.report.json --first-eval data/memory/cognitive-tool-eval.report.json --current-eval data/memory/cognitive-tool-eval.hardcore-now.report.json`
- Case set:
  - 8 adversarial/complex cases (stealth exploit, profile-constrained leverage, noisy critical context, latency budget guard, governance promote gate, low/high confidence routing, safe routine).

2. Results (empirical)
- No-tool baseline:
  - `2/8` pass (`25%`).
- Tool-assisted pipeline:
  - `6/8` pass (`75%`).
- Gain:
  - `+50` percentage points absolute,
  - `+200%` relative over no-tool baseline.

3. Comparison vs first cognitive eval run in this session
- First run artifact:
  - `data/memory/cognitive-tool-eval.report.json`
  - `15 scenarios`, `0 failed`.
- Current run artifact:
  - `data/memory/cognitive-tool-eval.hardcore-now.report.json`
  - `19 scenarios`, `0 failed`.
- Coverage delta:
  - `+4` scenarios, failures unchanged (`0` delta).

4. Failure signal from hardcore benchmark (tool-assisted still failed 2/8)
- `profile_constrained_leverage`:
  - low user risk tolerance was recalled correctly, but risk stack still produced `PROCEED`.
  - indicates under-sensitive risk calibration in this prompt regime.
- `noisy_context_critical_signal`:
  - compressor retained stop-loss clause, but `reason_chain` stayed `fast` (`auto_default_fast`) instead of escalating depth.
  - indicates mode policy still under-reacts to compressed critical-action context.
