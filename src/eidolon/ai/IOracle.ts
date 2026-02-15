import { MarketState, ReasoningWeights } from '../EidolonTypes';

export interface MarketContext {
    marketState: MarketState;
    newsHeadlines?: string[];
    twitterSentiment?: string;
    globalMacro?: string; // e.g. "CPI Data Release today"
}

export interface IOracle {
    /**
     * Analyze the current market context and return dynamic reasoning weights.
     * @param context Current market state and external info
     * @returns ReasoningWeights tailored to the specific moment
     */
    analyze(context: MarketContext): Promise<ReasoningWeights>;

    /**
     * Get a human-readable name for the oracle (e.g., "DeepSeek-V3", "GPT-5")
     */
    getName(): string;
}
