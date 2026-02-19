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
     * Perform one GENERIC (metriplectic) step:
     * dz/dt = (L - M)·∇H·energyScale + M·∇S·entropyScale
     * Uses Runge-Kutta 4 (RK4) for numerical stability.
     */
    step(state: Vector, target: Vector): Vector {
        const dt = this.config.dt;

        // k1 = f(y)
        const k1 = this.getDerivatives(state, target);

        // k2 = f(y + dt/2 * k1)
        const s2 = state.add(k1.mul(dt / 2));
        const k2 = this.getDerivatives(s2, target);

        // k3 = f(y + dt/2 * k2)
        const s3 = state.add(k2.mul(dt / 2));
        const k3 = this.getDerivatives(s3, target);

        // k4 = f(y + dt * k3)
        const s4 = state.add(k3.mul(dt));
        const k4 = this.getDerivatives(s4, target);

        // y_new = y + dt/6 * (k1 + 2k2 + 2k3 + k4)
        const delta = k1.add(k2.mul(2)).add(k3.mul(2)).add(k4).mul(dt / 6);
        const next = state.add(delta);

        return next.clamp(0.01, 0.99); // Safe clamping away from singularities
    }

    private getDerivatives(state: Vector, target: Vector): Vector {
        // Sanitize state for gradient calculation (avoid log(0))
        const safeState = state.clamp(this.config.epsilon, 1.0 - this.config.epsilon);

        const gradH = this.energyGradient(safeState, target);
        const gradS = this.entropyGradient(safeState);

        // Reversible component: L·∇H
        const reversible = this.poissonL.mulVec(gradH);

        // Irreversible component: M·∇S
        const irreversible = this.frictionM.mulVec(gradS);

        // Dissipative component: -M·∇H
        const dissipation = this.frictionM.mulVec(gradH);

        // dz/dt = (L·∇H - M·∇H) * EnergyScale + (M·∇S * EntropyScale)
        return reversible.sub(dissipation).mul(this.config.energyScale)
            .add(irreversible.mul(this.config.entropyScale));
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
        // 3. Compute Entropy Gradient (Force towards equilibrium 0.5)
        // H(p) = -p*log(p) - (1-p)*log(1-p)
        // dH/dp = log((1-p)/p)
        // FIX A1: Symmetric gradient pushes from both 0 and 1 towards 0.5
        const eps = this.config.epsilon;
        for (let i = 0; i < state.len; i++) {
            const p = Math.min(Math.max(state.get(i), eps), 1.0 - eps);
            const entropyForce = Math.log((1 - p) / p) * this.config.temperature;

            // entropyScale is applied once in step() — do NOT apply here to avoid double-scaling
            grad.set(i, entropyForce);
        }

        return grad;
    }

    setTemperature(temp: number) {
        this.config.temperature = Math.max(temp, 0.01);
    }
}
