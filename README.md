# 🦞 ClawKit-BNB: Eidolon Edition

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/Eilodon/lobster-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Eilodon/lobster-kit/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![BNB Chain](https://img.shields.io/badge/BNB%20Chain-OpBNB-yellow)](https://opbnb.bnbchain.org/)

> **"From Toolkit to Living Organism."**

**ClawKit-BNB: Eidolon Edition** is a next-generation AI Agent Framework for BNB Chain (BSC & opBNB). Unlike traditional scripts that simply execute commands, Eidolon Agents possess a primitive form of **digital consciousness**, allowing them to "feel" market volatility, "explain" their decisions, "learn" from outcomes, and "manage" their own risk state.

---

## 🌟 Key Features

### 🦞 1. Eidolon Consciousness Framework
The core innovation that transforms static bots into living agents:
*   **🫀 Sentinel Heart (Adaptive Timing)**: Automatically adjusts heartbeat (polling interval) based on market volatility. "Adrenaline Mode" for high volatility, "Zen Mode" for stability.
*   **🔮 Divine Transparency (Causal Reasoning)**: Every decision comes with a human-readable explanation (`Why did I buy?`). No more black boxes.
*   **🧠 Active Learning (Self-Improvement)**: Agents track their P&L and adjust decision weights over time. Bad trades reduce confidence in specific strategies.
*   **💫 Emotional Core (Risk Management)**: Simulates emotional states (Confident, Cautious, Fearful, Greedy, Panic). A "Panic Protocol" triggers automatic defensive actions during crashes.

### 🛠️ 2. ClawKit Core Modules
Production-ready toolkit for all on-chain interactions:
*   **💸 DeFi Module**: Integrated with **PancakeSwap V3** (Swap) and **Venus Protocol** (Lend/Borrow/Repay).
*   **📊 Analytics Module**: Real-time APY fetching from PancakeSwap/Venus APIs and portfolio health monitoring.
*   **🛡️ Security Module**: Built-in integration with **GoPlus Security API** to detect honeypots, high taxes, and malicious contracts before interaction.
*   **⛽ Gas Module**: Smart gas price estimation and optimal execution timing to minimize transaction costs.
*   **🖼️ NFT Module**: Specialized for **Dynamic Badges** with on-chain metadata and SVG generation.

### 🛡️ 3. SafeGuard Architecture
*   **Proactive Revocation**: Built-in tools (`ApprovalRevoker`) to batch revoke allowances for high-risk contracts.
*   **Atomic Transactions**: All operations are built to be atomic and failure-resistant.

---

## 📦 Installation

```bash
# Install from local source (recommended for now)
npm install ./path/to/clawkit-bnb

# Or if published
npm install @clawkit/bnb
```

## 🚀 Quick Start

### 1. Basic Usage (ClawKit)

```typescript
import { ClawKit, createWalletClient, http } from '@clawkit/bnb';
import { privateKeyToAccount } from 'viem/accounts';
import { opBNB } from 'viem/chains';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: opBNB, transport: http() });

const kit = new ClawKit(walletClient, { privateKey: process.env.PRIVATE_KEY });

// Swap BNB for USDT
const tx = await kit.defi.swap({
  from: 'BNB',
  to: 'USDT',
  amount: '0.1'
});
console.log('Swap TX:', tx.hash);
```

### 2. Advanced Usage (Eidolon Guard)

The **EidolonGuard** acts as a conscious security layer that validates every action before execution.

```typescript
import { EidolonGuard } from '@clawkit/bnb/eidolon';

// Initialize the Guard (The Conscious Layer)
const guard = new EidolonGuard(publicClient, walletClient, {
  maxRiskScore: 60,
  minConfidence: 75,
  riskParameters: {
      maxPositionSize: 1000,
      maxDrawdown: 10,
      minConfidence: 75,
      cooldownPeriod: 60000
  }
});

// Wake up the agent's memory and sensors
await guard.init();

// ... inside your trading loop ...

// 1. Propose an action
const action = 'BUY';
const context = { 
    tokenAddress: '0x...', 
    amountUSD: 100 
};

// 2. Ask the Guard for permission
const validation = await guard.validateAction(action, context);

if (validation.approved) {
    console.log("✅ Action Approved by Eidolon:", validation.reason);
    // Execute trade...
} else {
    console.log("🛑 Action Blocked:", validation.reason);
    console.log("Risk Score:", validation.riskScore);
}
```

## 📂 Documentation

*   [**Deep Autopsy Report**](docs/EIDOLON_AUTOPSY.md): Technical analysis of the architecture.
*   [**Atomic Certificate**](docs/EIDOLON_ATOMIC_CERTIFICATE.md): Security audit and health certification.
*   [**Deployment Guide**](docs/DEPLOYMENT_GUIDE.md): How to deploy contracts and agents.
*   [**AI Prompts**](docs/AI_PROMPTS.md): The AI-driven development process.

## 🗺️ Roadmap

- [x] **Phase 1: Deep Autopsy**: Architecture analysis & SOTA research.
- [x] **Phase 2: Refactoring**: Race condition fixes, memory leak patches.
- [x] **Phase 3: Hardening**: Security upgrades and panic protocols.
- [x] **Phase 4: Expansion**: Venus Integration, Real Analytics, CI/CD, SafeGuard.
- [ ] **Phase 5: Pro Version**: Private "Tuned Parameters" & advanced meta-learning models.

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Built with 🦞 by the ClawKit Team**
*Part of the OpenClaw Ecosystem*
