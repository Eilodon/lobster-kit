
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActiveLearning, TradeOutcome } from '../packages/core/src/ActiveLearning';
import { ExperienceReplay } from '../packages/core/src/ai/ExperienceReplay';
import { MarketState, ActionType } from '../packages/core/src/types/EidolonTypes';

// Mock dependencies
vi.mock('../packages/core/src/memory/AppendOnlyAdapter', () => {
    return {
        AppendOnlyAdapter: vi.fn().mockImplementation(() => ({
            init: vi.fn(),
            save: vi.fn(),
            load: vi.fn().mockResolvedValue(null),
            append: vi.fn(),
            readLog: vi.fn().mockResolvedValue([]),
        }))
    };
});

describe('Dreaming Engine (Experience Replay)', () => {
    let learning: ActiveLearning;

    beforeEach(async () => {
        vi.clearAllMocks();
        learning = new ActiveLearning();
        await learning.init();
        // Disable auto-save to prevent timer leaks in tests
        learning.setAutoSave(false);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    const mockState: MarketState = {
        gasPrice: 'LOW',
        whaleFlow: 'ACCUMULATING',
        sentiment: 'EUPHORIC',
        liquidityDepth: 'DEEP',
        priceAction: 'PUMPING'
    };

    const mockOutcome: TradeOutcome = {
        decisionId: 123,
        profitLoss: 100,
        capitalAtRisk: 1000,
        slippage: 0.1,
        gasUsed: 0.001,
        success: true
    };

    it('should store experiences in the replay buffer', async () => {
        // Spy on updateQValue BEFORE action
        const spy = vi.spyOn(learning as any, 'updateQValue');

        // 1. Learn from an outcome
        await learning.learnFromOutcome({
            marketState: mockState,
            action: 'BUY',
            timestamp: 1234567890,
            reasoning: 'Test Decision',
            causalFactors: [],
            confidence: 0.8
        } as any, mockOutcome);

        // 2. Reduce buffer visibility or just trust the dream execution
        // Since buffer is private, we can't check size directly easily without casting
        // But we can check if dream() triggers updateQValue



        // 3. Dream!
        learning.dream(1);

        // 4. Verify updateQValue was called twice:
        // Once during learnFromOutcome
        // Once during dream
        expect(spy).toHaveBeenCalledTimes(2);

        // Verify arguments of second call (Dream)
        const args = spy.mock.calls[1];
        expect(args[0]).toEqual(mockState); // State
        expect(args[1]).toBe('BUY');        // Action
        expect(args[2]).toBeGreaterThan(0); // Reward (calculated)
        expect(args[3]).toEqual(mockState); // Next State (Approximation)
    });

    it('should not dream if buffer is empty', () => {
        const spy = vi.spyOn(learning as any, 'updateQValue');
        learning.dream(10);
        expect(spy).toHaveBeenCalledTimes(0);
    });
});
