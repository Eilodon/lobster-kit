
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActiveLearning, LEARNING_CONFIG } from '../../src/eidolon/ActiveLearning';
import { DecisionLog, ActionType } from '../../src/eidolon/EidolonTypes';

// Mock Storage
const mockStorage = {
    save: vi.fn(),
    load: vi.fn(),
    append: vi.fn(),
    readLog: vi.fn().mockResolvedValue([])
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

    it('should ROBUSTLY match weight keys (Case Insensitive)', async () => {
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
        await brain.learnFromOutcome(decision, outcome);

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

        // Expect history to be reduced (Keep last 1000)
        expect(anyBrain.tradeHistory.length).toBe(1000);
    });

    describe('Q-Learning Engine (Brain 2.0)', () => {
        it('should Quantize Market State correctly', () => {
            const state = {
                whaleFlow: 'ACCUMULATING',
                gasPrice: 'LOW',
                sentiment: 'NEUTRAL',
                liquidityDepth: 'DEEP',
                priceAction: 'RANGING'
            } as any;

            const hash = (brain as any).getMarketStateHash(state);
            expect(hash).toBe('LOW:ACCUMULATING:NEUTRAL:DEEP:RANGING');
        });

        it('should Update Q-Values using Bellman Equation', async () => {
            const decision: DecisionLog = {
                timestamp: Date.now(),
                action: 'BUY',
                confidence: 80,
                reasoning: 'Q-Test',
                causalFactors: [],
                marketState: {
                    whaleFlow: 'ACCUMULATING',
                    gasPrice: 'LOW',
                    sentiment: 'NEUTRAL',
                    liquidityDepth: 'DEEP',
                    priceAction: 'RANGING'
                }
            };

            const outcome = {
                decisionId: decision.timestamp,
                profitLoss: 100, // Big Win
                capitalAtRisk: 1000,
                slippage: 0,
                gasUsed: 0,
                success: true
            };

            // Initial Q-Value should be 0
            // Learn
            await brain.learnFromOutcome(decision, outcome);

            // Access Q-Table
            const qTable = (brain as any).qTable;
            const hash = 'LOW:ACCUMULATING:NEUTRAL:DEEP:RANGING';

            // Expected: 0 + alpha * (reward - 0)
            // Reward = tanh(100/50) = ~0.96
            // Alpha = 0.1
            // Target ~ 0.096
            expect(qTable[hash]).toBeDefined();
            expect(qTable[hash]['BUY']).toBeGreaterThan(0);
        });

        it('should Recommend Actions based on Q-Table', () => {
            const state = {
                whaleFlow: 'ACCUMULATING',
                gasPrice: 'LOW',
                sentiment: 'NEUTRAL',
                liquidityDepth: 'DEEP',
                priceAction: 'RANGING'
            } as any;
            const hash = 'LOW:ACCUMULATING:NEUTRAL:DEEP:RANGING';

            // Manually set Q-Values
            (brain as any).qTable[hash] = {
                BUY: 0.5,
                SELL: -0.1,
                HOLD: 0.1,
                EMERGENCY_EXIT: -1.0
            };

            // Mock Math.random for deterministic test
            const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9); // > epsilon (Exploit)

            const action = brain.recommendAction(state);
            expect(action).toBe('BUY');

            randomSpy.mockRestore();
        });

        it('should Persist Q-Table to Disk', async () => {
            const decision: DecisionLog = {
                timestamp: Date.now(),
                action: 'SELL',
                confidence: 80,
                reasoning: 'SaveTest',
                causalFactors: [],
                marketState: {
                    whaleFlow: 'DUMPING',
                    gasPrice: 'HIGH',
                    sentiment: 'FEAR',
                    liquidityDepth: 'THIN',
                    priceAction: 'DUMPING'
                }
            };
            const outcome = { decisionId: 1, profitLoss: 50, capitalAtRisk: 100, slippage: 0, gasUsed: 0, success: true };

            await brain.learnFromOutcome(decision, outcome);

            expect(mockStorage.save).toHaveBeenCalledWith(
                'active_learning_q_table.json', // Must match constant in ActiveLearning.ts
                expect.objectContaining({
                    qTable: expect.any(Object),
                    version: '2.0'
                })
            );
        });
    });
});
