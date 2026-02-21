/**
 * CausalDiscoveryPipeline — THE MISSING BRIDGE
 *
 * This is the Neuro-Symbolic Glue that connects:
 *   LLM Intuition (oracle.extractCausalHypothesis)
 *     ↕
 *   Bayesian Verification (causalGraph.get_edge → Laplace probability)
 *     ↕
 *   Reinforcement Learning (causalGraph.learn)
 *
 * Flow:
 *   1. Feed episodes/context to the Oracle (LLM)
 *   2. Oracle extracts causal hypotheses: [{cause, effect, direction}]
 *   3. Each hypothesis is verified against the CausalGraph's Bayesian evidence
 *   4. Verified hypotheses are reinforced via learn(); Rejected ones are logged
 *
 * This closes the loop between "what the LLM thinks" and "what the math proves".
 */

import type { IOracle } from '../ai/IOracle';
import type { CausalGraph, CausalEdgeSnapshot } from '../WasmAdapter';

// ═══════════════════════════════════════════════════════════════════════════════
// Variable Name ↔ Index Mapping (mirrors core-rust/sentinel/variables.rs)
// ═══════════════════════════════════════════════════════════════════════════════

const VARIABLE_MAP: Record<string, number> = {
    PriceDelta: 0,
    VolumeSpike: 1,
    Volatility: 2,
    Momentum: 3,
    GasPriceGwei: 4,
    MempoolPendingCnt: 5,
    WhaleNetFlow: 6,
    LiquidityImbalance: 7,
    SmartMoneyActivity: 8,
    PortfolioRisk: 9,
    UserAction: 10,
    Sentiment: 11,
    MacroFactor: 12,
};

const INDEX_TO_NAME: string[] = Object.keys(VARIABLE_MAP);

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Raw hypothesis extracted by the LLM Oracle */
export interface CausalHypothesis {
    cause: string;
    effect: string;
    expected_direction: '+' | '-';
}

/** Result of verifying a single hypothesis against Bayesian evidence */
export interface VerificationResult {
    hypothesis: CausalHypothesis;
    cause_index: number;
    effect_index: number;
    edge: CausalEdgeSnapshot;
    bayesian_probability: number;
    verified: boolean;
    reason: string;
}

/** Full pipeline output */
export interface DiscoveryReport {
    total_hypotheses: number;
    verified: VerificationResult[];
    rejected: VerificationResult[];
    unmappable: Array<{ hypothesis: CausalHypothesis; reason: string }>;
    reinforced_count: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

export class CausalDiscoveryPipeline {
    constructor(
        private readonly oracle: IOracle,
        private readonly graph: CausalGraph,
        private readonly threshold: number = 0.1, // How far from 0.5 to consider "verified"
    ) { }

    /**
     * Resolve a variable name (from LLM output) to its SentinelVariable index.
     * Supports exact match, case-insensitive match, and fuzzy substring match.
     */
    private resolveVariable(name: string): number | null {
        // Exact match
        if (name in VARIABLE_MAP) return VARIABLE_MAP[name];

        // Case-insensitive match
        const lower = name.toLowerCase();
        for (const [varName, idx] of Object.entries(VARIABLE_MAP)) {
            if (varName.toLowerCase() === lower) return idx;
        }

        // Fuzzy: check if the LLM output contains a known variable name
        for (const [varName, idx] of Object.entries(VARIABLE_MAP)) {
            if (lower.includes(varName.toLowerCase())) return idx;
        }

        return null;
    }

    /**
     * TypeScript equivalent of Rust's verify_hypothesis().
     * Uses the CausalGraph's Bayesian probability to validate an LLM hypothesis.
     */
    private verifyHypothesis(
        causeIdx: number,
        effectIdx: number,
        directionPositive: boolean,
    ): { verified: boolean; probability: number; edge: CausalEdgeSnapshot; reason: string } {
        const edge = this.graph.get_edge(causeIdx, effectIdx);
        const prob = edge.probability;
        const totalSamples = edge.successes + edge.failures;

        // Not enough data to verify
        if (totalSamples < 2) {
            return {
                verified: false,
                probability: prob,
                edge,
                reason: `Insufficient evidence (${totalSamples} samples). Need ≥2 observations.`,
            };
        }

        const verified = directionPositive
            ? prob > 0.5 + this.threshold
            : prob < 0.5 - this.threshold;

        const reason = verified
            ? `Bayesian evidence CONFIRMS: P(${INDEX_TO_NAME[causeIdx]}→${INDEX_TO_NAME[effectIdx]}) = ${prob.toFixed(3)} (threshold ±${this.threshold})`
            : `Bayesian evidence REJECTS: P(${INDEX_TO_NAME[causeIdx]}→${INDEX_TO_NAME[effectIdx]}) = ${prob.toFixed(3)} does not pass threshold ±${this.threshold}`;

        return { verified, probability: prob, edge, reason };
    }

    /**
     * THE CORE METHOD: Run the full Neuro-Symbolic Discovery Pipeline.
     *
     * @param episodes - Raw text of recent events, conversation logs, or market data.
     *                   This is fed to the LLM Oracle for hypothesis extraction.
     * @param reinforce - If true, verified hypotheses are fed back into CausalGraph.learn()
     * @returns DiscoveryReport with verified, rejected, and unmappable hypotheses
     */
    async discover(episodes: string, reinforce: boolean = true): Promise<DiscoveryReport> {
        // Step 1: Ask the Oracle (LLM) to extract causal hypotheses
        const hypotheses = await this.oracle.extractCausalHypothesis(episodes);

        const report: DiscoveryReport = {
            total_hypotheses: hypotheses.length,
            verified: [],
            rejected: [],
            unmappable: [],
            reinforced_count: 0,
        };

        // Step 2: For each hypothesis, verify against Bayesian evidence
        for (const hyp of hypotheses) {
            const causeIdx = this.resolveVariable(hyp.cause);
            const effectIdx = this.resolveVariable(hyp.effect);

            // Can't map LLM string to a known SentinelVariable
            if (causeIdx === null || effectIdx === null) {
                report.unmappable.push({
                    hypothesis: hyp,
                    reason: `Unknown variable: ${causeIdx === null ? hyp.cause : hyp.effect}. Known: ${INDEX_TO_NAME.join(', ')}`,
                });
                continue;
            }

            // Step 3: Bayesian verification
            const { verified, probability, edge, reason } = this.verifyHypothesis(
                causeIdx,
                effectIdx,
                hyp.expected_direction === '+',
            );

            const result: VerificationResult = {
                hypothesis: hyp,
                cause_index: causeIdx,
                effect_index: effectIdx,
                edge,
                bayesian_probability: probability,
                verified,
                reason,
            };

            if (verified) {
                report.verified.push(result);

                // Step 4: Reinforcement — feed verified hypothesis back into the graph
                if (reinforce) {
                    this.graph.learn(causeIdx, effectIdx, hyp.expected_direction === '+');
                    report.reinforced_count++;
                }
            } else {
                report.rejected.push(result);
            }
        }

        return report;
    }

    /**
     * Quick diagnostic: dump the current state of all edges the graph has learned.
     * Useful for debugging and understanding the Bayesian state of the system.
     */
    dumpEvidence(): Record<string, CausalEdgeSnapshot> {
        return this.graph.export_edges();
    }
}
