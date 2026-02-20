import { MarketState, ReasoningWeights } from '../types/EidolonTypes';
import type { WorldState } from '../types/WorldState';
import type { CriticResult } from '../types/CognitiveTypes';

export interface MarketContext {
    marketState: MarketState;
    newsHeadlines?: string[];
    twitterSentiment?: string;
    globalMacro?: string; // e.g. "CPI Data Release today"
}

export interface OracleInsight {
    weights: ReasoningWeights;
    narrative: string; // The "Voice of God" explanation
}

export interface OracleGenerationOptions {
    temperature?: number;
    maxTokens?: number;
    json?: boolean;
}

export interface IOracle {
    /**
     * Analyze the current market context and return dynamic reasoning weights + narrative.
     * @param context Current market state and external info
     * @returns OracleInsight tailored to the specific moment
     */
    analyze(context: MarketContext): Promise<OracleInsight>;

    /**
     * Produce a domain-agnostic embedding for a world state snapshot.
     * This is the primary bridge for semantic memory and memory routing.
     */
    embed<T extends object>(worldState: WorldState<T>): Promise<number[]>;

    /**
     * Optional refinement hook used by Critic/Verifier loops.
     * Implementations may call external LLMs or use deterministic fallback.
     */
    refine?(draft: string, critique: CriticResult): Promise<string>;

    /**
     * Optional free-form generation hook for advanced reasoning/orchestration/tool creation.
     * Implementations should apply safety policy and deterministic fallback when offline.
     */
    generate?(prompt: string, options?: OracleGenerationOptions): Promise<string>;

    /**
     * Get a human-readable name for the oracle (e.g., "DeepSeek-V3", "GPT-5")
     */
    getName(): string;
}
