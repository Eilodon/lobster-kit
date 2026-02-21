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
     * Optional response refinement hook used by Critic/Verifier loops.
     */
    refine?(draft: string, critique: CriticResult): Promise<string>;

    /**
     * Optional generation hook for reasoning/orchestration/tool generation modules.
     */
    generate?(prompt: string, options?: OracleGenerationOptions): Promise<string>;

    /**
     * Produce a domain-agnostic embedding for memory and routing layers.
     * Follow DeepSeekOracle.sanitizeContext() pattern.
     */
    embed<T extends object>(
        worldState: WorldState<T>,
        dimension?: number   // default 64
    ): Promise<number[]>;

    /**
     * P1: Conversation interpretation
     */
    interpretConversation(
        messages: string,
        // using imported types if available or specific params
        current_mode: number, // ConversationMode enum value
        user_profile?: unknown
    ): Promise<unknown>; // ConversationSensory

    /**
     * P1: Counterfactual query — wraps Intervenable
     */
    counterfactual(
        actual_pattern: string,
        hypothetical_pattern: string,
        context: unknown // ConversationSensory
    ): Promise<{ would_have_been_better: boolean; delta: number; reasoning: string }>;

    /**
     * Get a human-readable name for the oracle (e.g., "DeepSeek-V3", "GPT-5")
     */
    getName(): string;

    /**
     * P1: Neuro-Symbolic Causal Extraction Hook
     * Extract causal hypotheses from a conversation or events.
     */
    extractCausalHypothesis(episodes: string): Promise<Array<{ cause: string, effect: string, expected_direction: '+' | '-' }>>;
}
