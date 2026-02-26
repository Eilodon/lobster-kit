# EIDOLON-V: THE COGNITIVE SINGULARITY ARCHITECT
## SINGLE SOURCE OF TRUTH (ARCHITECTURE MAP)

> ⚠️ **CRITICAL INSTRUCTION FOR ALL AI AGENTS & ENGINEERS:** 
> BEFORE analyzing codebase, writing code, or proposing architectural changes, YOU MUST READ THIS DOCUMENT.

### 1. IDENTITY & POSITIONING
- **What we are:** An **MCP Runtime / Tool Orchestrator** (Cognitive Control-Plane). We provide policy, telemetry, circuit breakers, and trauma gates.
- **What we are NOT:** A foundation LLM, a generic LLM wrapper, or a local text generator. We do not generate text directly; we manage the tools and state that LLMs use.
- **Core Technology:** The core engine is built in **RUST** (`crates/mcp-server`), NOT TypeScript.

### 2. DIRECTORY MAP (AUTHORITY RANKS)

#### 🔴 RANK 1: THE CORE (RUST) - *Source of Truth*
*Path: `crates/mcp-server` & `crates/core-rust`*
This is the heart of Eidolon-V. All definitive logic lives here.
- **`crates/mcp-server/src/main.rs`**: Entrypoint of the MCP server.
- **`crates/mcp-server/src/dispatch.rs`**: The main dispatcher.
- **`crates/mcp-server/src/routing.rs` & `reasoning.rs`**: Dynamic Routing, Adaptive Compute (Fast/Deep paths).
- **`crates/mcp-server/src/critic.rs`**: Output critic and defense-in-depth gates.
- **`crates/mcp-server/src/mcp_protocol.rs`**: Protocol implementations.

#### 🟡 RANK 2: THE SHELL & SENSORS (TYPESCRIPT)
*Path: `packages/soul`, `packages/defi-bnb`, etc.*
These are sensory inputs, API integrations, and legacy bindings.
- **Warning:** Many older TypeScript files (like orchestrators or reasoning chains in TS) have been **DEPRECATED** and replaced by the Rust core. DO NOT use them as architectural references for how the system "thinks".
- TS is primarily used for interacting with blockchains (viem), external APIs, or building the MCP Client.

### 3. ARCHITECTURAL PHILOSOPHY (THERMODYNAMICS)
- **Entropy is the Enemy:** Keep the system lightweight. Avoid unnecessary LLM calls (e.g., Reflexion loops) if local rules/heuristics can solve it.
- **Unified Request Policy:** Confidence and Risk scoring must be centralized and consistent across the pipeline to prevent policy drift.
- **Ingress Safety Classifier:** Every request must pass a "Fail-fast" safety check before triggering tool logic.
- **Pro Mode (Selective):** High-risk tasks generate 2-3 candidate plans and use a Verifier. Do NOT use brute-force "Best-of-N" LLM sampling anywhere.
- **Closed-loop Tuning:** Thresholds (risk limits, confidence bounds) should dynamically adjust via telemetry, not hard-coded constants.

---
**Failure to adhere to this map will result in hallucination (Cognitive Trauma). Proceed with absolute clarity.**
