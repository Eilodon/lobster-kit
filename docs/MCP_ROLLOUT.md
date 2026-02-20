# MCP Cognitive Rollout Runbook

## 1. Profiles

Use one of these templates:
- `packages/mcp/env/mcp.development.env.example`
- `packages/mcp/env/mcp.staging.env.example`
- `packages/mcp/env/mcp.production.env.example`

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

- `COGNITIVE_CANARY_PERCENT`: rollout percentage for `clawkit_*`.
- `COGNITIVE_AUTO_ROLLBACK_ERROR_RATE`: automatic disable threshold.
- `COGNITIVE_AUTO_ROLLBACK_P95_MS`: latency rollback threshold.
- `COGNITIVE_AUTO_ROLLBACK_MIN_CALLS`: minimum calls before rollback decisions.
- `TOOL_GEN_EXPERIMENTAL_ENABLED`: keep `false` outside development.
- `TOOL_GEN_MAX_DYNAMIC_TOOLS`: hard cap for generated tools.

## 4. Runtime Observability

Use MCP resources:
- `eidolon://telemetry`: per-tool telemetry and rollout state.
- `eidolon://generated-tool-audit`: generated-tool accept/reject audit log.

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
pnpm mcp:phase-gate -- --phase B --metrics path/to/metrics.json
```

Default SLO contract:
- `docs/runtime-migration/slo/phase-gates.v1.json`
- `docs/runtime-migration/slo/metrics.example.json` (input template)

Runtime + MCP contract freeze files:
- `docs/runtime-migration/contracts/runtime-v1/`
