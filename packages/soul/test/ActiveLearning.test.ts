
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActiveLearning, LEARNING_CONFIG } from '../src/eidolon/ActiveLearning';
import { DecisionLog, MarketState } from '../src/eidolon/EidolonTypes';
import { IStorageProvider } from '@clawkit/core';
import { AppendOnlyAdapter } from '@clawkit/core';
import { WasmAdapter as CoreWasmAdapter } from '@clawkit/core';
import { WasmAdapter as SoulWasmAdapter } from '../src/WasmAdapter';

// Mock Storage
const mockStorage = {
    load: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    readLog: vi.fn().mockResolvedValue([]),
    init: vi.fn().mockResolvedValue(undefined)
};

// Mock CausalBrain (optional, but we want to test integration)
// If we don't mock it, it uses the real class which is fine for integration test.

describe('ActiveLearning', () => {
    let learning: ActiveLearning;

    beforeEach(async () => {
        vi.resetAllMocks();
        CoreWasmAdapter.setInstance(SoulWasmAdapter.getInstance());
        mockStorage.load.mockResolvedValue(null); // Default empty
        mockStorage.readLog.mockResolvedValue([]);

        learning = new ActiveLearning(undefined, LEARNING_CONFIG, mockStorage as unknown as IStorageProvider);
        await learning.init();
    });

    it('should initialize with default weights', () => {
        const weights = learning.getWeights();
        expect(weights).toBeDefined();
        expect(weights.gasPrice).toBeDefined();
    });

    it('should learn from successful trade (Q-Learning + Causal)', async () => {
        const marketState: MarketState = {
            gasPrice: 'LOW',
            whaleFlow: 'ACCUMULATING',
            sentiment: 'EUPHORIC',
            liquidityDepth: 'DEEP',
            priceAction: 'PUMPING'
        };

        const decision: DecisionLog = {
            timestamp: Date.now(),
            action: 'BUY',
            confidence: 80,
            reasoning: 'test',
            causalFactors: [],
            marketState
        };

        const outcome = {
            decisionId: decision.timestamp,
            profitLoss: 100, // Profit
            capitalAtRisk: 1000,
            slippage: 0.1,
            gasUsed: 21000,
            success: true
        };

        await learning.learnFromOutcome(decision, outcome);

        // Verify Storage Append (History)
        expect(mockStorage.append).toHaveBeenCalled();

        // Verify Causal Learning (Brain 3.0)
        // We expect it to save Causal Map eventually
        await learning.saveToDisk();
        expect(mockStorage.save).toHaveBeenCalledWith('active_learning_causal.json', expect.any(Object));
    });

    it('should persist brain state correctly', async () => {
        await learning.saveToDisk();
        expect(mockStorage.save).toHaveBeenCalledWith('active_learning_weights.json', expect.any(Object));
        expect(mockStorage.save).toHaveBeenCalledWith('active_learning_causal.json', expect.any(Object));
    });

    it('should load brain state correctly', async () => {
        const mockWeights = {
            weights: { gasPrice: {} },
            version: '1.0',
            learningRate: 0.1,
            adjustmentCount: 0
        };
        const mockCausal = { 'WhaleNetFlow->PriceDelta': { s: 5, f: 0, p: 1.0 } };

        mockStorage.load.mockImplementation((key) => {
            if (key === 'active_learning_weights.json') return Promise.resolve(mockWeights);
            if (key === 'active_learning_causal.json') return Promise.resolve(mockCausal);
            return Promise.resolve(null);
        });

        const newLearning = new ActiveLearning(undefined, LEARNING_CONFIG, mockStorage as unknown as IStorageProvider);
        await newLearning.init();

        // Check internal state (accessing private if possible or via debug/get methods)
        // ActiveLearning doesn't expose CausalBrain directly, but we can check if it saves back what it loaded
        await newLearning.saveToDisk();

        // It should preserve loaded edge counts (probability can be wasm-derived/smoothed).
        const causalSaveCall = mockStorage.save.mock.calls.find(
            ([key]) => key === 'active_learning_causal.json'
        );
        expect(causalSaveCall).toBeDefined();
        const savedCausal = causalSaveCall?.[1] as Record<string, { s: number; f: number; p: number }>;
        expect(savedCausal['WhaleNetFlow->PriceDelta']).toBeDefined();
        expect(savedCausal['WhaleNetFlow->PriceDelta'].s).toBe(5);
        expect(savedCausal['WhaleNetFlow->PriceDelta'].f).toBe(0);
    });

    it('should provide positive causal confidence bias for BUY in supportive state', () => {
        const signal = learning.getCausalSignal({
            gasPrice: 'LOW',
            whaleFlow: 'ACCUMULATING',
            sentiment: 'EUPHORIC',
            liquidityDepth: 'DEEP',
            priceAction: 'RANGING'
        }, 'BUY');

        expect(signal.confidenceDelta).toBeGreaterThan(0);
        expect(signal.explanations.length).toBeGreaterThan(0);
    });

    it('should invert causal confidence bias for SELL', () => {
        const signal = learning.getCausalSignal({
            gasPrice: 'LOW',
            whaleFlow: 'ACCUMULATING',
            sentiment: 'EUPHORIC',
            liquidityDepth: 'DEEP',
            priceAction: 'RANGING'
        }, 'SELL');

        expect(signal.confidenceDelta).toBeLessThan(0);
    });
});
