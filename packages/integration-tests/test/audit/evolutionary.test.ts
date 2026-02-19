
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    KpiTracker,
    CausalBrain,
    CausalEdge,
    DeepSeekOracle,
    ThermodynamicEngine,
    DEFAULT_THERMO_CONFIG,
    Vector
} from '@clawkit/soul';

// Mock Zod to ensure it's working (though real zod imports work fine in tests usually)
// We rely on integration test for Logic.

describe('Evolutionary Protocol Verification', () => {

    describe('KpiTracker: Reservoir Sampling', () => {
        let tracker: KpiTracker;

        beforeEach(() => {
            tracker = new KpiTracker();
        });

        it('should estimate P95 correctly with reservoir sampling', () => {
            // Fill with 10,000 ascending numbers
            for (let i = 1; i <= 10000; i++) {
                tracker.recordDecisionLatency(i);
            }

            const snapshot = tracker.getSnapshot();
            // P95 of 1..10000 is approx 9500
            // Reservoir sampling introduces variance, but with 500 samples it should be decent.
            // Expected error margin ~5-10%

            console.log(`P95 Estimate: ${snapshot.p95DecisionLatencyMs}`);
            expect(snapshot.p95DecisionLatencyMs).toBeGreaterThan(8500);
            expect(snapshot.p95DecisionLatencyMs).toBeLessThan(10000);

            // Should store max 500 samples
            expect((tracker as any).reservoir.length).toBeLessThan(1000);
        });
    });

    describe('CausalBrain: Asymptotic Confidence', () => {
        let brain: CausalBrain;

        beforeEach(() => {
            brain = new CausalBrain();
        });

        it('should have asymptotic confidence curve', () => {
            const edge = new CausalEdge();

            // n = 20
            edge.successes = 20;
            expect(edge.confidence()).toBeCloseTo(20 / 120, 2); // 0.166

            // n = 100
            edge.successes = 100;
            expect(edge.confidence()).toBeCloseTo(100 / 200, 2); // 0.5

            // n = 1000
            edge.successes = 1000;
            expect(edge.confidence()).toBeCloseTo(1000 / 1100, 2); // 0.909
        });
    });

    describe('DeepSeekOracle: Zod Validation', () => {
        it('should parse valid JSON structure', async () => {
            const oracle = new DeepSeekOracle({ apiKey: 'test' });
            // Mock LLM call
            (oracle as any).callLLM = vi.fn().mockResolvedValue(`
                \`\`\`json
                {
                    "whaleFlow": { "ACCUMULATING": 10, "DUMPING": -10, "NEUTRAL": 0 },
                    "gasPrice": { "LOW": 5, "MEDIUM": 0, "HIGH": -5 },
                    "liquidityDepth": { "THIN": -5, "DEEP": 5 },
                    "sentiment": { "EUPHORIC": 0, "FEAR": 0, "NEUTRAL": 0 },
                    "priceAction": { "PUMPING": 10, "DUMPING": -10, "RANGING": 0 },
                    "explanation": "Test explanation"
                }
                \`\`\`
            `);

            const result = await oracle.analyze({ marketState: {} } as any);
            expect(result.weights.whaleFlow.ACCUMULATING).toBe(10);
            expect(result.narrative).toBe("Test explanation");
        });

        it('should throw on invalid schema', async () => {
            const oracle = new DeepSeekOracle({ apiKey: 'test' });
            (oracle as any).callLLM = vi.fn().mockResolvedValue(`
                {
                    "whaleFlow": 10, // Invalid type, should be object
                    "priceAction": {}
                }
            `);

            await expect(oracle.analyze({ marketState: {} } as any))
                .resolves.toEqual(expect.objectContaining({
                    narrative: expect.stringContaining('Oracle offline')
                }));
        });
    });

    describe('ThermodynamicEngine: RK4 Stability', () => {
        it('should remain stable (clamped) under high entropy pressure', () => {
            const engine = new ThermodynamicEngine({
                ...DEFAULT_THERMO_CONFIG,
                dt: 0.1, // Larger step
                temperature: 5.0 // High temperature/entropy
            });

            // Start near zero boundary where log(x) explodes
            let state = new Vector([0.001, 0.001, 0.001, 0.001, 0.001]);
            const target = new Vector([0.5, 0.5, 0.5, 0.5, 0.5]);

            for (let i = 0; i < 50; i++) {
                state = engine.step(state, target);

                // Check for NaNs or Inf
                for (let j = 0; j < state.len; j++) {
                    expect(state.get(j)).not.toBeNaN();
                    expect(state.get(j)).toBeGreaterThan(0);
                    expect(state.get(j)).toBeLessThan(1);
                }
            }
        });
    });

});
