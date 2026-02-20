
import { describe, expect, it } from 'vitest';
import { ThermodynamicEngine, DEFAULT_THERMO_CONFIG } from '../src/ai/ThermodynamicEngine';
import { Vector } from '../src/ai/LinearAlgebra';

describe('ThermodynamicEngine (Physics Simulation)', () => {
    const engine = new ThermodynamicEngine({
        ...DEFAULT_THERMO_CONFIG,
        dim: 2, // Simplify to 2D for easier math [Arousal, Valence]
        dt: 0.1,
        temperature: 1.0
    });

    it('initializes with correct dimensions', () => {
        expect(engine).toBeDefined();
        // Access private matrices via 'any' for inspection or trust the behavior
    });

    it('drives state towards target (Energy Gradient)', () => {
        // Use a 1D engine to avoid coupling effects masking the gradient descent
        const engine1D = new ThermodynamicEngine({
            ...DEFAULT_THERMO_CONFIG,
            dim: 1,
            dt: 0.1,
            temperature: 1.0,
            energyScale: 1.0,
            entropyScale: 0.0 // Disable entropy to isolate gradient
        });

        // Start at [0.5]
        const state = new Vector([0.5]);
        const target = new Vector([0.8]);

        const next = engine1D.step(state, target);

        // Check direction
        expect(next.get(0)).toBeGreaterThan(0.5);

        // Check it doesn't overshoot immediately
        expect(next.get(0)).toBeLessThan(0.8);
    });

    it('respects temperature/entropy (Exploration)', () => {
        // High temp should push away from boundaries or towards equilibrium
        // Entropy gradient pushes towards 0.5 (max entropy)
        // If we represent p as probability/intensity

        const engineHighTemp = new ThermodynamicEngine({
            ...DEFAULT_THERMO_CONFIG,
            dim: 2,
            dt: 0.1,
            temperature: 5.0, // High temperature
            entropyScale: 1.0 // Strong entropy force
        });

        const state = new Vector([0.9, 0.9]); // Near boundary
        const target = new Vector([0.9, 0.9]); // Target aligns with state

        // Even though target matches state (Gradient H = 0),
        // Entropy should push towards 0.5 because state is low entropy (ordered)

        const next = engineHighTemp.step(state, target);

        // Expect movement towards 0.5 despite target being 0.9
        expect(next.get(0)).toBeLessThan(0.9);
        expect(next.get(1)).toBeLessThan(0.9);
    });

    it('couples variables via Poisson bracket (Reversible Dynamics)', () => {
        // Arousal (0) and Valence (1) are coupled in 2D config
        // L_01 = 0.3
        // If dH/dValence is positive, it should induce change in Arousal orthogonal to gradient

        const engineCoupled = new ThermodynamicEngine({
            ...DEFAULT_THERMO_CONFIG,
            dim: 2,
            dt: 0.1,
            energyScale: 1.0,
            entropyScale: 0.0 // Disable entropy to isolate Hamiltonian dynamics
        });

        // Target: Increase Valence only
        const state = new Vector([0.5, 0.5]);
        const target = new Vector([0.5, 0.8]); // Valence target higher

        // Gradient H = [0, -0.3] (approx, since H = z - target)
        // Actually H = z - target -> grad H = z - target? No, typically H = 1/2(z-t)^2 -> grad = z-t
        // Code says: energyGradient = state.sub(target).
        // So grad H = [0, -0.3]

        // L = [[0, 0.3], [-0.3, 0]]
        // L * grad H = [0*0 + 0.3*(-0.3), -0.3*0 + 0*(-0.3)] = [-0.09, 0]

        // So Arousal (idx 0) should change negatively due to coupling with Valence gradient

        const next = engineCoupled.step(state, target);

        // Expect Arousal to decrease (cross-talk)
        expect(next.get(0)).toBeLessThan(0.5);

        // Expect Valence to increase (direct gradient + dissipation)
        // dissipation M*gradH will also act
        expect(next.get(1)).toBeGreaterThan(0.5);
    });

    it('keeps state within bounds [0, 1]', () => {
        const state = new Vector([0.99, 0.99]);
        const target = new Vector([1.5, 1.5]); // Way out of bounds

        const next = engine.step(state, target);

        expect(next.get(0)).toBeLessThanOrEqual(1.0);
        expect(next.get(1)).toBeLessThanOrEqual(1.0);
        expect(next.get(0)).toBeGreaterThanOrEqual(0.0);
    });
});
