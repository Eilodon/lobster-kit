# Runtime Contracts v1 (Phase A Freeze)

Date frozen: 2026-02-20

Scope:
- Rust service IDL contracts for `memory`, `orchestrator`, `context`, `toolgen`
- Node compatibility gateway contract for MCP `ListTools` / `CallTool`
- SLO gate inputs for promotion/rollback decisions

Files:
- `common.proto`
- `memory.proto`
- `orchestrator.proto`
- `context.proto`
- `toolgen.proto`
- `mcp-compatibility.contract.json`

Compatibility rules:
- `eidolon_*` tools remain stable during dual-stack window.
- `eidolon_*` tools canary-gated and auto-rollback capable.
- Gateway accepts both modern and legacy call payload shape.
- Legacy DeFi bridge tools run in compatibility mode only and are disabled by default unless `LEGACY_DEFI_COMPAT_ENABLED=true`.

Promotion rule:
- A phase is promoted only after previous phase SLOs are green for 7 consecutive days.
