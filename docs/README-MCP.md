# 🔌 EIDOLON-V MCP SERVER

This module exposes **Eidolon-BNB** as a Model Context Protocol (MCP) server, allowing AI agents (like Antigravity, Claude, or Cursor) to directly interact with the DeFi, Security, and Oracle modules.

## 🚀 Quick Start

### 1. Run via Command Line
You can test the server directly:
```bash
pnpm mcp
```
*Note: It runs on `stdio`, so you won't see output unless you pipe it to an MCP client.*

Run rollout preflight before staging/prod:
```bash
pnpm mcp:preflight -- --profile staging
pnpm mcp:preflight -- --profile production
```

Run phase gate checks against metrics snapshots:
```bash
pnpm mcp:phase-gate -- --phase A --metrics path/to/metrics.json
pnpm mcp:phase-gate -- --phase B --metrics path/to/metrics.json
```

### 2. Configure in Antigravity / Claude Desktop
Add this to your `mcp-config.json` (or equivalent settings):

```json
{
  "mcpServers": {
    "eidolon-eidolon": {
      "command": "pnpm",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/eidolon-bnb",
      "env": {
        "PRIVATE_KEY": "YOUR_PRIVATE_KEY_HERE" 
      }
    }
  }
}
```
> ⚠️ **SECURITY WARNING:** The `PRIVATE_KEY` is required for signing transactions, but for read-only tools (Oracle/Scan), you can use a dummy key or omit it (if the server supports fallback).

## 🛠 Available Tools

| Tool | Description |
| :--- | :--- |
| `eidolon_oracle_sense` | **Omniscient Oracle:** Get real-time price, gas, and liquidity depth (THIN/DEEP). |
| `eidolon_defi_quote` | **Hyper-Routing:** Get the best swap quote across all V3 fee tiers. |
| `eidolon_security_scan` | **Anti-Rug:** Scan a contract for honeypots, ownership issues, and risks. |
| `...` | Legacy `eidolon_*` and Cognitive `eidolon_*` run in dual-stack mode. |

## 📦 Resources

| URI | Description |
| :--- | :--- |
| `eidolon://bioreactor` | Real-time biological state (Glucose / Dopamine / Cortisol). |
| `eidolon://logs` | Live "Thought Stream" from the agent's brain. |
| `eidolon://telemetry` | Tool-level call/error/latency/fallback telemetry + rollout state. |
| `eidolon://generated-tool-audit` | Accepted/rejected generated-tool audit log. |
| `eidolon://contracts` | Runtime/MCP compatibility contract manifest (dual-stack + rollout). |

## 🎛 Rollout Profiles

Environment templates:
- `packages/mcp-rust/env/mcp.development.env.example`
- `packages/mcp-rust/env/mcp.staging.env.example`
- `packages/mcp-rust/env/mcp.production.env.example`

Key rollout flags:
- `COGNITIVE_CANARY_PERCENT`
- `COGNITIVE_AUTO_ROLLBACK_ERROR_RATE`
- `COGNITIVE_AUTO_ROLLBACK_P95_MS`
- `COGNITIVE_AUTO_ROLLBACK_MIN_CALLS`
- `TOOL_GEN_EXPERIMENTAL_ENABLED`
- `TOOL_GEN_MAX_DYNAMIC_TOOLS`

Detailed rollout runbook: `docs/MCP_ROLLOUT.md`
Runtime contract freeze artifacts: `docs/runtime-migration/contracts/runtime-v1/`

## 🧠 System Architecture

The MCP server wraps the core `Eidolon` instance:
1.  **Antigravity** sends a JSON-RPC request (e.g., `call_tool`).
2.  **MCP Server** translates this to a `Eidolon` method call (e.g., `kit.defi.getRealQuote`).
3.  **Eidolon** queries the blockchain (opBNB) via `viem`.
4.  **Result** is returned as a structured text response.
