import bioParametersJson from './BioParameters.json';
import riskConfigJson from './RiskConfig.json';

export interface BioParameters {
    metabolism: {
        glucoseBurnRate: number;
        dopamineDecayRate: number;
        cortisolDecayRate: number;
        cortisolSpikeFactor: number;
    };
    thresholds: {
        panicCortisol: number;
        flowStateAttention: number;
        flowStateValence: number;
        starvationGlucose: number;
    };
    limits: {
        maxHormoneLevel: number;
        minHormoneLevel: number;
    };
    breathing: {
        baseBPM: number;
        maxBPM: number;
    };
}

export interface RiskConfig {
    base: {
        maxPositionSize: number;
        maxDrawdown: number;
        minConfidence: number;
        cooldownPeriod: number;
    };
    multipliers: {
        flowStateAggression: number;
        panicDefense: number;
        conservative: number;
    };
}

export const BioParametersConfig = bioParametersJson as BioParameters;
export const RiskConfigPreset = riskConfigJson as RiskConfig;
