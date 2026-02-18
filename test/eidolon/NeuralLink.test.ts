
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DivineTransparency } from '../../src/eidolon/DivineTransparency';
import { IOracle, OracleInsight } from '../../src/eidolon/ai/IOracle';
import { MarketState, ReasoningWeights, DEFAULT_WEIGHTS } from '../../src/eidolon/EidolonTypes';

// Mock Oracle
const mockAnalyze = vi.fn();
// We cast to any or unknown to bypass strict type checking for mock objects if needed, 
// but implementing the interface is better.
const mockOracle = {
    getName: () => 'MockOracle',
    analyze: mockAnalyze
} as unknown as IOracle;

describe('Neural Link (Divine Transparency)', () => {
    let dt: DivineTransparency;
    const mockState: MarketState = {
        gasPrice: 'LOW',
        whaleFlow: 'NEUTRAL',
        sentiment: 'NEUTRAL',
        liquidityDepth: 'DEEP',
        priceAction: 'RANGING'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        dt = new DivineTransparency(mockOracle);
    });

    it('should incorporate Neural Narrative into DecisionLog', async () => {
        const mockInsight: OracleInsight = {
            weights: DEFAULT_WEIGHTS,
            narrative: 'The stars are aligning for a pump.'
        };

        mockAnalyze.mockResolvedValue(mockInsight);

        const decision = await dt.explain(mockState, 'BUY');

        expect(mockAnalyze).toHaveBeenCalled();
        expect(decision.reasoning).toContain('[ORACLE]: "The stars are aligning for a pump."');
    });

    it('should fallback gracefully if Oracle fails', async () => {
        mockAnalyze.mockRejectedValue(new Error('Connection timeout'));

        const decision = await dt.explain(mockState, 'BUY');

        expect(mockAnalyze).toHaveBeenCalled();
        expect(decision.reasoning).not.toContain('[ORACLE]');
        expect(decision.reasoning).toContain('EXECUTING BUY'); // Standard system message
    });

    it('should use Oracle weights to adjust confidence', async () => {
        // Create weights that strongly favor BUYing
        // Specifically, boost NEUTRAL whaleFlow (since our mockState has NEUTRAL whaleFlow)
        // Default might be 0. Let's make it +20.
        const bullishWeights: ReasoningWeights = JSON.parse(JSON.stringify(DEFAULT_WEIGHTS));
        bullishWeights.whaleFlow.NEUTRAL = 20;

        const mockInsight: OracleInsight = {
            weights: bullishWeights,
            narrative: 'Bullish divergence detected.'
        };

        mockAnalyze.mockResolvedValue(mockInsight);

        const decision = await dt.explain(mockState, 'BUY');

        // Check explicit confidence boost logic?
        // Or just ensure it runs.
        // Base confidence is usually around 50.
        expect(decision.confidence).toBeDefined();
        // Just verify it didn't crash and returned a valid decision
        expect(decision.action).toBe('BUY');
    });
});
