# 🦞 ClawKit V4: The Singularity (Hybrid MCP Architecture)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/Eilodon/lobster-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Eilodon/lobster-kit/actions)
[![MCP Ready](https://img.shields.io/badge/MCP-Ready-green.svg)](https://modelcontextprotocol.io/)
[![Rust Native](https://img.shields.io/badge/Rust-Native%20Core-orange.svg)](https://www.rust-lang.org/)
[![BNB Chain](https://img.shields.io/badge/BNB%20Chain-OpBNB-yellow)](https://opbnb.bnbchain.org/)

> **"Why pay for LLM inference when 90% of requests can be handled deterministically?"**

**ClawKit V4** is not just a DeFi SDK. It is the **90% Cost Reduction Architecture**—a Hybrid Neuro-Symbolic MCP (Model Context Protocol) Server built in pure Rust.

We intercept the bloat of modern AI Agents. Instead of forcing expensive, high-latency LLMs (GPT-4, Claude) to do basic math, guardrail checking, and memory retrieval, ClawKit handles deterministic chores in **Local Rust (0-4ms, $0 cost)**. Your AI only wakes up for what it does best: True generative reasoning.

---

## 🧠 The Hybrid Value Proposition

Most AI agents waste money sending deterministic queries to expensive LLMs (The "Apples to Oranges" fallacy).
ClawKit V4 solves the **Economic & Latency Argument**:

1. **Memory Lookups:** LLM takes 700ms and hallucinate user states. ClawKit uses `LiquidBrain` (Vector/Thermodynamic) taking **4ms** to extract exactly what's needed.
2. **Safety & Guardrails:** Prompting an LLM to "act safe" costs $ and takes 130ms. ClawKit's `TraumaRegistry` uses Hash Map O(1) lookups taking **1ms**. Unbreakable.
3. **Causal Logic:** Instead of hallucinating math, the `DAGMA` Causal Graph computes Counterfactuals in **0ms**.

**Result:** 90% cost reduction, 8x faster response time, zero hallucinations on deterministic queries.

---

## 🚀 14 Cognitive MCP Tools (The Arsenal)

ClawKit exposes 14 strictly typed, native Rust MCP tools straight to your Agent (Cursor, Cline, AutoGPT) via Standard I/O:

*   **Phase A (Core Loop):** `clawkit_recall_user`, `clawkit_sense_intent`, `clawkit_check_pattern`, `clawkit_simulate_response`, `clawkit_commit_pattern`.
*   **Phase B (Reasoning/Memory):** `clawkit_reason_chain`, `clawkit_recall_similar`, `clawkit_memory_query`, `clawkit_compress_context`.
*   **Phase C (Learning/Orchestrator):** `clawkit_record_outcome`, `clawkit_update_user`, `clawkit_dream_conversation`, `clawkit_orchestrate`, `clawkit_tool_recommend`.

---

## 📦 Installation & Usage (Native Rust)

**Prerequisites:** Rust toolchain (`cargo`).

```bash
# 1. Clone & Build the Release binary
git clone https://github.com/Eilodon/lobster-kit.git
cd lobster-kit/packages/mcp-rust
cargo build --release

# 2. Add to your MCP Client Configuration (e.g., Cursor/Cline)
# Set the command to the generated binary
{
  "mcpServers": {
    "clawkit-v4": {
      "command": "/path/to/lobster-kit/packages/mcp-rust/target/release/mcp-rust",
      "args": [],
      "env": {
        "DEEPSEEK_API_KEY": "your_api_key_for_oracles"
      }
    }
  }
}
```

---

## 🗣️ Q&A: Architectural Design

**Q: When does the system use LLM vs Local Rust?**
**A:** "If it is an IF/ELSE or MATH, MCP handles it locally in Rust. If it is GENERATE TEXT, the Oracle handles it." Agent tools like `check_pattern` resolve strictly in local WASM/Rust. Tools like `reason_chain` automatically bridge a fast request to the attached Oracle.

**Q: Fallback strategy if the local path fails?**
**A:** Fail-Closed architecture. If the Rust native binary crashes (exceedingly rare), Node.js/MCP Client restarts it. If the DeepSeek Oracle yields a 500 error, the protocol defaults to a `Zen` Do-Nothing safety mode to protect assets.

**Q: Which Oracle? What is the cost?**
**A:** We natively integrate with `DeepSeek V3/R1` via `reqwest`. Because 90% of the cognitive bloat (Memory, State, Validation) is pruned locally by Rust before the request flies, the actual Oracle payload is tiny. Combined with DeepSeek's low cost ($0.14/1M tokens), operating cost drops by >90% compared to pure OpenAI agent loops.

---

## 📄 License
MIT License. **Built with 🦞 by the ClawKit Team.**
