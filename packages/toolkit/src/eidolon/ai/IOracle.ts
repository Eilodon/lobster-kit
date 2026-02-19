import { MarketState, ReasoningWeights } from '../EidolonTypes';

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

export interface IOracle {
    /**
     * Analyze the current market context and return dynamic reasoning weights + narrative.
     * @param context Current market state and external info
     * @returns OracleInsight tailored to the specific moment
     */
    analyze(context: MarketContext): Promise<OracleInsight>;

    /**
     * Get a human-readable name for the oracle (e.g., "DeepSeek-V3", "GPT-5")
     */
    getName(): string;
}
