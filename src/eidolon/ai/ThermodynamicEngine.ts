import { Vector, Matrix } from './LinearAlgebra';

export interface ThermoConfig {
    dim: number;
    energyScale: number;
    entropyScale: number;
    temperature: number;
    dt: number;
    epsilon: number;
}

export const DEFAULT_THERMO_CONFIG: ThermoConfig = {
    dim: 5, // [arousal, valence, attention, rhythm, momentum]
    energyScale: 1.0,
    entropyScale: 0.1,
    temperature: 1.0,
    dt: 0.05, // 50ms step
    epsilon: 1e-6,
};

/**
 * Thermodynamic Logic Engine
 * Implements GENERIC equation: dz/dt = L·∇H + M·∇S
 */
export class ThermodynamicEngine {
    private poissonL: Matrix;
    private frictionM: Matrix;

    constructor(public config: ThermoConfig = DEFAULT_THERMO_CONFIG) {
        const dim = config.dim;
        this.poissonL = Matrix.zeros(dim, dim);
        this.frictionM = Matrix.zeros(dim, dim);
        this.initMatrices(dim);
    }

    private initMatrices(dim: number) {
        // 1. Poisson Bracket L (Antisymmetric) - Reversible Dynamics
        // Arousal (0) <-> Momentum (4)
        if (dim >= 5) {
            this.poissonL.set(0, 4, 1.0);
            this.poissonL.set(4, 0, -1.0);
        }
        // Valence (1) <-> Arousal (0) (Yerkes-Dodson)
        if (dim >= 2) {
            this.poissonL.set(0, 1, 0.3);
            this.poissonL.set(1, 0, -0.3);
        }
        // Attention (2) <-> Rhythm (3)
        if (dim >= 4) {
            this.poissonL.set(2, 3, 0.5);
            this.poissonL.set(3, 2, -0.5);
        }

        // 2. Friction Matrix M (Symmetric PSD) - Irreversible Dissipation
        for (let i = 0; i < dim; i++) {
            this.frictionM.set(i, i, 0.1); // Base dissipation
        }
        // Momentum dissipates faster
        if (dim >= 5) {
            this.frictionM.set(4, 4, 0.3);
        }
        // Cross-dissipation
        if (dim >= 2) {
            this.frictionM.set(0, 1, 0.05);
            this.frictionM.set(1, 0, 0.05);
        }
    }

    /**
     * Perform one GENERIC step: dz/dt = L·∇H + M·∇S
     */
    step(state: Vector, target: Vector): Vector {
        const gradH = this.energyGradient(state, target);
        const gradS = this.entropyGradient(state);

        // Reversible component: L·∇H
        const reversible = this.poissonL.mulVec(gradH);

        // Irreversible component: M·∇S
        const irreversible = this.frictionM.mulVec(gradS);

        // dz = (L·∇H * EnergyScale) + (M·∇S * EntropyScale)
        const dz = reversible.mul(this.config.energyScale)
            .add(irreversible.mul(this.config.entropyScale));

        // Euler integration: z_new = z + dz * dt
        const next = state.add(dz.mul(this.config.dt));

        return next.clamp(0.0, 1.0);
    }

    /**
     * Energy Gradient ∇H = z - target
     * Drives system towards target state (Exploitation)
     */
    private energyGradient(state: Vector, target: Vector): Vector {
        return state.sub(target);
    }

    /**
     * Entropy Gradient ∇S_i = -T * ln(z_i)
     * Drives system away from boundaries (Exploration)
     */
    private entropyGradient(state: Vector): Vector {
        const grad = Vector.zeros(state.len);
        const eps = this.config.epsilon;

        for (let i = 0; i < state.len; i++) {
            const p = Math.min(Math.max(state.get(i), eps), 1.0 - eps);
            // ∇S pushes towards center (0.5) to maximize entropy
            // Simplified: -ln(p) tends to push away from 0
            grad.set(i, -Math.log(p) * this.config.temperature);
        }
        return grad;
    }

    setTemperature(temp: number) {
        this.config.temperature = Math.max(temp, 0.01);
    }
}
