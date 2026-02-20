use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};

/// Configuration for Thermodynamic Engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThermoConfig {
    pub dim: usize,
    pub energy_scale: f32,
    pub entropy_scale: f32,
    pub temperature: f32,
    pub dt: f32,
    pub epsilon: f32,
}

impl Default for ThermoConfig {
    fn default() -> Self {
        Self {
            dim: 5, // [Volatility, Trend, Liquidity, Cycle, Momentum]
            energy_scale: 1.0,
            entropy_scale: 0.1,
            temperature: 1.0,
            dt: 0.01,
            epsilon: 1e-6,
        }
    }
}

/// Thermodynamic Logic Engine (GENERIC Framework)
#[derive(Debug)]
pub struct ThermodynamicEngine {
    poisson_l: DMatrix<f32>,
    friction_m: DMatrix<f32>,
    config: ThermoConfig,
}

impl ThermodynamicEngine {
    pub fn new(config: ThermoConfig) -> Self {
        let dim = config.dim;
        let mut poisson_l = DMatrix::zeros(dim, dim);
        
        // Volatility (0) <-> Momentum (4) coupling
        if dim >= 5 {
            poisson_l[(0, 4)] = 1.0;
            poisson_l[(4, 0)] = -1.0;
        }
        
        // Trend (1) <-> Volatility (0) coupling
        if dim >= 2 {
            poisson_l[(0, 1)] = 0.3;
            poisson_l[(1, 0)] = -0.3;
        }

        let mut friction_m = DMatrix::zeros(dim, dim);
        for i in 0..dim {
            friction_m[(i, i)] = 0.1;
        }
        
        // Momentum damping
        if dim >= 5 {
            friction_m[(4, 4)] = 0.3; 
        }

        Self {
            poisson_l,
            friction_m,
            config,
        }
    }
    
    /// Compute entropy S = -Σ p_i log(p_i)
    pub fn entropy(&self, state: &DVector<f32>) -> f32 {
        let eps = self.config.epsilon;
        let mut s = 0.0;

        for &p in state.iter() {
            let p_clamped = p.clamp(eps, 1.0 - eps);
            s -= p_clamped * p_clamped.ln();
        }

        s
    }

    pub fn step(&self, state: &DVector<f32>, target: &DVector<f32>) -> DVector<f32> {
        let grad_h = state - target; // Energy gradient
        let mut grad_s = DVector::zeros(state.len()); // Entropy gradient
        
        let eps = self.config.epsilon;
        for i in 0..state.len() {
            let p = state[i].clamp(eps, 1.0 - eps);
            grad_s[i] = -p.ln() * self.config.temperature;
        }

        // GENERIC Equation: dz/dt = L*dH + M*dS
        let reversible = &self.poisson_l * &grad_h;
        let irreversible = &self.friction_m * &grad_s;
        
        let dz = reversible * self.config.energy_scale + irreversible * self.config.entropy_scale;
        
        let mut next = state + dz * self.config.dt;
        
        // Clamp result
        for i in 0..next.len() {
            next[i] = next[i].clamp(0.0, 1.0);
        }
        
        next
    }
}
