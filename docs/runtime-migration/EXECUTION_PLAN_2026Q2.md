# Eidolon Runtime Migration Execution Map (v2, Updated: 2026-02-21)

This plan is execution-first: every phase has deliverables, measurable evidence, and a hard promotion gate.

## 0) Baseline Snapshot (as of 2026-02-21)

### Already done
- [x] MCP compatibility contract frozen:
  - `docs/runtime-migration/contracts/runtime-v1/mcp-compatibility.contract.json`
- [x] `tools/call` contract parity shipped:
  - accepts `name|tool` and `arguments|input`
  - uses `structured_mcp_error` for invalid params + tool not found
- [x] `resources/templates/list` minimum spec shipped (`resourceTemplates: []`)
- [x] `tools/list` now dual-stack contract-compatible:
  - exposes both `eidolon_*` and `eidolon_*`
  - includes required legacy list in frozen contract
- [x] `generated_tool_audit` has SQLite write path and is logged on `tools/call`
- [x] MCP Rust contract tests cover:
  - call-field compatibility
  - structured error mode
  - dual-stack list presence
  - generated-tool audit persistence

### Remaining high-impact gaps
- [ ] P2.4 strict autopilot gate still fails in low-sample windows without warmup policy tuning + rollout criteria.
- [ ] P2.3 offline replay output is generated, but online recommender ingestion/apply loop is not yet auto-wired.

## 1) Timeline and Workstreams

1. 2026-02-21 -> 2026-03-06: Phase A Close (Contract + Compatibility Hard Lock)
2. 2026-03-07 -> 2026-04-03: Phase B (Telemetry-to-Decision and Memory Cutover start)
3. 2026-04-04 -> 2026-05-01: Phase C (Reasoning/Orchestration Runtime Upgrade)
4. 2026-05-02 -> 2026-05-22: Phase D (Context + Retrieval Quality)
5. 2026-05-23 -> 2026-06-12: Phase E (ToolGen Secure Runtime)
6. 2026-06-13 -> 2026-07-10: Phase F (Rust MCP Primary + Node Sunset)

## 2) Phase-by-Phase Definition of Done

### Phase A Close (2026-02-21 -> 2026-03-06)

#### Deliverables
- [x] MCP dual-stack tool listing contract parity.
- [x] `tools/call` compatibility gate tests (`name|tool`, `arguments|input`).
- [x] Structured error compatibility gate (`structured_mcp_error`).
- [x] `resources/templates/list` minimum response contract.
- [x] Audit persistence path for `generated_tool_audit` from MCP runtime.

#### Exit evidence
- `cargo test --manifest-path packages/mcp-rust/Cargo.toml`
- `pnpm mcp:preflight -- --profile staging`
- `pnpm mcp:phase-gate -- --phase A --metrics docs/runtime-migration/slo/metrics.example.json`

### Phase B (2026-03-07 -> 2026-04-03): Decision-quality telemetry + memory routing foundation

#### Deliverables
- [x] Replace heuristic recommendation path with tracker-driven ranking contract:
  - input features: success rate, `fallback_rate`, p50/p95, user satisfaction.
  - deterministic fallback for cold-start.
- [x] Add shadow A/B path for recommender:
  - `recommender=v1|v2`, decision diff log, no user-visible impact in shadow mode.
- [x] Gate promotion with phase checker and telemetry breaches:
  - no promote when error/p95 breach persists over min calls.
- [x] Start memory router integration for `memory_query` (episodic + semantic + causal route tags).

#### Exit evidence
- `pnpm mcp:telemetry:report -- --min-calls 30`
- A/B diff report artifact in `data/memory` (or equivalent stable path)
- `pnpm mcp:phase-gate -- --phase B --metrics <phase-b-metrics.json> --telemetry-db data/memory/eidolon_learning.db`

### Phase C (2026-04-04 -> 2026-05-01): reasoning/orchestration runtime alignment

#### Deliverables
- [x] Route `reason_chain` via target reasoning runtime (critic/ToT/verifier interfaces).
- [x] Add latency and quality probes for reasoning path.
- [x] Introduce orchestrator policy to choose fast/deep modes based on runtime confidence and SLO budget.

#### Exit evidence
- Orchestration p95 and throughput metrics satisfy `phase-gates.v1.json` phase C.
- `pnpm mcp:phase-gate -- --phase C --metrics <phase-c-metrics.json> --telemetry-db data/memory/eidolon_learning.db`

### Phase D (2026-05-02 -> 2026-05-22): context engine quality

#### Deliverables
- [x] Route `compress_context` via target context compressor (importance + dedupe).
- [x] Add factual retention benchmark and token reduction benchmark to CI artifacts.

#### Exit evidence
- `min_mcp_token_reduction_ratio` and `min_factual_retention` pass in phase gate.
- `pnpm mcp:context:benchmark -- --strict --min-token-reduction 0.3 --min-factual-retention 0.9`
- `pnpm mcp:phase-gate -- --phase D --metrics data/memory/phase-d-metrics.json --telemetry-db data/memory/eidolon_learning.db`

### Phase E (2026-05-23 -> 2026-06-12): secure tool generation runtime

#### Deliverables
- [x] Tool generation enabled only in allowed environments.
- [x] Immutable audit log for generated tool accept/reject/promote decisions.
- [x] Enforce promote thresholds (error rate, p95, fallback rate, satisfaction).

#### Exit evidence
- Security suite pass rate = 1.0.
- `generated_tool_audit` records acceptance/rejection provenance with immutable fields.
- `pnpm mcp:security:suite -- --strict --report-out data/memory/security-suite.report.json --metrics-out data/memory/phase-e-metrics.json`
- `pnpm mcp:phase-gate -- --phase E --metrics data/memory/phase-e-metrics.json --telemetry-db data/memory/eidolon_learning.db`

### Phase F (2026-06-13 -> 2026-07-10): rust primary runtime + controlled sunset

#### Deliverables
- [x] Rust MCP declared primary runtime in production.
- [x] Keep rollback drill documented and re-runnable.
- [x] Track residual legacy usage and stay under sunset threshold.

#### Exit evidence
- 30 stable production days.
- Rollback drill passed.
- `max_eidolon_usage_ratio` gate pass.
- `pnpm mcp:rollback:drill -- --profile production --strict --report-out data/memory/rollback-drill.report.json`
- `pnpm mcp:phase-f:metrics -- --strict --primary-runtime rust --prod-stable-days 30 --rollback-report data/memory/rollback-drill.report.json --report-out data/memory/phase-f.report.json --metrics-out data/memory/phase-f-metrics.json`
- `pnpm mcp:phase-gate -- --phase F --metrics data/memory/phase-f-metrics.json --telemetry-db data/memory/eidolon_learning.db`

## 3) Operating Rules (Non-Negotiable)

- Every phase uses shadow mode and auto-rollback.
- Promotion requires 7 consecutive green days.
- Canary progression target: `5% -> 10% -> 25% -> 50% -> 100%`.
- If any gate fails: freeze promotion, rollback canary, open remediation item with owner + due date.

## 4) Immediate Backlog (next 10 working days)

1. Recommender v2 integration plan:
   - define interface parity with existing `eidolon_tool_recommend` output
   - add A/B shadow result schema + storage
2. Memory router cutover plan:
   - route map for `memory_query` and fallback strategy
3. Context compressor cutover plan:
   - benchmark dataset + acceptance thresholds (done in Phase D)
4. Reasoning chain cutover plan:
   - mode policy (fast/deep) + evaluator metrics (done in Phase C)
5. Generated tool governance:
   - enforce promote/reject thresholds from telemetry + immutable audit record schema (done in Phase E)

## 5) Risk Register and Countermeasures

- Risk: dual-stack drift (`eidolon_*` docs vs runtime list).
  - Countermeasure: keep contract test that asserts required legacy + cognitive names.
- Risk: telemetry present but not actionable.
  - Countermeasure: block promote unless phase-gate metrics are generated from DB-backed telemetry.
- Risk: shadow mode exists but unobserved.
  - Countermeasure: require A/B diff artifact per deploy window before canary increase.
- Risk: generated tools bypass policy.
  - Countermeasure: only allow promote when audit record has accepted status + threshold evidence.

## 6) Command Checklist

```bash
# Build + tests
cargo test --manifest-path packages/mcp-rust/Cargo.toml

# Rollout config safety
pnpm mcp:preflight -- --profile staging
pnpm mcp:preflight -- --profile production

# Telemetry breach report
pnpm mcp:telemetry:report -- --max-error-rate 0.2 --max-p95-ms 2200 --min-calls 30

# Telemetry schema migrate/backfill for older DB snapshots
pnpm mcp:telemetry:migrate -- --db data/memory/eidolon_learning.db

# P2.3 offline replay learning from immutable audit logs
pnpm mcp:learning:replay -- --db data/memory/eidolon_learning.db --window-days 14 --report-out data/memory/learning-replay.report.json --policy-out data/memory/learning-replay.policy.json

# P2.4 autopilot drift/quarantine + canary rollback hooks
pnpm mcp:autopilot:drift -- --db data/memory/eidolon_learning.db --report-out data/memory/autopilot-drift.report.json --metrics-out data/memory/phase-p2-autopilot-metrics.json
pnpm mcp:autopilot:drift -- --db data/memory/eidolon_learning.db --report-out data/memory/autopilot-drift.strict.report.json --metrics-out data/memory/phase-p2-autopilot.strict-metrics.json --strict
# disable warmup exemption for full hard gate (burn-in complete)
pnpm mcp:autopilot:drift -- --db data/memory/eidolon_learning.db --report-out data/memory/autopilot-drift.strict-hard.report.json --metrics-out data/memory/phase-p2-autopilot.strict-hard-metrics.json --strict --no-adaptive-warmup

# Phase E security suite
pnpm mcp:security:suite -- --strict --report-out data/memory/security-suite.report.json --metrics-out data/memory/phase-e-metrics.json

# Phase F rollback drill + metrics
pnpm mcp:rollback:drill -- --profile production --strict --report-out data/memory/rollback-drill.report.json
pnpm mcp:phase-f:metrics -- --strict --primary-runtime rust --prod-stable-days 30 --rollback-report data/memory/rollback-drill.report.json --report-out data/memory/phase-f.report.json --metrics-out data/memory/phase-f-metrics.json

# Phase gate evaluation
pnpm mcp:phase-gate -- --phase A --metrics docs/runtime-migration/slo/metrics.example.json
pnpm mcp:phase-gate -- --phase E --metrics data/memory/phase-e-metrics.json --telemetry-db data/memory/eidolon_learning.db
pnpm mcp:phase-gate -- --phase F --metrics data/memory/phase-f-metrics.json --telemetry-db data/memory/eidolon_learning.db
```

## 7) LLM Operator Assets (added 2026-02-22)

- Cognitive tool operator playbook:
  - `docs/runtime-migration/COGNITIVE_TOOL_OPERATOR_PLAYBOOK.md`
- System prompt + JSON-RPC template to enforce tool usage policy:
  - `docs/runtime-migration/COGNITIVE_TOOL_SYSTEM_PROMPT_TEMPLATE.md`
- Empirical test + extreme upgrade research report:
  - `docs/runtime-migration/COGNITIVE_TOOL_EXTREME_UPGRADE_RESEARCH_2026-02-22.md`
