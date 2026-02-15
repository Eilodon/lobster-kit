# 🔌 EIDOLON-V MCP SERVER

## 🎯 Goal
Expose ClawKit-BNB's internal "God-tier" modules as a standard MCP server for Antigravity and other LLM clients.

## 🛠 Tools to Expose
1. **`eidolon_oracle_sense`**: 
   - Inputs: `symbol` (e.g., 'WBNB'), `amount` (optional)
   - Outputs: Real-time price, gas state, and liquidity depth (THIN/DEEP).
   - Backend: Wraps `ClawOracle.sense()`.

2. **`eidolon_defi_quote`**: 
   - Inputs: `tokenIn`, `tokenOut`, `amount`, `slippage`
   - Outputs: Best execution route and expected output.
   - Backend: Wraps `DeFiModule.getRealQuote()` (Hyper-Routing).

3. **`eidolon_security_scan`**: 
   - Inputs: `tokenAddress`
   - Outputs: Risk score, honeypot status, owner info.
   - Backend: Wraps `SecurityModule.scan()`.

4. **`eidolon_consult`**:
   - Inputs: `context`
   - Outputs: Strategic advice from the "Emotional Core" (Buy/Sell/Wait).
   - Backend: Wraps `EmotionalCore.state`.

## 📦 Resources
1. **`eidolon://logs`**: Live thought stream from the agent.
2. **`eidolon://bioreactor`**: Real-time biological state (Glucose/Dopamine/Cortisol).

## 🚀 Technical Approach
- Single entry point: `src/mcp-server.ts`.
- Use `ts-node` to run directly from source.
- Stdio transport for easy agent integration.
