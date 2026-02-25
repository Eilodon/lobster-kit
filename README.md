# 🦞 Eidolon V4: The Apex Cognitive Infrastructure

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/Eilodon/lobster-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Eilodon/lobster-kit/actions)
[![MCP Ready](https://img.shields.io/badge/MCP-Ready-green.svg)](https://modelcontextprotocol.io/)
[![Rust Native](https://img.shields.io/badge/Rust-Native%20Core-orange.svg)](https://www.rust-lang.org/)

> **"You provide the Brain (LLM). We provide the Sub-Brain, the Trauma, and the Instincts."**

**Eidolon V4** (formerly ClawKit) is a **Cognitive Sub-Brain Runtime** for agents. It is a high-frequency, zero-cost, thermodynamic **Exocortex** built in Rust and exposed through MCP so agents (Claude, Cursor, AutoGPT) can offload deterministic safety, causal reasoning, memory, and orchestration.

Trading remains a **reference vertical** implemented as a separate domain module, not the primary product identity.

---

## 🧠 Core Philosophy: Cognitive Thermodynamics

Eidolon rejects the mechanical view of AI. Intelligence is treated as a thermodynamic process of reducing entropy:
1. **Entropy is the Enemy:** High entropy means chaos, hallucinations, and failure. Low entropy means order and accuracy. Eidolon enforces **Zero Hallucination Tolerance** on deterministic tasks.
2. **Trauma is the Teacher:** Errors are not bugs; they are Trauma. The `TraumaRegistry` ensures no fatal pattern repeats twice via O(1) hash lookups.
3. **Causality over Correlation:** Eidolon builds Causal Graphs (`DAGMA`) and runs counterfactuals (Pearl's do-calculus) to simulate outcomes before taking action.
4. **Emotions as Heuristics:** The `ThermodynamicEngine` regulates the system state via Engagement, Cognitive Load, and Momentum.

---

## 🏛️ Monorepo Architecture

Eidolon is decoupled into cognitive runtime core plus vertical domain packages:

### 1. `core-rust`: Cognitive Core Engine
Platform-agnostic WASM core with hot-path safety and deterministic runtime behavior.
* **Cognitive Models:** Causal Graphs, Trauma Registry, Thermodynamic Logic (`sentinel/`).
* **Memory Subsystems:** `LiquidBrain` and Hyper Memory.
* **Runtime Bridge:** Shared primitives consumed by MCP runtime.

### 2. `mcp-server`: The Interface Layer (Máy Chủ Tương Tác)
The host envelope that interacts with the OS and the outside world without polluting the core logic.
* **MCP Protocol:** Standard JSON-RPC interface for seamless integration with AI clients.
* **The Epistemic Core:** Integrates ONNX Embedding Engines and Local Tensor Oracles.
* **Async & I/O:** Powered by `Tokio` for multi-threaded agent orchestration, SQLite for telemetric persistence.

### 3. `trading-domain`: Reference Vertical Package
Domain-specific trading primitives, kept separate from cognitive core:
* Order book and matching primitives
* Risk/margin calculations
* Token math and AMM helpers
* On-chain security scoring helpers

---

## ⚙️ Operating Modes & Pipelines

Eidolon operates continuously across three foundational metacognitive layers:
1. 🛡️ **The Guardian:** Zero-Trust AI accountability. Checks incoming patterns against the `TraumaRegistry`. If a pattern triggers recorded trauma, it is strictly inhibited.
2. ⚡ **The Metacognitive Orchestrator:** Implements System 2 Thinking (Tree of Thoughts, Critic-Verifier). Runs simulations before allowing the LLM to execute high-impact actions. 
3. 🧠 **The Organism:** Learns through Experience Replay via asynchronous **Dream Cycles**, optimizing the `LiquidBrain` weights without requiring real-time data overhead.

---

## 🚀 The Cognitive Arsenal (16 MCP Tools)

Eidolon exposes strictly typed, native Rust MCP tools straight to your Agent via Standard I/O:

*   **Phase A (Core Loop):** `eidolon_recall_user`, `eidolon_sense_intent`, `eidolon_check_pattern`, `eidolon_simulate_response`, `eidolon_commit_pattern`.
*   **Phase B (Reasoning & Memory):** `eidolon_reason_chain`, `eidolon_recall_similar`, `eidolon_memory_query`, `eidolon_compress_context`.
*   **Phase C (Learning & Orchestration):** `eidolon_record_outcome`, `eidolon_update_user`, `eidolon_dream_conversation`, `eidolon_orchestrate`, `eidolon_tool_recommend`, `eidolon_subbrain_auto`, `eidolon_generated_tool_decision`.

Legacy DeFi bridge tools are compatibility-only and disabled by default (`LEGACY_DEFI_COMPAT_ENABLED=false`).

---

## 📦 Installation & Usage

**Prerequisites:** Rust toolchain (`cargo`).

```bash
# 1. Clone & Build the Release binary
git clone https://github.com/Eilodon/lobster-kit.git
cd lobster-kit/crates/mcp-server
cargo build --release

# 1.5 Download local TensorOracle assets (GGUF + tokenizer)
cd ..
./scripts/download-qwen3-gguf.sh

# 2. Add to your MCP Client Configuration (e.g., Cursor/Claude Desktop)
{
  "mcpServers": {
    "eidolon-v4": {
      "command": "/path/to/lobster-kit/scripts/mcp-cursor-launch.sh",
      "args": [],
      "env": {
        "TENSOR_ORACLE_GGUF_PATH": "/path/to/lobster-kit/.models/qwen3-1.7b-instruct-q4_k_m.gguf",
        "TENSOR_ORACLE_TOKENIZER_PATH": "/path/to/lobster-kit/.models/qwen3-tokenizer.json",
        "ONNX_MODEL_DIR": "/path/to/lobster-kit/.models",
        "ORT_DYLIB_PATH": "/path/to/lobster-kit/.models/libonnxruntime.so"
      }
    }
  }
}
```

---

## 📄 License
MIT License. **Built by the Eidolon Team.**
