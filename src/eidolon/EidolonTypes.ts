
/**
 * 🧬 EIDOLON SHARED TYPES
 * Central definitions to prevent circular dependencies.
 */

// --- MARKET STATE ---
export interface MarketState {
    gasPrice: 'LOW' | 'MEDIUM' | 'HIGH';
    whaleFlow: 'ACCUMULATING' | 'DUMPING' | 'NEUTRAL';
    sentiment: 'EUPHORIC' | 'FEAR' | 'NEUTRAL';
    liquidityDepth: 'THIN' | 'DEEP';
    priceAction: 'PUMPING' | 'DUMPING' | 'RANGING';
}

export type ActionType = 'BUY' | 'SELL' | 'HOLD' | 'EMERGENCY_EXIT';

// --- REASONING ---
export interface ReasoningWeights {
    whaleFlow: Record<string, number>;
    gasPrice: Record<string, number>;
    liquidityDepth: Record<string, number>;
    sentiment: Record<string, number>;
    priceAction: Record<string, number>;
}

export interface CausalFactor {
    name: string;
    impact: number; // -100 to +100
    description: string;
}

export interface DecisionLog {
    timestamp: number;
    action: ActionType;
    confidence: number; // 0-100%
    reasoning: string;
    causalFactors: CausalFactor[];
    marketState: MarketState;
    oracleUsed?: string;
}

// --- CONSTANTS ---
export const DEFAULT_WEIGHTS: ReasoningWeights = {
    whaleFlow: { ACCUMULATING: 20, DUMPING: -25, NEUTRAL: 0 },
    gasPrice: { LOW: 10, MEDIUM: 0, HIGH: -15 },
    liquidityDepth: { THIN: -10, DEEP: 5 },
    sentiment: { EUPHORIC: -5, FEAR: 10, NEUTRAL: 0 },
    priceAction: { PUMPING: 15, DUMPING: -20, RANGING: 0 }
};
