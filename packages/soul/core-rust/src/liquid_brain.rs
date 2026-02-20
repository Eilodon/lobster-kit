use wasm_bindgen::prelude::*;

// WASM-compatible wrapper
#[wasm_bindgen]
pub struct LiquidBrain {
    // We can't easily store generic Burn modules in a struct exported to WASM
    // So we'll store specific backend instances or use a simplified inference-only representation for V1
    // OR: Use NdArray backend which is CPU compatible
    
    // For V1 Proof of Concept: We will implement the math manually using raw vectors 
    // to avoid complex generic boundary issues with wasm_bindgen + Burn in this specific file.
    // Real deployment would use Burn's ONNX export or specific backend binding.
    
    weights_ih: Vec<f32>,
    weights_hh: Vec<f32>,
    bias: Vec<f32>,
    state: Vec<f32>,
    // Pre-allocated buffer used by forward() to avoid per-step heap allocations.
    next_state_buffer: Vec<f32>,
    input_size: usize,
    hidden_size: usize,
    time_constant: f32,
}

#[wasm_bindgen]
impl LiquidBrain {
    #[wasm_bindgen(constructor)]
    pub fn new(input_size: usize, hidden_size: usize) -> LiquidBrain {
        // Initialize with deterministic small weights.
        let size = input_size * hidden_size;
        let weights_ih = vec![0.01; size]; 
        let weights_hh = vec![0.01; hidden_size * hidden_size];
        let bias = vec![0.0; hidden_size];
        let state = vec![0.0; hidden_size];
        let next_state_buffer = vec![0.0; hidden_size];

        LiquidBrain {
            weights_ih,
            weights_hh,
            bias,
            state,
            next_state_buffer,
            input_size,
            hidden_size,
            time_constant: 1.0, 
        }
    }

    pub fn forward(&mut self, input: Vec<f32>) -> Vec<f32> {
        if input.len() != self.input_size {
            return Vec::new();
        }

        // x_t = x_{t-1} + dt * (-(x_{t-1} - tanh(W*u + U*x_{t-1} + b)) / tau)
        // Write into the pre-allocated buffer, then swap buffers in O(1).
        for h in 0..self.hidden_size {
            let mut pre_act = self.bias[h];
            
            // W * u
            for i in 0..self.input_size {
                pre_act += self.weights_ih[h * self.input_size + i] * input[i];
            }
            
            // U * x_{t-1}
            for i in 0..self.hidden_size {
                pre_act += self.weights_hh[h * self.hidden_size + i] * self.state[i];
            }
            
            let update_target = pre_act.tanh();
            let current = self.state[h];
            let delta = (update_target - current) / self.time_constant;
            
            // Continuous adaptation: Time constant could also be dynamic!
            // For now, fixed.
            
            self.next_state_buffer[h] = current + delta; // dt=1.0 derived
        }

        std::mem::swap(&mut self.state, &mut self.next_state_buffer);
        self.state.clone()
    }
    
    pub fn reset(&mut self) {
        self.state.fill(0.0);
        self.next_state_buffer.fill(0.0);
    }
    
    // Plasticity: Hebbian-like update
    pub fn optimize(&mut self, reward_signal: f32) {
        // If reward is positive, strengthen connections that were active
        // If negative, weaken them.
        
        let learning_rate = 0.001 * reward_signal;
        
        // Simple rule: dW = lr * post * pre
        // Not true backprop, but "Fluid Intelligence" adaptation
        
        // Update HH weights to stabilize dynamics
        for h in 0..self.hidden_size {
            for i in 0..self.hidden_size {
                let idx = h * self.hidden_size + i;
                let change = learning_rate * self.state[h] * self.state[i]; 
                self.weights_hh[idx] += change;
                
                // Clamp to avoid explosion
                self.weights_hh[idx] = self.weights_hh[idx].clamp(-1.0, 1.0);
            }
        }
    }
}
