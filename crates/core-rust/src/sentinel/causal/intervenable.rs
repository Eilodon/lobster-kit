use crate::sentinel::causal::CausalGraph;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct CounterfactualResult {
    pub actual_prob: f32,
    pub hypothetical_prob: f32,
    pub would_have_been_better: bool,
    pub delta: f32,
}

#[wasm_bindgen]
pub struct Intervenable;

#[wasm_bindgen]
impl Intervenable {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self
    }

    /// Pearl's do-calculus: P(Y | do(X=x))
    pub fn do_intervention(
        &self,
        graph: &CausalGraph,
        intervention_var: usize,
        intervention_value: f32,
        query_var: usize,
    ) -> Result<f32, JsValue> {
        // Direct effect causal inference: P(Y | do(X=x)) ≈ x * P(Y|X)
        let effect_strength = graph.get_causal_effect(intervention_var, query_var);
        Ok(intervention_value * effect_strength)
    }

    /// Counterfactual: "What WOULD have happened if I chose differently?"
    pub fn counterfactual(
        &self,
        graph: &CausalGraph,
        actual_var: usize,
        hypothetical_var: usize,
        query_var: usize,
    ) -> Result<CounterfactualResult, JsValue> {
        let p_actual = self.do_intervention(graph, actual_var, 1.0, query_var)?;
        let p_hypo = self.do_intervention(graph, hypothetical_var, 1.0, query_var)?;

        Ok(CounterfactualResult {
            actual_prob: p_actual,
            hypothetical_prob: p_hypo,
            would_have_been_better: p_hypo > p_actual,
            delta: p_hypo - p_actual,
        })
    }
}
