use serde::{Deserialize, Serialize};
use crate::sentinel::variables::SentinelVariable;

pub mod dagma;
pub mod intervenable;

// Simplified Edge for WASM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalEdge {
    pub successes: u32,
    pub failures: u32,
    pub weight_override: Option<f32>, // Manual override
}

impl CausalEdge {
    pub fn new(successes: u32, failures: u32) -> Self {
        Self {
            successes,
            failures,
            weight_override: None,
        }
    }

    pub fn success_prob(&self) -> f32 {
        if let Some(w) = self.weight_override {
            return w;
        }
        let total = self.successes + self.failures;
        if total == 0 {
            0.5
        } else {
            self.successes as f32 / total as f32
        }
    }
}

// The Core Brain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalGraph {
    // Adjacency matrix: weights[cause][effect]
    weights: Vec<Vec<Option<CausalEdge>>>, 
}

impl Default for CausalGraph {
    fn default() -> Self {
        Self::new()
    }
}

impl CausalGraph {
    pub fn new() -> Self {
        let count = SentinelVariable::COUNT;
        Self {
            weights: vec![vec![None; count]; count],
        }
    }

    pub fn set_edge(&mut self, cause: SentinelVariable, effect: SentinelVariable, edge: CausalEdge) {
        self.weights[cause.index()][effect.index()] = Some(edge);
    }
    
    pub fn get_edge(&self, cause: SentinelVariable, effect: SentinelVariable) -> Option<&CausalEdge> {
        self.weights[cause.index()][effect.index()].as_ref()
    }

    // Predict effect of a SINGLE variable change on another
    pub fn get_causal_effect(&self, cause: SentinelVariable, effect: SentinelVariable) -> f32 {
        if let Some(edge) = self.get_edge(cause, effect) {
             edge.success_prob()
        } else {
            0.0
        }
    }

    // Bayesian/Causal inference: Given observed variables, predict target
    // Simplified: Linear combination of active causes
    pub fn predict(&self, param: SentinelVariable, observations: &[(SentinelVariable, f32)]) -> f32 {
        let target_idx = param.index();
        let mut total_weight = 0.0;
        let mut weighted_sum = 0.0;
        
        for (cause_var, value) in observations {
            if let Some(edge) = &self.weights[cause_var.index()][target_idx] {
                let w = edge.success_prob();
                weighted_sum += value * w;
                total_weight += w;
            }
        }
        
        if total_weight == 0.0 {
            0.0 // No causal link found
        } else {
            weighted_sum / total_weight // Normalized prediction
        }
    }
    
    // "Skin in the game" learning
    pub fn learn(&mut self, cause: SentinelVariable, effect: SentinelVariable, outcome_positive: bool) {
        let edge = &mut self.weights[cause.index()][effect.index()];
        
        if let Some(e) = edge {
            if outcome_positive {
                e.successes += 1;
            } else {
                e.failures += 1;
            }
        } else {
            // Initialize new edge
             *edge = Some(CausalEdge::new(
                 if outcome_positive { 1 } else { 0 },
                 if outcome_positive { 0 } else { 1 }
             ));
        }
    }
}
