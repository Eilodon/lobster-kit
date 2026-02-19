# 🦞 ClawKit-BNB: The AI Survival Layer (MCP Edition)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/Eilodon/lobster-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Eilodon/lobster-kit/actions)
[![MCP Ready](https://img.shields.io/badge/MCP-Ready-green.svg)](https://modelcontextprotocol.io/)
[![BNB Chain](https://img.shields.io/badge/BNB%20Chain-OpBNB-yellow)](https://opbnb.bnbchain.org/)

> **"You provide the Brain (LLM). We provide the Body & Instincts."**

**ClawKit-BNB** is not just a DeFi SDK. It is an **AI Exocortex**—a "Survival Layer" designed to give Large Language Models (LLMs) safe, conscious access to the blockchain.

By implementing the **Model Context Protocol (MCP)**, ClawKit acts as a middleware that allows generic AI agents (Claude, ChatGPT, AutoGPT) to perceive market data and execute trades, **protected by an autonomous amygdala (`EidolonGuard`)**.

---

## 🧠 Why "Survival Layer"?

LLMs are brilliant planners but terrible executioners. They hallucinate, miscalculate decimals, and fall for honeypots.

**ClawKit intercepts every intent.**
When your AI says *"Buy this token"*, ClawKit doesn't just execute. It:
1.  **Feels**: Checks volatility & gas pressure (`EmotionalCore`).
2.  **Sees**: Scans for honeypots/rugpulls (`GoPlus` + `WasmAdapter`).
3.  **Thinks**: Simulates the transaction (`EidolonSimulator`).
4.  **Acts**: Only if the **Risk Score** is acceptable.

---

## 🚀 Features

### 🔌 1. The Exocortex (MCP Server)
Connect your AI directly to the chain via standard **JSON-RPC**.
*   **Tools**:
    *   `eidolon_oracle_sense`: Check prices & market depth.
    *   `eidolon_security_scan`: Detect honeypots/scams.
    *   `eidolon_execute_swap`: **Guard-Validated** trading.
    *   `eidolon_panic_button`: Emergency portfolio liquidation.
*   **Resources**:
    *   `eidolon://bioreactor`: Read the agent's dopamine/cortisol levels.

### 🛡️ 2. Eidolon Guard (The Conscious Firewall)
*   **Anti-Rug System**: WASM-powered bytecode analysis.
*   **Deadlock Prevention**: Timeout wrappers for all external calls.
*   **Fail-Closed Consensus**: If Oracles disagree >10%, trading halts.

### 👻 3. Ghost Protocol
*   **Privacy**: Routes sensitive logic through internal oracles.
*   **Resilience**: Intelligent retries and circuit breakers (`withRetry`, `withTimeout`).

---

## 📦 Installation & Usage

### Option A: Run as Exocortex (MCP Middleware) - **RECOMMENDED**
Ideal for connecting to Claude Desktop, Cursor, or Agentic Frameworks.

**Using Docker:**
```bash
# 1. Build the image
npm run docker:build

# 2. Run the Exocortex (Inject your Private Key)
docker run -e PRIVATE_KEY=0xYourKey... -i clawkit/mcp-server
```

**Using Node.js:**
```bash
# 1. Install & Build
npm install
npm run build

# 2. Start MCP Server
export PRIVATE_KEY=0xYourKey...
npm run start:mcp
```

### Option B: Use as SDK (Library)
For building custom specialized agents.

```bash
npm install @clawkit/bnb
```

```typescript
import { ClawKit, EidolonGuard } from '@clawkit/bnb';

// Initialize the Body
const kit = new ClawKit(walletClient, config);

// Initialize the Soul
const guard = new EidolonGuard(kit);
await guard.init();

// Safe Execution Wrapper
const intent = { action: 'BUY', token: '0x...', amount: 100 };
const validation = await guard.validateAction(intent.action, intent);

if (validation.approved) {
    console.log("✅ Eidolon Approved:", validation.reason);
    await kit.defi.swap(...);
} else {
    console.log("🛑 Blocked (" + validation.riskScore + "% Risk):", validation.reason);
}
```

---

## 📂 Architecture

```mermaid
graph TD
    LLM[Generic LLM (The Brain)] <-->|MCP Protocol| Middleware[ClawKit Exocortex]
    
    subgraph "ClawKit Middleware"
        MCP[MCP Server] --> Guard[Eidolon Guard]
        Guard --> Soul[Emotional Core]
        Guard --> Eyes[Security Module]
        Guard --> Hands[DeFi Module]
    end
    
    Hands -->|Tx| Chain[BNB Chain / OpBNB]
    Eyes -->|Scan| Chain
```

---


## 📄 License

MIT License.
**Built with 🦞 by the ClawKit Team.**
