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
    
    // Pre-allocated buffers for zero-allocation step
    grad_h_buffer: DVector<f32>,
    grad_s_buffer: DVector<f32>,
    dz_buffer: DVector<f32>,
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
            grad_h_buffer: DVector::zeros(dim),
            grad_s_buffer: DVector::zeros(dim),
            dz_buffer: DVector::zeros(dim),
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

    pub fn step(&mut self, state: &mut DVector<f32>, target: &DVector<f32>) {
        let eps = self.config.epsilon;
        let dim = state.len();

        // Calculate grad_h (Energy gradient) and grad_s (Entropy gradient)
        for i in 0..dim {
            self.grad_h_buffer[i] = state[i] - target[i];
            
            let p = state[i].clamp(eps, 1.0 - eps);
            self.grad_s_buffer[i] = -p.ln() * self.config.temperature;
        }

        // GENERIC Equation: dz/dt = L*dH + M*dS
        // Calculate manually to avoid intermediate DVector allocations
        for i in 0..dim {
            let mut rev = 0.0;
            let mut irrev = 0.0;
            
            for j in 0..dim {
                rev += self.poisson_l[(i, j)] * self.grad_h_buffer[j];
                irrev += self.friction_m[(i, j)] * self.grad_s_buffer[j];
            }
            
            self.dz_buffer[i] = rev * self.config.energy_scale + irrev * self.config.entropy_scale;
        }
        
        // Update state in place
        for i in 0..dim {
            let next_val = state[i] + self.dz_buffer[i] * self.config.dt;
            state[i] = next_val.clamp(0.0, 1.0);
        }
    }
}
