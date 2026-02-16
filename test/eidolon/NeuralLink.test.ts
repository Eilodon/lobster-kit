
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActiveLearning, LEARNING_CONFIG } from '../../src/eidolon/ActiveLearning';
import { DecisionLog, ActionType } from '../../src/eidolon/EidolonTypes';

// Mock Storage
const mockStorage = {
    save: vi.fn(),
    load: vi.fn()
};

describe('ActiveLearning: Neural Link Upgrade', () => {
    let brain: ActiveLearning;

    beforeEach(() => {
        vi.clearAllMocks();
        mockStorage.load.mockResolvedValue(null); // Fresh start
        brain = new ActiveLearning(undefined, LEARNING_CONFIG, mockStorage as any);
        // Force init
        return brain.init();
    });

    it('should ROBUSTLY match weight keys (Case Insensitive)', () => {
        const weights = brain.getWeights();
        const initialWeight = weights.whaleFlow.ACCUMULATING;

        // Create decision with LOWER CASE key
        const decision: DecisionLog = {
            timestamp: Date.now(),
            action: 'BUY' as ActionType,
            confidence: 80,
            reasoning: 'Test',
            causalFactors: [{ name: 'Whale Activity', impact: 100, description: 'High activity' }],
            marketState: {
                whaleFlow: 'accumulating' as any, // Lower case!
                gasPrice: 'LOW',
                sentiment: 'NEUTRAL',
                liquidityDepth: 'DEEP',
                priceAction: 'RANGING'
            }
        };

        const outcome = {
            decisionId: decision.timestamp,
            profitLoss: 10, // Profit
            capitalAtRisk: 100,
            slippage: 0.1,
            gasUsed: 0.001,
            success: true
        };

        // Learn
        brain.learnFromOutcome(decision, outcome);

        // Verify Weight Update
        const newWeights = brain.getWeights();
        expect(newWeights.whaleFlow.ACCUMULATING).toBeGreaterThan(initialWeight);
    });

    it('should ARCHIVE history when limit is reached (Anti-Amnesia)', async () => {
        // Access private tradeHistory via 'any' cast
        const anyBrain = brain as any;

        // Fill history with 2000 dummy items
        anyBrain.tradeHistory = Array(2000).fill({ decisionId: 0, profitLoss: 0, success: true });

        // Add one more to trigger archival
        const decision: DecisionLog = {
            timestamp: Date.now(),
            action: 'BUY' as ActionType,
            confidence: 80,
            reasoning: 'Overflow',
            causalFactors: [],
            marketState: { whaleFlow: 'NEUTRAL', gasPrice: 'LOW', sentiment: 'NEUTRAL', liquidityDepth: 'DEEP', priceAction: 'RANGING' }
        };
        const outcome = { decisionId: 1, profitLoss: 0, capitalAtRisk: 0, slippage: 0, gasUsed: 0, success: true };

        await brain.learnFromOutcome(decision, outcome);

        // Expect archive call
        expect(mockStorage.save).toHaveBeenCalledWith(
            expect.stringMatching(/archive_history_.*\.json/),
            expect.any(Array)
        );

        // Expect history to be reduced (1000 items + 1 new = 1001)
        expect(anyBrain.tradeHistory.length).toBe(1001);
    });
});
