use crate::sentinel::variables::SentinelVariable;
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
    // Adjacency matrix: weights[cause][effect]
    #[wasm_bindgen(skip)]
    pub weights: Vec<Vec<Option<CausalEdge>>>,
}

impl Default for CausalGraph {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl CausalGraph {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let count = SentinelVariable::COUNT;
        Self {
            weights: vec![vec![None; count]; count],
        }
    }

    // set_edge moved to non-wasm impl block below

    // Internal get_edge using SentinelVariable (not exposed to JS directly if SentinelVariable is not fully compatible in return types without copy)
    // But we will expose a JS friendly version below if needed.

    pub fn get_causal_effect(&self, cause: SentinelVariable, effect: SentinelVariable) -> f32 {
        if let Some(edge) = &self.weights[cause.index()][effect.index()] {
            edge.success_prob()
        } else {
            0.0
        }
    }

    /// Get full edge details (successes/failures/prob) for UI/Adapter
    pub fn get_edge(
        &self,
        cause: SentinelVariable,
        effect: SentinelVariable,
    ) -> Result<JsValue, JsValue> {
        if let Some(edge) = &self.weights[cause.index()][effect.index()] {
            // Create a struct that matches what TS expects if needed,
            // or just return CausalEdge which has successes/failures
            // The TS adapter expects: { successes, failures, probability }
            // CausalEdge has successes, failures. We can just return it and let TS compute prob,
            // OR return a custom object.
            // Legacy returned: { successes, failures, probability }

            #[derive(Serialize)]
            struct EdgeSnapshot {
                successes: u32,
                failures: u32,
                probability: f32,
            }

            let snap = EdgeSnapshot {
                successes: edge.successes,
                failures: edge.failures,
                probability: edge.success_prob(),
            };

            serde_wasm_bindgen::to_value(&snap).map_err(|e| JsValue::from_str(&e.to_string()))
        } else {
            // Return zero-edge? Legacy returned default 0/0.
            #[derive(Serialize)]
            struct EdgeSnapshot {
                successes: u32,
                failures: u32,
                probability: f32,
            }
            let snap = EdgeSnapshot {
                successes: 0,
                failures: 0,
                probability: 0.5,
            };
            serde_wasm_bindgen::to_value(&snap).map_err(|e| JsValue::from_str(&e.to_string()))
        }
    }

    // Bayesian/Causal inference: Given observed variables, predict target
    // Simplified: Linear combination of active causes
    // JS Interface: predict(effect, [{variable, value}, ...])
    pub fn predict(&self, param: SentinelVariable, observations: JsValue) -> Result<f32, JsValue> {
        // Deserialize as (index, value) tuples to support JS numbers
        let obs: Vec<(usize, f32)> = serde_wasm_bindgen::from_value(observations)
            .map_err(|e| JsValue::from_str(&format!("predict: invalid observations: {}", e)))?;

        let target_idx = param.index();
        let mut total_weight = 0.0;
        let mut weighted_sum = 0.0;

        for (cause_idx, value) in obs {
            // Skip non-finite values
            if !value.is_finite() {
                continue;
            }

            // Bounds check
            if cause_idx >= SentinelVariable::COUNT {
                continue;
            }

            if let Some(edge) = &self.weights[cause_idx][target_idx] {
                let w = edge.success_prob();
                weighted_sum += value * w;
                total_weight += w;
            }
        }

        if total_weight == 0.0 {
            Ok(0.0) // No causal link found
        } else {
            Ok(weighted_sum / total_weight) // Normalized prediction
        }
    }

    /// Neuro-Symbolic Causal Discovery Verification
    /// Validates an LLM-generated hypothesis against mathematical evidence.
    pub fn verify_hypothesis(
        &self,
        cause: SentinelVariable,
        effect: SentinelVariable,
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
    pub fn get_evidence_weight(&self, cause: SentinelVariable, effect: SentinelVariable) -> f32 {
        self.get_causal_effect(cause, effect)
    }

    // "Skin in the game" learning
    pub fn learn(
        &mut self,
        cause: SentinelVariable,
        effect: SentinelVariable,
        outcome_positive: bool,
    ) {
        let cause_idx = cause.index();
        let effect_idx = effect.index();

        // Check bounds just in case
        if cause_idx >= SentinelVariable::COUNT || effect_idx >= SentinelVariable::COUNT {
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
            // Initialize new edge
            *edge = Some(CausalEdge::new(
                if outcome_positive { 1 } else { 0 },
                if outcome_positive { 0 } else { 1 },
            ));
        }
    }

    /// Export edges as JSON: { "CauseName->EffectName": { successes, failures, prob } }
    pub fn export_edges(&self) -> Result<JsValue, JsValue> {
        let mut dump: HashMap<String, CausalEdge> = HashMap::new();
        let vars = SentinelVariable::all();

        for (i, row) in self.weights.iter().enumerate() {
            for (j, edge_opt) in row.iter().enumerate() {
                if let Some(edge) = edge_opt {
                    let cause = vars[i];
                    let effect = vars[j];
                    let key = format!("{}->{}", cause.name(), effect.name());
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

        // Reset graph? Or merge? Legacy merged/cleared. Let's merge or clear.
        // Legacy `import_edges` cleared first.
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

            let cause_name = parts[0];
            let effect_name = parts[1];

            // Find variables by name - simplistic search
            let cause = SentinelVariable::all()
                .iter()
                .find(|v| v.name() == cause_name);
            let effect = SentinelVariable::all()
                .iter()
                .find(|v| v.name() == effect_name);

            if let (Some(c), Some(e)) = (cause, effect) {
                self.weights[c.index()][e.index()] = Some(edge);
            }
        }
        Ok(())
    }
}

// Non-WASM methods
impl CausalGraph {
    pub fn set_edge(
        &mut self,
        cause: SentinelVariable,
        effect: SentinelVariable,
        edge: CausalEdge,
    ) {
        self.weights[cause.index()][effect.index()] = Some(edge);
    }
}
