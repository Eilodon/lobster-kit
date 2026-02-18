import { describe, it, expect, beforeEach } from 'vitest';
import { CausalBrain, CausalEdge } from '../../src/eidolon/ai/CausalBrain';

describe('CausalBrain (Synaptic Plasticity)', () => {
    let brain: CausalBrain;

    beforeEach(() => {
        brain = new CausalBrain();
    });

    it('should load priors correctly', () => {
        const pred = brain.getPrediction('WhaleNetFlow', 'PriceDelta');
        expect(pred.prob).toBeGreaterThan(0.8); // 85/100 = 0.85
        expect(pred.confidence).toBeGreaterThan(0.5);
    });

    it('should learn from new experience', () => {
        // Initially unknown link
        const initial = brain.getPrediction('VolumeSpike', 'Volatility');
        expect(initial.prob).toBe(0.5);
        expect(initial.confidence).toBe(0);

        // Teach it: Volume -> Volatility happened 10 times
        for (let i = 0; i < 10; i++) {
            brain.learn('VolumeSpike', 'Volatility', true);
        }

        const learned = brain.getPrediction('VolumeSpike', 'Volatility');
        expect(learned.prob).toBe(1.0); // 10 successes, 0 failures
        expect(learned.confidence).toBe(0.5); // 10/20 samples
    });

    it('should adjust probability on failure', () => {
        // High confidence prior
        const before = brain.getPrediction('MempoolPendingCnt', 'GasPriceGwei');
        const probBefore = before.prob;

        // Disprove it 50 times (Paradigm Shift)
        for (let i = 0; i < 50; i++) {
            brain.learn('MempoolPendingCnt', 'GasPriceGwei', false);
        }

        const after = brain.getPrediction('MempoolPendingCnt', 'GasPriceGwei');
        expect(after.prob).toBeLessThan(probBefore);
    });

    it('should export synaptic map', () => {
        const map = brain.getSynapticMap();
        expect(map['WhaleNetFlow->PriceDelta']).toBeDefined();
        expect(map['WhaleNetFlow->PriceDelta'].p).toBe(0.85);
    });
});
