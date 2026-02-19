
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

// --- Q-LEARNING (The Brain 2.0) ---
export type QStateHash = string; // e.g. "HIGH:ACCUMULATING:NEUTRAL:DEEP:RANGING"

export interface QTable {
    // Map StateHash -> Action -> Expected Reward (Q-Value)
    [stateHash: string]: Record<ActionType, number>;
}

export const Q_CONFIG = {
    ALPHA: 0.1,    // Learning Rate
    GAMMA: 0.9,    // Discount Factor (Importance of future rewards)
    EPSILON: 0.1   // Exploration Rate (10% random actions)
};

// --- SENTINEL MODES (The Nervous System) ---
export enum SentinelMode {
    ZEN = 'ZEN',           // Balanced / Idle             → Risk: 0.2, Leverage: 1x
    STALKING = 'STALKING', // Low activity, monitoring    → Risk: 0.1, Leverage: 1x
    BERSERK = 'BERSERK',   // High frequency trading      → Risk: 0.7, Leverage: 3x
    ARBITRAGE = 'ARBITRAGE',// Atomic price diff          → Risk: 0.05, Leverage: 10x
    LIQUIDATION = 'LIQUIDATION', // Hunting bad debt      → Risk: 0.4, Leverage: 5x
    SNIPE = 'SNIPE',       // New token launch            → Risk: 0.9, Leverage: 1x
    EMERGENCY = 'EMERGENCY' // Pull everything            → Risk: 1.0, Leverage: 0x
}

export interface ModeConfig {
    riskLevel: number;      // 0.0 to 1.0 (Capital at risk)
    maxLeverage: number;    // 1x to 100x
    maxPositionPct: number; // % of total portfolio allowed in one position
    cooldownMs: number;     // Time between actions
}

export const MODE_CONFIGS: Record<SentinelMode, ModeConfig> = {
    [SentinelMode.ZEN]: {
        riskLevel: 0.2,
        maxLeverage: 1,
        maxPositionPct: 10,
        cooldownMs: 60000
    },
    [SentinelMode.STALKING]: {
        riskLevel: 0.1,
        maxLeverage: 1,
        maxPositionPct: 5,
        cooldownMs: 5000
    },
    [SentinelMode.BERSERK]: {
        riskLevel: 0.7,
        maxLeverage: 3,
        maxPositionPct: 25,
        cooldownMs: 500
    },
    [SentinelMode.ARBITRAGE]: {
        riskLevel: 0.05,
        maxLeverage: 10,
        maxPositionPct: 40,
        cooldownMs: 0
    },
    [SentinelMode.LIQUIDATION]: {
        riskLevel: 0.4,
        maxLeverage: 5,
        maxPositionPct: 20,
        cooldownMs: 1000
    },
    [SentinelMode.SNIPE]: {
        riskLevel: 0.9,
        maxLeverage: 1,
        maxPositionPct: 15,
        cooldownMs: 0
    },
    [SentinelMode.EMERGENCY]: {
        riskLevel: 0.0,
        maxLeverage: 0,
        maxPositionPct: 0,
        cooldownMs: 0
    }
};
