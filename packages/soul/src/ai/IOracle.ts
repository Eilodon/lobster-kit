import { MarketState, ReasoningWeights } from '../eidolon/EidolonTypes';
import type { WorldState, CriticResult } from '@clawkit/core';

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
     * Produce a domain-agnostic embedding for memory and routing layers.
     */
    embed<T extends object>(worldState: WorldState<T>): Promise<number[]>;

    /**
     * Optional response refinement hook used by Critic/Verifier loops.
     */
    refine?(draft: string, critique: CriticResult): Promise<string>;

    /**
     * Optional generation hook for reasoning/orchestration/tool generation modules.
     */
    generate?(prompt: string, options?: OracleGenerationOptions): Promise<string>;

    /**
     * Get a human-readable name for the oracle (e.g., "DeepSeek-V3", "GPT-5")
     */
    getName(): string;
}
