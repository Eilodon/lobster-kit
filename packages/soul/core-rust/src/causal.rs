use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct CausalEdge {
    pub successes: u32,
    pub failures: u32,
}

impl CausalEdge {
    fn success_prob(&self) -> f32 {
        let total = self.successes + self.failures;
        // Laplace Smoothing: (success + 1) / (total + 2)
        // Prevents 1/1 = 100% confidence.
        (self.successes as f32 + 1.0) / (total as f32 + 2.0)
    }
}

#[derive(Serialize)]
struct EdgeSnapshot {
    successes: u32,
    failures: u32,
    probability: f32,
}

#[derive(Deserialize)]
struct EdgeImportSnapshot {
    successes: Option<u32>,
    failures: Option<u32>,
    s: Option<u32>,
    f: Option<u32>,
}

#[wasm_bindgen]
pub struct CausalGraph {
    edges: HashMap<(u8, u8), CausalEdge>,
}

#[wasm_bindgen]
impl CausalGraph {
    #[wasm_bindgen(constructor)]
    pub fn new() -> CausalGraph {
        let mut graph = CausalGraph {
            edges: HashMap::new(),
        };
        graph.load_priors();
        graph
    }


    pub fn learn(&mut self, cause: u8, effect: u8, outcome_positive: bool) {
        let edge = self
            .edges
            .entry((cause, effect))
            .or_insert(CausalEdge {
                successes: 0,
                failures: 0,
            });

        if outcome_positive {
            edge.successes += 1;
        } else {
            edge.failures += 1;
        }
    }

    pub fn predict(&self, effect: u8, observations: JsValue) -> Result<f32, JsValue> {
        let obs: Vec<(u8, f32)> = serde_wasm_bindgen::from_value(observations)
            .map_err(|e| JsValue::from_str(&format!("invalid observations: {}", e)))?;

        let mut weighted_sum = 0.0f32;
        let mut total_weight = 0.0f32;

        for (cause, value) in obs {
            // BUG FIX #3: NaN/Inf in observations would propagate silently into
            // weighted_sum, returning NaN to the TS caller with no indication of the problem.
            // Skip non-finite values instead — treat as "no observation".
            if !value.is_finite() {
                continue;
            }
            if let Some(edge) = self.edges.get(&(cause, effect)) {
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


    pub fn get_edge(&self, cause: u8, effect: u8) -> Result<JsValue, JsValue> {
        let edge = self.edges.get(&(cause, effect)).copied().unwrap_or(CausalEdge {
            successes: 0,
            failures: 0,
        });

        serde_wasm_bindgen::to_value(&EdgeSnapshot {
            successes: edge.successes,
            failures: edge.failures,
            probability: edge.success_prob(),
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn export_edges(&self) -> Result<JsValue, JsValue> {
        let mut dump: HashMap<String, EdgeSnapshot> = HashMap::new();
        for ((cause, effect), edge) in self.edges.iter() {
            dump.insert(
                format!("{}->{}", cause, effect),
                EdgeSnapshot {
                    successes: edge.successes,
                    failures: edge.failures,
                    probability: edge.success_prob(),
                },
            );
        }

        serde_wasm_bindgen::to_value(&dump).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn import_edges(&mut self, edges: JsValue) -> Result<(), JsValue> {
        let parsed: HashMap<String, EdgeImportSnapshot> = serde_wasm_bindgen::from_value(edges)
            .map_err(|e| JsValue::from_str(&format!("invalid edge payload: {}", e)))?;

        if parsed.is_empty() {
            return Ok(());
        }

        self.edges.clear();
        for (key, edge) in parsed {
            let Some((cause, effect)) = Self::parse_edge_key(&key) else {
                continue;
            };
            let successes = edge.successes.or(edge.s).unwrap_or(0);
            let failures = edge.failures.or(edge.f).unwrap_or(0);
            self.edges.insert(
                (cause, effect),
                CausalEdge {
                    successes,
                    failures,
                },
            );
        }

        if self.edges.is_empty() {
            self.load_priors();
        }

        Ok(())
    }
}

impl CausalGraph {
    fn parse_edge_key(key: &str) -> Option<(u8, u8)> {
        let mut parts = key.split("->");
        let cause = parts.next()?.parse::<u8>().ok()?;
        let effect = parts.next()?.parse::<u8>().ok()?;
        if parts.next().is_some() {
            return None;
        }
        Some((cause, effect))
    }

    fn set_prior(&mut self, cause: u8, effect: u8, successes: u32, failures: u32) {
        self.edges.insert((cause, effect), CausalEdge { successes, failures });
    }

    fn load_priors(&mut self) {
        // Canonical priors aligned with TS CausalBrain.
        self.set_prior(5, 4, 95, 5); // MempoolPendingCnt -> GasPriceGwei
        self.set_prior(4, 2, 60, 40); // GasPriceGwei -> Volatility
        self.set_prior(6, 0, 85, 15); // WhaleNetFlow -> PriceDelta
        self.set_prior(11, 0, 70, 30); // Sentiment -> PriceDelta
        self.set_prior(12, 2, 80, 20); // MacroFactor -> Volatility
        self.set_prior(7, 0, 75, 25); // LiquidityImbalance -> PriceDelta
        self.set_prior(8, 6, 65, 35); // SmartMoneyActivity -> WhaleNetFlow
    }
}

impl Default for CausalGraph {
    fn default() -> Self {
        Self::new()
    }
}
