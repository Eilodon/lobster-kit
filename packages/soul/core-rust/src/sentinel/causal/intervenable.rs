use wasm_bindgen::prelude::*;
use crate::sentinel::causal::CausalGraph;
use crate::sentinel::variables::SentinelVariable;

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
    /// Cut all incoming edges to X, set X=x, propagate forward.
    /// Simplified implementation for the DAG:
    /// Since our predict() is a linear combination, observing X=1 is similar to do(X=1) IF we ignore back-door paths (confounders).
    /// In our simplified CausalGraph, we treat all parents as direct causes.
    /// To strictly implement do(X), we need to ensure X's value is fixed regardless of its parents.
    /// 
    /// However, our predict() function takes `observations` list. If X is in observations, it is effectively "clamped".
    /// The difference between observation `P(Y|X)` and intervention `P(Y|do(X))` matters if X has parents that also affect Y (Confounders).
    /// 
    /// For this version, we will perform "Mutilated Graph" intervention:
    /// 1. Clone graph (conceptually - we just ignore incoming edges to X).
    /// 2. But `predict` logic already sums over *provided* observations.
    ///    If we provide X in observations, and we compute Y based on X, we are forward propagating.
    ///    Does `predict` look at X's parents? `predict` logic:
    ///    `weighted_sum += value * w` for each observed cause.
    ///    It assumes observations are the *only* active causes or the *known* state of causes.
    ///    It does NOT recursivley calculate unobserved causes.
    ///    So in our specific implementation, `predict(Y, [X=x])` IS effectively `P(Y|do(X=x))` because we don't back-propagate to confounders.
    /// 
    /// So we can wrap `predict` but with explicit semantic meaning.
    pub fn do_intervention(
        &self,
        graph: &CausalGraph,
        intervention_var: SentinelVariable,
        intervention_value: f32,
        query_var: SentinelVariable,
    ) -> Result<f32, JsValue> {
        // Direct effect causal inference: P(Y | do(X=x)) ≈ x * P(Y|X)
        // This assumes X is a direct cause of Y and we are measuring the strength of that link.
        let effect_strength = graph.get_causal_effect(intervention_var, query_var);
        Ok(intervention_value * effect_strength)
    }

    /// Counterfactual: "What WOULD have happened if I chose differently?"
    /// actual_var: "I chose AdvisorMode (Observation)"
    /// hypothetical_var: "I chose PeerMode (Intervention)"
    /// query_var: "OutcomeQuality"
    pub fn counterfactual(
        &self,
        graph: &CausalGraph,
        actual_var: SentinelVariable,
        hypothetical_var: SentinelVariable,
        query_var: SentinelVariable,
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
