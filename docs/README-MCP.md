# 🔌 EIDOLON-V MCP SERVER

This module exposes **ClawKit-BNB** as a Model Context Protocol (MCP) server, allowing AI agents (like Antigravity, Claude, or Cursor) to directly interact with the DeFi, Security, and Oracle modules.

## 🚀 Quick Start

### 1. Run via Command Line
You can test the server directly:
```bash
npm run mcp
```
*Note: It runs on `stdio`, so you won't see output unless you pipe it to an MCP client.*

### 2. Configure in Antigravity / Claude Desktop
Add this to your `mcp-config.json` (or equivalent settings):

```json
{
  "mcpServers": {
    "clawkit-eidolon": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/clawkit-bnb",
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

## 📦 Resources

| URI | Description |
| :--- | :--- |
| `eidolon://bioreactor` | Real-time biological state (Glucose / Dopamine / Cortisol). |
| `eidolon://logs` | Live "Thought Stream" from the agent's brain. |

## 🧠 System Architecture

The MCP server wraps the core `ClawKit` instance:
1.  **Antigravity** sends a JSON-RPC request (e.g., `call_tool`).
2.  **MCP Server** translates this to a `ClawKit` method call (e.g., `kit.defi.getRealQuote`).
3.  **ClawKit** queries the blockchain (opBNB) via `viem`.
4.  **Result** is returned as a structured text response.
