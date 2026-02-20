use bevy_ecs::prelude::*;
use crate::sentinel::variables::SentinelVariable;
use crate::sentinel::modes::SentinelMode;
use crate::sentinel::causal::CausalGraph;

// --- Components ---

/// Component attaching a Causal Brain to an entity (e.g., a specific Strategy or Sub-agent)
#[derive(Component)]
pub struct SentinelBrain {
    pub graph: CausalGraph,
    pub last_update: u64,
}

/// Component tracking the current mode of an entity
#[derive(Component)]
pub struct SentinelState {
    pub mode: SentinelMode,
    pub risk_score: f32,
}

/// Component representing an Observation buffer
#[derive(Component)]
pub struct ObservationBuffer {
    pub data: Vec<(SentinelVariable, f32)>,
}

// --- Systems ---

/// System: Update Brain Prediction based on Observations
pub fn causal_inference_system(
    mut query: Query<(&ObservationBuffer, &SentinelBrain, &mut SentinelState)>,
) {
    for (obs, brain, mut state) in query.iter_mut() {
        // Simple heuristic: GasPriceGwei -> Volatility check from logic
        // This connects the specific logic from mod.rs into ECS
        
        let mut max_risk = 0.0;
        
        // Scan observations for triggers
        for (var, val) in &obs.data {
            if *var == SentinelVariable::GasPriceGwei && *val > 0.8 {
                // Check causal edge
                let risk = brain.graph.get_causal_effect(
                    SentinelVariable::GasPriceGwei, 
                    SentinelVariable::Volatility
                );
                if risk > max_risk {
                    max_risk = risk;
                }
            }
        }

        // State Machine Transition
        if max_risk > 0.5 {
            state.mode = SentinelMode::Stalking;
            state.risk_score = max_risk;
        } else {
            state.mode = SentinelMode::Zen;
            state.risk_score = 0.1;
        }
    }
}
