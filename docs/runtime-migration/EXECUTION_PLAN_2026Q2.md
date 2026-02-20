# ClawKit Runtime Migration Execution Map (Start: 2026-02-20)

## Timeline

1. 2026-02-20 -> 2026-03-06: Phase A (Architecture Freeze + Contracts)
2. 2026-03-07 -> 2026-04-03: Phase B (Memory Platform Cutover)
3. 2026-04-04 -> 2026-05-01: Phase C (Rust Orchestrator + Reasoning Runtime)
4. 2026-05-02 -> 2026-05-22: Phase D (Context Engine + FastCDC)
5. 2026-05-23 -> 2026-06-12: Phase E (ToolGen Secure Runtime)
6. 2026-06-13 -> 2026-07-10: Phase F (Rust MCP Primary + Node Sunset)

## Current implementation status

### Phase A
- [x] Runtime service contracts frozen in `docs/runtime-migration/contracts/runtime-v1/*.proto`.
- [x] MCP compatibility contract frozen in `docs/runtime-migration/contracts/runtime-v1/mcp-compatibility.contract.json`.
- [x] Node gateway accepts dual call payload shape (`name|tool`, `arguments|input`).
- [x] SLO gate spec + checker script added (`phase-gates.v1.json`, `runtime-phase-gate.mjs`).
- [x] Contract and gate tests added.

### Phase B (prepared, not cutover yet)
- [ ] Rust `memory-service` with Qdrant/sqlite-vss ANN runtime.
- [ ] Backfill + re-embed jobs with dual-write window (2-4 weeks).
- [ ] Shadow-read rollout 10% -> 50% -> 100%.

### Phase C-F
- [ ] Pending implementation according to phase gates in `docs/runtime-migration/slo/phase-gates.v1.json`.

## Rollout discipline

- Every phase must keep shadow mode + auto rollback.
- Promotion requires 7 consecutive green days.
- Canary progression target: 5% -> 10% -> 25% -> 50% -> 100%.
