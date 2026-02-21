use crate::sentinel::variables::SentinelVariable;
use crate::sentinel::modes::SentinelMode;
use crate::sentinel::causal::CausalGraph;
use tokio::sync::mpsc;
use wasm_bindgen::prelude::*;

// Define types that can be exposed if needed, or keep them internal.
#[derive(Debug, Clone)]
pub enum CognitiveEvent {
    Observe { data: Vec<(SentinelVariable, f32)> },
    Evaluate,
}

/// The core Sentinel Agent implemented as an Actor
pub struct SentinelActor {
    pub graph: CausalGraph,
    pub mode: SentinelMode,
    pub risk_score: f32,
    pub receiver: mpsc::Receiver<CognitiveEvent>,
}

impl SentinelActor {
    pub fn new(receiver: mpsc::Receiver<CognitiveEvent>) -> Self {
        Self {
            graph: CausalGraph::new(),
            mode: SentinelMode::Zen,
            risk_score: 0.1,
            receiver,
        }
    }

    /// The main event loop for the Actor.
    /// It consumes exactly 0% CPU when waiting for `recv().await`.
    pub async fn run(mut self) {
        while let Some(event) = self.receiver.recv().await {
            match event {
                CognitiveEvent::Observe { data } => {
                    self.handle_observation(data);
                }
                CognitiveEvent::Evaluate => {
                    // In the Native MCP version, we would do I/O bounds here:
                    // let response = IOracle::analyze().await;
                }
            }
        }
    }

    fn handle_observation(&mut self, data: Vec<(SentinelVariable, f32)>) {
        let mut max_risk = 0.0;
        
        for (var, val) in data {
            if var == SentinelVariable::GasPriceGwei && val > 0.8 {
                let risk = self.graph.get_causal_effect(
                    SentinelVariable::GasPriceGwei, 
                    SentinelVariable::Volatility
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
