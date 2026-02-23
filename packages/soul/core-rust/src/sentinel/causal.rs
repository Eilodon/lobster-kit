use crate::sentinel::variables::SentinelVariable;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub u16);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimitiveActivation {
    pub primitive: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalRouteHit {
    pub cause_variable: String,
    pub target_variable: String,
    pub score: f32,
    pub active_primitives: Vec<PrimitiveActivation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalGraphV2 {
    pub node_names: Vec<String>,
    pub node_by_name: HashMap<String, NodeId>,
    pub online_edges: HashMap<(u16, u16), CausalEdge>,
    pub primitive_blocks: HashMap<String, HashMap<(u16, u16), f32>>,
    pub prior_edges: HashMap<(u16, u16), f32>,
    pub max_local_primitives: usize,
}

impl Default for CausalGraphV2 {
    fn default() -> Self {
        Self::new()
    }
}

impl CausalGraphV2 {
    pub fn new() -> Self {
        let mut graph = Self {
            node_names: Vec::new(),
            node_by_name: HashMap::new(),
            online_edges: HashMap::new(),
            primitive_blocks: HashMap::new(),
            prior_edges: HashMap::new(),
            max_local_primitives: 3,
        };
        graph.bootstrap_legacy_nodes();
        graph.bootstrap_legacy_priors();
        graph
            .primitive_blocks
            .entry("global".to_string())
            .or_default();
        graph
    }

    fn normalize_name(name: &str) -> String {
        name.trim().to_lowercase()
    }

    fn edge_key(cause: NodeId, effect: NodeId) -> (u16, u16) {
        (cause.0, effect.0)
    }

    fn bootstrap_legacy_nodes(&mut self) {
        for variable in SentinelVariable::all() {
            self.ensure_node(variable.name());
        }
    }

    fn bootstrap_legacy_priors(&mut self) {
        self.set_prior_edge_by_name("MempoolPendingCnt", "GasPriceGwei", 0.95);
        self.set_prior_edge_by_name("GasPriceGwei", "Volatility", 0.60);
        self.set_prior_edge_by_name("WhaleNetFlow", "PriceDelta", 0.85);
        self.set_prior_edge_by_name("Sentiment", "PriceDelta", 0.70);
        self.set_prior_edge_by_name("MacroFactor", "Volatility", 0.80);
        self.set_prior_edge_by_name("LiquidityImbalance", "PriceDelta", 0.75);
        self.set_prior_edge_by_name("SmartMoneyActivity", "WhaleNetFlow", 0.65);
    }

    pub fn ensure_node(&mut self, name: &str) -> NodeId {
        let normalized = Self::normalize_name(name);
        if let Some(id) = self.node_by_name.get(&normalized).copied() {
            return id;
        }

        let id = NodeId(self.node_names.len() as u16);
        self.node_names.push(name.trim().to_string());
        self.node_by_name.insert(normalized, id);
        id
    }

    pub fn node_id(&self, name: &str) -> Option<NodeId> {
        self.node_by_name.get(&Self::normalize_name(name)).copied()
    }

    pub fn node_name(&self, id: NodeId) -> Option<&str> {
        self.node_names.get(id.0 as usize).map(|s| s.as_str())
    }

    pub fn node_count(&self) -> usize {
        self.node_names.len()
    }

    pub fn set_prior_edge_by_name(&mut self, cause_name: &str, effect_name: &str, weight: f32) {
        let cause = self.ensure_node(cause_name);
        let effect = self.ensure_node(effect_name);
        self.prior_edges
            .insert(Self::edge_key(cause, effect), weight.clamp(0.0, 1.0));
    }

    pub fn observe_outcome(
        &mut self,
        cause_name: &str,
        effect_name: &str,
        outcome_positive: bool,
        primitive_name: &str,
        state_weight: f32,
    ) {
        let cause = self.ensure_node(cause_name);
        let effect = self.ensure_node(effect_name);
        let edge_key = Self::edge_key(cause, effect);

        let edge = self
            .online_edges
            .entry(edge_key)
            .or_insert_with(|| CausalEdge::new(0, 0));
        if outcome_positive {
            edge.successes = edge.successes.saturating_add(1);
        } else {
            edge.failures = edge.failures.saturating_add(1);
        }

        let online_prob = edge.success_prob();
        let primitive = {
            let trimmed = primitive_name.trim();
            if trimmed.is_empty() {
                "global".to_string()
            } else {
                Self::normalize_name(trimmed)
            }
        };

        let fallback = self.fallback_edge_weight(cause, effect);
        let block = self.primitive_blocks.entry(primitive).or_default();
        let current = block.get(&edge_key).copied().unwrap_or(fallback);

        let alpha = (0.15 + state_weight.clamp(0.0, 1.0) * 0.35).clamp(0.05, 0.70);
        let updated = (1.0 - alpha) * current + alpha * online_prob;
        block.insert(edge_key, updated.clamp(0.0, 1.0));
    }

    pub fn active_primitives(
        &self,
        query: &str,
        requested: &[String],
        top_k: usize,
    ) -> Vec<(String, f32)> {
        self.active_primitives_with_state(query, requested, &[], top_k)
    }

    pub fn active_primitives_with_state(
        &self,
        query: &str,
        requested: &[String],
        state_features: &[String],
        top_k: usize,
    ) -> Vec<(String, f32)> {
        let mut scores: HashMap<String, f32> = HashMap::new();
        let k = top_k.max(1).min(self.max_local_primitives.max(1));
        let query_lc = query.to_lowercase();
        let normalized_state: Vec<String> = state_features
            .iter()
            .map(|feature| feature.trim().to_lowercase())
            .filter(|feature| !feature.is_empty())
            .collect();

        for requested_name in requested {
            let key = Self::normalize_name(requested_name);
            if self.primitive_blocks.contains_key(&key) {
                *scores.entry(key).or_insert(0.0) += 1.0;
            }
        }

        for primitive in self.primitive_blocks.keys() {
            let mut score = 0.0;
            if query_lc.contains(primitive) {
                score += 1.0;
            }
            for token in primitive.split(|c: char| c == '_' || c == '-' || c == ' ') {
                if !token.is_empty() && query_lc.contains(token) {
                    score += 0.15;
                }
            }

            if !normalized_state.is_empty() {
                for feature in &normalized_state {
                    if primitive.contains(feature) {
                        score += 0.55;
                        continue;
                    }
                    for token in feature.split('_') {
                        if !token.is_empty() && primitive.contains(token) {
                            score += 0.12;
                        }
                    }
                }
            }

            if score > 0.0 {
                *scores.entry(primitive.clone()).or_insert(0.0) += score;
            }
        }

        if scores.is_empty() {
            return vec![("global".to_string(), 1.0)];
        }

        let mut ranked: Vec<(String, f32)> = scores.into_iter().collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        ranked.truncate(k);

        let total: f32 = ranked
            .iter()
            .map(|(_, score)| *score)
            .sum::<f32>()
            .max(1e-6);
        ranked
            .into_iter()
            .map(|(primitive, score)| (primitive, (score / total).clamp(0.0, 1.0)))
            .collect()
    }

    pub fn infer_local_effect_by_name(
        &self,
        cause_name: &str,
        effect_name: &str,
        query: &str,
        requested_primitives: &[String],
        top_k_primitives: usize,
    ) -> f32 {
        let Some(cause) = self.node_id(cause_name) else {
            return 0.0;
        };
        let Some(effect) = self.node_id(effect_name) else {
            return 0.0;
        };
        let active = self.active_primitives(query, requested_primitives, top_k_primitives);
        self.infer_local_effect_ids(cause, effect, &active)
    }

    pub fn rank_causes_for_target(
        &self,
        target_name: &str,
        query: &str,
        requested_primitives: &[String],
        state_features: &[String],
        top_k_primitives: usize,
        top_n: usize,
    ) -> Vec<CausalRouteHit> {
        let Some(target) = self.node_id(target_name) else {
            return Vec::new();
        };

        let active = self.active_primitives_with_state(
            query,
            requested_primitives,
            state_features,
            top_k_primitives,
        );
        let active_json: Vec<PrimitiveActivation> = active
            .iter()
            .map(|(primitive, score)| PrimitiveActivation {
                primitive: primitive.clone(),
                score: *score,
            })
            .collect();

        let mut ranked = Vec::new();
        for (idx, cause_name) in self.node_names.iter().enumerate() {
            let cause = NodeId(idx as u16);
            if cause == target {
                continue;
            }
            let score = self.infer_local_effect_ids(cause, target, &active);
            if score <= 0.0 {
                continue;
            }
            ranked.push(CausalRouteHit {
                cause_variable: cause_name.clone(),
                target_variable: target_name.to_string(),
                score,
                active_primitives: active_json.clone(),
            });
        }

        ranked.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
        ranked.truncate(top_n.max(1));
        ranked
    }

    pub fn attenuate_edge_by_name(
        &mut self,
        cause_name: &str,
        effect_name: &str,
        primitive_name: &str,
        factor: f32,
    ) -> bool {
        let Some(cause) = self.node_id(cause_name) else {
            return false;
        };
        let Some(effect) = self.node_id(effect_name) else {
            return false;
        };
        let edge_key = Self::edge_key(cause, effect);
        let primitive = if primitive_name.trim().is_empty() {
            "global".to_string()
        } else {
            Self::normalize_name(primitive_name)
        };
        let factor = factor.clamp(0.05, 1.0);

        if let Some(block) = self.primitive_blocks.get_mut(&primitive) {
            if let Some(weight) = block.get_mut(&edge_key) {
                *weight = (*weight * factor).clamp(0.0, 1.0);
                return true;
            }
        }
        false
    }

    fn infer_local_effect_ids(
        &self,
        cause: NodeId,
        effect: NodeId,
        active_primitives: &[(String, f32)],
    ) -> f32 {
        let edge_key = Self::edge_key(cause, effect);
        let base = self.fallback_edge_weight(cause, effect);

        if active_primitives.is_empty() {
            return base;
        }

        let mut weighted = 0.0;
        let mut total = 0.0;
        for (primitive, activation) in active_primitives {
            if let Some(block) = self.primitive_blocks.get(primitive) {
                if let Some(edge_weight) = block.get(&edge_key) {
                    weighted += activation * edge_weight;
                    total += activation;
                }
            }
        }

        if total <= 0.0 {
            return base;
        }

        let local = (weighted / total).clamp(0.0, 1.0);
        (0.7 * local + 0.3 * base).clamp(0.0, 1.0)
    }

    fn fallback_edge_weight(&self, cause: NodeId, effect: NodeId) -> f32 {
        let edge_key = Self::edge_key(cause, effect);
        if let Some(edge) = self.online_edges.get(&edge_key) {
            return edge.success_prob().clamp(0.0, 1.0);
        }
        self.prior_edges
            .get(&edge_key)
            .copied()
            .unwrap_or(0.0)
            .clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod v2_tests {
    use super::CausalGraphV2;

    #[test]
    fn v2_bootstrap_keeps_legacy_nodes() {
        let graph = CausalGraphV2::new();
        assert!(graph.node_count() >= 13);
        assert!(graph.node_id("PriceDelta").is_some());
        assert!(graph.node_id("PortfolioRisk").is_some());
    }

    #[test]
    fn v2_compositional_ranking_prefers_active_primitive() {
        let mut graph = CausalGraphV2::new();
        for _ in 0..8 {
            graph.observe_outcome(
                "LiquidityImbalance",
                "PortfolioRisk",
                true,
                "liquidity_shock",
                0.9,
            );
        }
        for _ in 0..3 {
            graph.observe_outcome("MacroFactor", "PortfolioRisk", true, "macro_fear", 0.7);
        }

        let ranked = graph.rank_causes_for_target(
            "PortfolioRisk",
            "why risk increased after liquidity shock",
            &[],
            &[],
            3,
            3,
        );

        assert!(!ranked.is_empty());
        assert_eq!(ranked[0].cause_variable, "LiquidityImbalance");
    }
}
