import { describe, it, expect } from 'vitest';
import { ThermodynamicEngine, DEFAULT_THERMO_CONFIG } from '../src/eidolon/ai/ThermodynamicEngine';
import { Vector } from '../src/eidolon/ai/LinearAlgebra';

describe('ThermodynamicEngine', () => {
    it('should initialize with default config', () => {
        const engine = new ThermodynamicEngine();
        expect(engine.config).toEqual(DEFAULT_THERMO_CONFIG);
    });

    it('should bound state between 0 and 1', () => {
        const engine = new ThermodynamicEngine({
            ...DEFAULT_THERMO_CONFIG,
            energyScale: 100.0, // Force large moves
            dt: 1.0
        });

        // Start near edge, push further
        const state = new Vector([0.9, 0.9, 0.9, 0.9, 0.9]);
        const target = new Vector([2.0, 2.0, 2.0, 2.0, 2.0]); // Impossible target

        const nextState = engine.step(state, target);

        for (let i = 0; i < nextState.len; i++) {
            expect(nextState.get(i)).toBeLessThanOrEqual(1.0);
            expect(nextState.get(i)).toBeGreaterThanOrEqual(0.0);
        }
    });

    it('should converge towards target state (Energy Minimization)', () => {
        const engine = new ThermodynamicEngine({
            ...DEFAULT_THERMO_CONFIG,
            entropyScale: 0.0, // Turn off entropy to test pure energy flow
            energyScale: 0.5
        });

        const start = new Vector([0.5, 0.5, 0.5, 0.5, 0.5]);
        const target = new Vector([0.8, 0.8, 0.8, 0.8, 0.8]);

        let state = start;
        // Run a few steps
        for (let i = 0; i < 10; i++) {
            state = engine.step(state, target);
        }

        // Distance should decrease
        const initialDist = start.sub(target).norm();
        const finalDist = state.sub(target).norm();

        expect(finalDist).toBeLessThan(initialDist);
    });

    it('should resist extreme states due to Entropy', () => {
        const engine = new ThermodynamicEngine({
            ...DEFAULT_THERMO_CONFIG,
            temperature: 2.0, // High temp = high entropy force
            entropyScale: 0.5,
            energyScale: 0.0 // No target pull
        });

        // Start at very low probability state (near 0)
        const start = new Vector([0.01, 0.01, 0.01, 0.01, 0.01]);
        const target = start; // Irrelevant

        const next = engine.step(start, target);

        // Should be pushed towards 0.5 (max entropy)
        expect(next.get(0)).toBeGreaterThan(start.get(0));
    });
});
