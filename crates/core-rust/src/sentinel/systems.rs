use crate::sentinel::causal::CausalGraph;
use crate::sentinel::modes::SentinelMode;
use crate::sentinel::variables::SentinelVariable;

// Define types that can be exposed if needed, or keep them internal.
#[derive(Debug, Clone)]
pub enum CognitiveEvent {
    Observe { data: Vec<(SentinelVariable, f32)> },
    Evaluate,
}

/// The core Sentinel Agent implemented as an Event-Driven Actor
pub struct SentinelActor {
    pub graph: CausalGraph,
    pub mode: SentinelMode,
    pub risk_score: f32,
}

impl SentinelActor {
    pub fn new() -> Self {
        Self {
            graph: CausalGraph::new(),
            mode: SentinelMode::Zen,
            risk_score: 0.1,
        }
    }

    /// Process a single event synchronously from JS
    pub fn process_event(&mut self, event: CognitiveEvent) {
        match event {
            CognitiveEvent::Observe { data } => {
                self.handle_observation(data);
            }
            CognitiveEvent::Evaluate => {
                // Evaluation logic
            }
        }
    }

    fn handle_observation(&mut self, data: Vec<(SentinelVariable, f32)>) {
        let mut max_risk = 0.0;

        for (var, val) in data {
            if var == SentinelVariable::GasPriceGwei && val > 0.8 {
                let risk = self.graph.get_causal_effect(
                    SentinelVariable::GasPriceGwei,
                    SentinelVariable::Volatility,
                );
                if risk > max_risk {
                    max_risk = risk;
                }
            }
        }

        if max_risk > 0.5 {
            self.mode = SentinelMode::Stalking;
            self.risk_score = max_risk;
        } else {
            self.mode = SentinelMode::Zen;
            self.risk_score = 0.1;
        }
    }
}
