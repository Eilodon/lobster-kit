use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

pub mod dagma;

pub mod intervenable;

pub use self::intervenable::{CounterfactualResult, Intervenable};

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
        // Laplace smoothing for small samples
        if total == 0 {
            0.5
        } else {
            (self.successes as f32 + 1.0) / (total as f32 + 2.0)
        }
    }
}

// The Core Brain
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalGraph {
    #[wasm_bindgen(skip)]
    pub weights: Vec<Vec<Option<CausalEdge>>>,
    pub node_count: usize,
}

impl Default for CausalGraph {
    fn default() -> Self {
        Self::new(0)
    }
}

#[wasm_bindgen]
impl CausalGraph {
    #[wasm_bindgen(constructor)]
    pub fn new(node_count: usize) -> Self {
        Self {
            weights: vec![vec![None; node_count]; node_count],
            node_count,
        }
    }

    pub fn get_causal_effect(&self, cause: usize, effect: usize) -> f32 {
        if cause < self.node_count && effect < self.node_count {
            if let Some(edge) = &self.weights[cause][effect] {
                return edge.success_prob();
            }
        }
        0.0
    }

    /// Get full edge details (successes/failures/prob) for UI/Adapter
    pub fn get_edge(&self, cause: usize, effect: usize) -> Result<JsValue, JsValue> {
        #[derive(Serialize)]
        struct EdgeSnapshot {
            successes: u32,
            failures: u32,
            probability: f32,
        }

        if cause < self.node_count && effect < self.node_count {
            if let Some(edge) = &self.weights[cause][effect] {
                let snap = EdgeSnapshot {
                    successes: edge.successes,
                    failures: edge.failures,
                    probability: edge.success_prob(),
                };
                return serde_wasm_bindgen::to_value(&snap)
                    .map_err(|e| JsValue::from_str(&e.to_string()));
            }
        }

        let snap = EdgeSnapshot {
            successes: 0,
            failures: 0,
            probability: 0.5,
        };
        serde_wasm_bindgen::to_value(&snap).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    // Bayesian/Causal inference: Given observed variables, predict target
    // Simplified: Linear combination of active causes
    // JS Interface: predict(effect, [[variable_index, value], ...])
    pub fn predict(&self, target_idx: usize, observations: JsValue) -> Result<f32, JsValue> {
        let obs: Vec<(usize, f32)> = serde_wasm_bindgen::from_value(observations)
            .map_err(|e| JsValue::from_str(&format!("predict: invalid observations: {}", e)))?;

        let mut total_weight = 0.0;
        let mut weighted_sum = 0.0;

        if target_idx >= self.node_count {
            return Ok(0.0);
        }

        for (cause_idx, value) in obs {
            if !value.is_finite() || cause_idx >= self.node_count {
                continue;
            }

            if let Some(edge) = &self.weights[cause_idx][target_idx] {
                let w = edge.success_prob();
                weighted_sum += value * w;
                total_weight += w;
            }
        }

        if total_weight == 0.0 {
            Ok(0.0)
        } else {
            Ok(weighted_sum / total_weight)
        }
    }

    /// Neuro-Symbolic Causal Discovery Verification
    pub fn verify_hypothesis(
        &self,
        cause: usize,
        effect: usize,
        direction_positive: bool,
        threshold: f32,
    ) -> bool {
        let prob = self.get_causal_effect(cause, effect);
        if direction_positive {
            prob > 0.5 + threshold
        } else {
            prob < 0.5 - threshold
        }
    }

    /// Returns raw probabilistic evidence weight [0.0 - 1.0] for TS to make decisions
    pub fn get_evidence_weight(&self, cause: usize, effect: usize) -> f32 {
        self.get_causal_effect(cause, effect)
    }

    // "Skin in the game" learning
    pub fn learn(&mut self, cause_idx: usize, effect_idx: usize, outcome_positive: bool) {
        if cause_idx >= self.node_count || effect_idx >= self.node_count {
            return;
        }

        let edge = &mut self.weights[cause_idx][effect_idx];

        if let Some(e) = edge {
            if outcome_positive {
                e.successes = e.successes.saturating_add(1);
            } else {
                e.failures = e.failures.saturating_add(1);
            }
        } else {
            *edge = Some(CausalEdge::new(
                if outcome_positive { 1 } else { 0 },
                if outcome_positive { 0 } else { 1 },
            ));
        }
    }

    /// Export edges as JSON: { "causeIdx->effectIdx": { successes, failures, prob } }
    pub fn export_edges(&self) -> Result<JsValue, JsValue> {
        let mut dump: HashMap<String, CausalEdge> = HashMap::new();

        for i in 0..self.node_count {
            for j in 0..self.node_count {
                if let Some(edge) = &self.weights[i][j] {
                    let key = format!("{}->{}", i, j);
                    dump.insert(key, edge.clone());
                }
            }
        }
        serde_wasm_bindgen::to_value(&dump).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Import edges from JSON
    pub fn import_edges(&mut self, data: JsValue) -> Result<(), JsValue> {
        let dump: HashMap<String, CausalEdge> = serde_wasm_bindgen::from_value(data)
            .map_err(|e| JsValue::from_str(&format!("import_edges: invalid payload: {}", e)))?;

        for row in self.weights.iter_mut() {
            for edge in row.iter_mut() {
                *edge = None;
            }
        }

        for (key, edge) in dump {
            let parts: Vec<&str> = key.split("->").collect();
            if parts.len() != 2 {
                continue;
            }

            if let (Ok(c), Ok(e)) = (parts[0].parse::<usize>(), parts[1].parse::<usize>()) {
                if c < self.node_count && e < self.node_count {
                    self.weights[c][e] = Some(edge);
                }
            }
        }
        Ok(())
    }
}

// Non-WASM methods
impl CausalGraph {
    pub fn set_edge(&mut self, cause: usize, effect: usize, edge: CausalEdge) {
        if cause < self.node_count && effect < self.node_count {
            self.weights[cause][effect] = Some(edge);
        }
    }
}
