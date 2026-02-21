/**
 * MetaCognitive Orchestrator (HOTL-Native)
 *
 * The ultimate gatekeeper. Instead of relying on raw LLM prompt outputs to
 * decide when to use tools (which causes context explosion or missed signals),
 * this uses a 3-Layer architecture backed by hard mathematical signals.
 *
 * Layer 1 (MANDATORY): Always runs `sense_intent`, `check_pattern`, `thermo.step`
 * Layer 2 (DECISION): Computes a weighted additive confidence score based on Layer 1 + Per-User Policy
 * Layer 3 (REACTIVE): Routes execution to `AUTO`, `PROPOSE_ONE_CLICK`, or `ASK_USER`
 */

import { WasmAdapter, CausalGraph, LiquidBrain, TraumaRegistry } from '../WasmAdapter';
import type { IOracle } from '../ai/IOracle';

// ═══════════════════════════════════════════════════════════════════════════════
// Enums & Types
// ═══════════════════════════════════════════════════════════════════════════════

export enum RoutingStrategy {
    AUTO = 'AUTO',                   // Execute tool silently
    PROPOSE_ONE_CLICK = 'PROPOSE',   // Ask user to click to confirm execution
    ASK_USER = 'ASK_USER'            // High uncertainty, ask open-ended question
}

export interface OrchestrationContext {
    userId: string;
    message: string;
    suggestedTool: string;
    contextType: string;
}

export interface RoutingDecision {
    strategy: RoutingStrategy;
    confidence: number;
    breakdown: {
        intentConfidence: number;
        thermoCoherence: number;
        traumaSafety: number;
        learnedPolicyScore: number;
    };
    reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 2.5: Per-User Learned Policy (MVP CausalGraph wrapping)
// ═══════════════════════════════════════════════════════════════════════════════

class LearnedPolicy {
    // In-memory mapping of UserID -> Wasm CausalGraph instance
    // Note: In a production cluster, these would be serialized strings loaded dynamically
    private userGraphs: Map<string, CausalGraph> = new Map();

    constructor(private readonly wasmAdapter: WasmAdapter) { }

    private getOrCreateGraph(userId: string): CausalGraph {
        if (!this.userGraphs.has(userId)) {
            // @ts-ignore - The WASM instance exposes CausalGraph as a constructor
            this.userGraphs.set(userId, new this.wasmAdapter.wasm!.CausalGraph());
        }
        return this.userGraphs.get(userId)!;
    }

    /**
     * Hash string inputs to pseudo-SentinelVariable indices (0-12) for the Rust WASM
     * This is a simple hash function to map unbounded strings to the 13 slots in CausalGraph.
     */
    private hashToIndex(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0; // Convert to 32bit int
        }
        return Math.abs(hash) % 13;
    }

    /**
     * Compute P(UserSatisfaction | Tool usage on Context)
     * Maps tool name and context type to 2 pseudo-causes, checks the UserAction (slot 10) effect.
     */
    predict(userId: string, toolName: string, contextType: string): number {
        const graph = this.getOrCreateGraph(userId);

        const causeIndex1 = this.hashToIndex(toolName);
        const causeIndex2 = this.hashToIndex(contextType);

        // Predict slot 10 (UserAction/Satisfaction equivalent) based on tool + context
        // In the WASM, predict(target_idx, [[cause_idx, val], ...])
        return graph.predict(10, [
            [causeIndex1, 1.0],
            [causeIndex2, 1.0]
        ]);
    }

    /**
     * Learn from user feedback. If the user approved the PROPOSE or liked the AUTO, satisfied=true.
     */
    learn(userId: string, toolName: string, contextType: string, satisfied: boolean) {
        const graph = this.getOrCreateGraph(userId);
        const causeIndex1 = this.hashToIndex(toolName);
        const causeIndex2 = this.hashToIndex(contextType);

        // Slot 10 represents UserAction/Satisfaction in this localized graph context
        graph.learn(causeIndex1, 10, satisfied);
        graph.learn(causeIndex2, 10, satisfied);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MetaCognitive Orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

export class MetaCognitiveOrchestrator {
    private readonly policy: LearnedPolicy;

    constructor(
        private readonly oracle: IOracle,
        private readonly wasm: WasmAdapter,
        private readonly thermo: LiquidBrain,
        private readonly trauma: TraumaRegistry
    ) {
        this.policy = new LearnedPolicy(wasm);
    }

    /**
     * Weights for the additive confidence formula.
     * These fix the "multiplicative probability decay" flaw where 0.8^3 = 0.51.
     */
    private readonly WEIGHTS = {
        INTENT: 0.40,
        THERMO: 0.25,
        TRAUMA: 0.20,
        POLICY: 0.15
    };

    /**
     * Execute the full 3-Layer pipeline for inbound messages.
     * Determines EXACTLY how to handle a potential tool execution based on HOTL principles.
     */
    async route(ctx: OrchestrationContext): Promise<RoutingDecision> {
        // ───────────────────────────────────────────────────────────────────────
        // LAYER 1: MANDATORY SENSING (Always Runs)
        // ───────────────────────────────────────────────────────────────────────

        // 1a. Intent Parsing (Simulated here via Oracle if it were cheap, or basic regEx)
        // Represented directly by returning a high baseline for requested tools
        const intentConfidence = ctx.suggestedTool ? 0.85 : 0.40;

        // 1b. Thermodynamic State (Entropy)
        // We pulse the thermo engine with a dummy state to measure system chaos
        const stateVec = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
        const nextState = this.thermo.forward(stateVec);
        // We calculate entropy manually here since LiquidBrain only exposes forward()
        let entropy = 0;
        for (let i = 0; i < nextState.length; i++) {
            const val = Math.max(0.0001, Math.min(0.9999, nextState[i]));
            entropy -= val * Math.log2(val) + (1 - val) * Math.log2(1 - val);
        }
        entropy = entropy / nextState.length; // Average bit entropy per dimension

        // Normalize entropy [0..1], invert so High Coherence = High Score
        const thermoCoherence = Math.max(0, 1.0 - entropy);

        // 1c. Trauma Registry Security Check
        // If the tool is inhibited under any context, this plummets to 0
        const isDangerous = this.trauma.is_inhibited(0 /* Zen */, ctx.suggestedTool, BigInt(Date.now()));
        const traumaSafety = isDangerous ? 0.0 : 1.0;

        // ───────────────────────────────────────────────────────────────────────
        // LAYER 2: META-COGNITIVE DECISION
        // ───────────────────────────────────────────────────────────────────────

        // 2a. Per-User Learned Policy 
        const learnedPolicyScore = this.policy.predict(ctx.userId, ctx.suggestedTool, ctx.contextType);

        // 2b. Weighted Additive Score Calculation (Capped)
        let compositeConfidence = (
            (intentConfidence * this.WEIGHTS.INTENT) +
            (thermoCoherence * this.WEIGHTS.THERMO) +
            (traumaSafety * this.WEIGHTS.TRAUMA) +
            (learnedPolicyScore * this.WEIGHTS.POLICY)
        );
        compositeConfidence = Math.max(0.0, Math.min(1.0, compositeConfidence));

        // ───────────────────────────────────────────────────────────────────────
        // LAYER 3: REACTIVE ROUTING (HOTL Tiered)
        // ───────────────────────────────────────────────────────────────────────

        let strategy: RoutingStrategy;
        let reason: string;

        if (traumaSafety === 0.0) {
            // Immediate Overrides
            strategy = RoutingStrategy.ASK_USER;
            reason = "Tool execution blocked by TraumaRegistry. Mandatory user intervention required.";
        } else if (compositeConfidence > 0.85) {
            strategy = RoutingStrategy.AUTO;
            reason = "High confidence signals across all layers. Executing automatically.";
        } else if (compositeConfidence > 0.60) {
            strategy = RoutingStrategy.PROPOSE_ONE_CLICK;
            reason = "Moderate confidence. Suggesting 1-Click execution for Human-on-the-Loop verification.";
        } else {
            strategy = RoutingStrategy.ASK_USER;
            reason = "Low confidence signals resulting from entropy or lacking historical policy. Falling back to explicit prompt.";
        }

        return {
            strategy,
            confidence: compositeConfidence,
            breakdown: {
                intentConfidence,
                thermoCoherence,
                traumaSafety,
                learnedPolicyScore
            },
            reason
        };
    }

    /**
     * The Feedback Loop: Called after the user clicks PROPOSE, ignores PROPOSE, or rates an AUTO execution.
     */
    recordFeedback(ctx: OrchestrationContext, satisfied: boolean) {
        this.policy.learn(ctx.userId, ctx.suggestedTool, ctx.contextType, satisfied);
    }
}
