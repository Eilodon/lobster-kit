use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct ConversationDomainConfig {
    pub intrusiveness_threshold: f32, // above → requires_simulation()
    pub trust_decay_rate: f32,        // per interaction without rapport
    pub trauma_severity_scale: f32,   // scale user frustration → trauma
    pub dagma_trigger_episodes: u32,  // episodes needed before DAGMA run
    pub thermo_dt: f32,               // conversation time step
}

#[wasm_bindgen]
impl ConversationDomainConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(
        intrusiveness_threshold: f32,
        trust_decay_rate: f32,
        trauma_severity_scale: f32,
        dagma_trigger_episodes: u32,
        thermo_dt: f32,
    ) -> Self {
        Self {
            intrusiveness_threshold,
            trust_decay_rate,
            trauma_severity_scale,
            dagma_trigger_episodes,
            thermo_dt,
        }
    }

    pub fn peer() -> Self {
        Self {
            intrusiveness_threshold: 0.3,
            trust_decay_rate: 0.05,
            trauma_severity_scale: 1.0,
            dagma_trigger_episodes: 50,
            thermo_dt: 0.1,
        }
    }

    pub fn advisory() -> Self {
        Self {
            intrusiveness_threshold: 0.6,
            trust_decay_rate: 0.02,      // Trust decays slowly
            trauma_severity_scale: 1.5,  // High stakes
            dagma_trigger_episodes: 100, // More data needed
            thermo_dt: 0.1,
        }
    }

    pub fn discovery() -> Self {
        Self {
            intrusiveness_threshold: 0.2, // Very low barrier
            trust_decay_rate: 0.1,        // Volatile
            trauma_severity_scale: 0.5,   // Low stakes
            dagma_trigger_episodes: 20,   // Fast learning
            thermo_dt: 0.2,
        }
    }
}
