# MCP Cognitive Rollout Runbook

## 1. Profiles

Use one of these templates:
- `packages/mcp-rust/env/mcp.development.env.example`
- `packages/mcp-rust/env/mcp.staging.env.example`
- `packages/mcp-rust/env/mcp.production.env.example`

Suggested progression:
1. `development`: canary 100%, experimental tool gen allowed.
2. `staging`: canary 10%, strict auto-rollback.
3. `production`: canary 5% initially, gradual increase based on telemetry.

## 2. Preflight

Validate configuration before deploy:
```bash
pnpm mcp:preflight -- --profile staging
pnpm mcp:preflight -- --profile production
```

Custom env file:
```bash
pnpm mcp:preflight -- --env-file path/to/your.env
```

## 3. Key Gates

- `COGNITIVE_CANARY_PERCENT`: rollout percentage for `eidolon_*`.
- `COGNITIVE_AUTO_ROLLBACK_ERROR_RATE`: automatic disable threshold.
- `COGNITIVE_AUTO_ROLLBACK_P95_MS`: latency rollback threshold.
- `COGNITIVE_AUTO_ROLLBACK_MIN_CALLS`: minimum calls before rollback decisions.
- `COGNITIVE_RECOMMENDER_PRIMARY`: recommender model serving (`v1` or `v2`).
- `COGNITIVE_RECOMMENDER_SHADOW`: shadow comparison model (`v1` or `v2`).
- `COGNITIVE_REASONING_LATENCY_BUDGET_MS`: budget used by reasoning/orchestrator auto mode policy.
- `TOOL_GEN_EXPERIMENTAL_ENABLED`: keep `false` outside development.
- `TOOL_GEN_MAX_DYNAMIC_TOOLS`: hard cap for generated tools.
- `TOOL_GEN_ALLOWED_ENVS`: explicit env allow-list for tool generation runtime.
- `TOOL_GEN_PROMOTE_MIN_CALLS`: minimum telemetry calls before promote.
- `TOOL_GEN_PROMOTE_MAX_ERROR_RATE`: max error rate threshold for promote.
- `TOOL_GEN_PROMOTE_MAX_P95_MS`: max p95 latency threshold for promote.
- `TOOL_GEN_PROMOTE_MAX_FALLBACK_RATE`: max fallback ratio threshold for promote.
- `TOOL_GEN_PROMOTE_MIN_SATISFACTION`: minimum user satisfaction threshold for promote.
- `MCP_PRIMARY_RUNTIME`: canonical runtime selector (`rust` for production rollout).

## 4. Runtime Observability

Use MCP resources:
- `eidolon://telemetry`: per-tool telemetry and rollout state.
- `eidolon://generated-tool-audit`: generated-tool accept/reject audit log.
- `eidolon://recommender-shadow`: shadow A/B diff log for recommender v1 vs v2.

CLI report from SQLite:
```bash
pnpm mcp:telemetry:report -- --max-error-rate 0.2 --max-p95-ms 2200 --min-calls 30
```

## 5. Incident Response

If cognitive tools degrade:
1. Set `COGNITIVE_CANARY_PERCENT=0`.
2. Restart MCP server.
3. Confirm rollback state in `eidolon://telemetry`.
4. Inspect failed tools and generated-tool audit logs.

## 6. Phase Promotion Gate

Run phase SLO gate checks from telemetry-derived metrics snapshots:
```bash
pnpm mcp:phase-gate -- --phase A --metrics path/to/metrics.json
pnpm mcp:phase-gate -- --phase B --metrics path/to/metrics.json --telemetry-db data/memory/eidolon_learning.db

# Phase D benchmark + gate
pnpm mcp:context:benchmark -- --strict --min-token-reduction 0.3 --min-factual-retention 0.9
pnpm mcp:phase-gate -- --phase D --metrics data/memory/phase-d-metrics.json --telemetry-db data/memory/eidolon_learning.db

# Phase E security suite + gate
pnpm mcp:security:suite -- --strict --report-out data/memory/security-suite.report.json --metrics-out data/memory/phase-e-metrics.json
pnpm mcp:phase-gate -- --phase E --metrics data/memory/phase-e-metrics.json --telemetry-db data/memory/eidolon_learning.db

# Phase F rollback drill + legacy sunset gate
pnpm mcp:rollback:drill -- --profile production --strict --report-out data/memory/rollback-drill.report.json
pnpm mcp:phase-f:metrics -- --strict --primary-runtime rust --prod-stable-days 30 --rollback-report data/memory/rollback-drill.report.json --report-out data/memory/phase-f.report.json --metrics-out data/memory/phase-f-metrics.json
pnpm mcp:phase-gate -- --phase F --metrics data/memory/phase-f-metrics.json --telemetry-db data/memory/eidolon_learning.db
```

Default SLO contract:
- `docs/runtime-migration/slo/phase-gates.v1.json`
- `docs/runtime-migration/slo/metrics.example.json` (input template)

Runtime + MCP contract freeze files:
- `docs/runtime-migration/contracts/runtime-v1/`
