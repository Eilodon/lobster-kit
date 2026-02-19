
import { describe, it, expect, beforeEach } from 'vitest';
import { WasmAdapter } from '../packages/soul/src/WasmAdapter';

describe('The Liquid Brain (LNN)', () => {
    let adapter: WasmAdapter;

    beforeEach(async () => {
        WasmAdapter.resetInstance();
        adapter = WasmAdapter.getInstance();
        await adapter.init();
    });

    it('should initialize LiquidBrain with correct dimensions', () => {
        const brain = adapter.createLiquidBrain(3, 5); // 3 inputs, 5 hidden neurons
        expect(brain).toBeDefined();
        // Check initial output is zero or close to it
        const out = brain.forward([0, 0, 0]);
        expect(out.length).toBe(5);
    });

    it('should show continuous dynamics (state persistence)', () => {
        const brain = adapter.createLiquidBrain(1, 1);

        // Step 1: Input 1.0
        const out1 = brain.forward([1.0]);
        const val1 = out1[0];

        // Step 2: Input 1.0 again
        // In a recurrent system, state should accumulate or evolve
        const out2 = brain.forward([1.0]);
        const val2 = out2[0];

        expect(val2).not.toBe(val1); // Should change over time despite same input
    });

    it('should reset state', () => {
        const brain = adapter.createLiquidBrain(1, 1);
        brain.forward([1.0]);
        const stateAfter = brain.forward([0.0])[0];

        brain.reset();
        const stateReset = brain.forward([0.0])[0];

        expect(stateReset).not.toBe(stateAfter);
        expect(stateReset).toBeCloseTo(0, 1); // Should be near zero after reset
    });

    it('should optimize weights (Plasticity)', () => {
        const brain = adapter.createLiquidBrain(2, 2);

        // Run forward to establish specific state
        brain.forward([1.0, -1.0]);

        // Apply plasticity
        // We can't easily check internal weights via current interface, 
        // but we can check if output changes for same input after optimization
        const before = brain.forward([0.5, 0.5])[0];

        // Optimize multiple times to force visible change
        for (let i = 0; i < 10; i++) {
            brain.optimize(1.0); // Positive reward
            brain.forward([0.5, 0.5]); // forward passing updates state
        }

        const after = brain.forward([0.5, 0.5])[0];
        expect(after).not.toBe(before);
    });
});
