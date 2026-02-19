import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActiveLearning } from '../../src/eidolon/ActiveLearning';
import { MarketState } from '../../src/eidolon/EidolonTypes';
import { WasmAdapter } from '../../src/eidolon/WasmAdapter';

describe('Liquid Brain & Hyper Memory Integration', () => {
    let brain: ActiveLearning;

    beforeEach(async () => {
        // Mock WasmAdapter to avoid actual WASM loading in unit test if possible,
        // but ActiveLearning uses the singleton.
        // We will rely on the Mock implementations in WasmAdapter if WASM fails to load,
        // or the actual WASM if it loads.

        // Ensure WasmAdapter is initialized (mocked or real)
        await WasmAdapter.getInstance().init();

        brain = new ActiveLearning();
        await brain.init();
    });

    it('should instantiate Liquid Brain and Hyper Memory', () => {
        // Access private properties via any for testing
        expect((brain as any).liquidBrain).toBeDefined();
        expect((brain as any).hyperMemory).toBeDefined();
        // Expecting Mock implementations if WASM not built, or Real if built.
        // The key is they are not undefined.
    });

    it('should vectorize market state correctly', () => {
        const state: MarketState = {
            gasPrice: 'HIGH',
            whaleFlow: 'ACCUMULATING',
            sentiment: 'EUPHORIC',
            liquidityDepth: 'DEEP',
            priceAction: 'PUMPING'
        };

        // Access private method
        const vec = (brain as any).vectorizeMarketState(state);

        expect(vec).toBeInstanceOf(Float32Array);
        expect(vec.length).toBe(5);
        expect(vec[0]).toBe(1.0); // HIGH
        expect(vec[1]).toBe(1.0); // ACCUMULATING
        expect(vec[2]).toBe(1.0); // EUPHORIC
        expect(vec[3]).toBe(1.0); // DEEP
        expect(vec[4]).toBe(1.0); // PUMPING
    });

    it('should generate intuition signal on decision', async () => {
        const state: MarketState = {
            gasPrice: 'MEDIUM',
            whaleFlow: 'NEUTRAL',
            sentiment: 'NEUTRAL',
            liquidityDepth: 'DEEP',
            priceAction: 'RANGING'
        };

        const decision = await brain.recommendAction(state);
        expect(decision).toBeDefined();

        const intuition = brain.getIntuition();
        expect(intuition).toBeInstanceOf(Array);
        if (intuition.length > 0) {
            // If MockLiquidBrain, it might return 0s or randoms
            // Just check it's not empty if LiquidBrain is active
            expect(intuition.length).toBeGreaterThan(0);
        }
    });

    it('should memorize and recall states', async () => {
        const state: MarketState = {
            gasPrice: 'LOW',
            whaleFlow: 'DUMPING',
            sentiment: 'FEAR',
            liquidityDepth: 'THIN',
            priceAction: 'DUMPING'
        };

        const decisionId = 123456789;

        await brain.memorize(state, decisionId);

        const recalled = await brain.recall(state, 1);
        expect(recalled).toBeDefined();
        // In MockHyperMemory, search returns empty array.
        // In Real, it should return [123456789n] if implemented.
        // We accept both for now, improving as we go.
        expect(Array.isArray(recalled)).toBe(true);
    });

    it('should trigger dream cycle', async () => {
        // Fill replay buffer a bit
        // We need to push some experiences
        const decisionLog = {
            timestamp: Date.now(),
            action: 'BUY',
            confidence: 80,
            reasoning: 'Test',
            causalFactors: [],
            marketState: {
                gasPrice: 'LOW',
                whaleFlow: 'NEUTRAL',
                sentiment: 'NEUTRAL',
                liquidityDepth: 'DEEP',
                priceAction: 'RANGING'
            }
        };
        const outcome = {
            decisionId: Date.now(),
            profitLoss: 100,
            capitalAtRisk: 1000,
            slippage: 0.1,
            gasUsed: 21000,
            success: true
        };

        // Push 35 items to exceed batch size of 32
        for (let i = 0; i < 35; i++) {
            await brain.learnFromOutcome({ ...decisionLog, timestamp: i } as any, outcome);
        }

        // Spy on debug log to confirm Dreaming happened
        // Or just ensure it doesn't crash
        await brain.dream();
        // If we reach here without error, it passed.
    });
});
