pub mod actions;
pub mod causal;
pub mod config;
pub mod conversation_config;
pub mod modes;
pub mod systems;
pub mod thermo;
pub mod trauma;
pub mod variables;

use self::causal::{CausalEdge, CausalGraph};
use chrono::Utc;
use variables::SentinelVariable;
use wasm_bindgen::prelude::*;

// The Main Sentinel Struct exposed to WASM
#[wasm_bindgen]
pub struct Sentinel {
    brain: CausalGraph,
    mode: modes::SentinelMode,
    thermo: thermo::ThermodynamicEngine,
    trauma: trauma::TraumaRegistry,
    // Current thermo state vector
    thermo_state: nalgebra::DVector<f32>,
}

#[wasm_bindgen]
impl Sentinel {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut brain = CausalGraph::new();

        // Load Priors (The "Nature" part of Nature vs Nurture)
        Self::load_priors(&mut brain);

        let thermo = thermo::ThermodynamicEngine::new(thermo::ThermoConfig::default());
        let trauma = trauma::TraumaRegistry::new();
        // Initial state: [Vol=0.5, Trend=0.5, Liq=0.5, Cycle=0.5, Mom=0.5]
        let thermo_state = nalgebra::DVector::from_element(5, 0.5);

        Self {
            brain,
            mode: modes::SentinelMode::Zen,
            thermo,
            trauma,
            thermo_state,
        }
    }

    // Logic from Blueprint: Map default causal relationships
    fn load_priors(graph: &mut CausalGraph) {
        // Tắc nghẽn Mempool (5) -> Tăng Gas (4)
        graph.set_edge(
            SentinelVariable::MempoolPendingCnt,
            SentinelVariable::GasPriceGwei,
            CausalEdge {
                successes: 95,
                failures: 5,
                weight_override: None,
            }, // 0.95
        );

        // Gas tăng cao (4) -> Biến động giá (2)
        graph.set_edge(
            SentinelVariable::GasPriceGwei,
            SentinelVariable::Volatility,
            CausalEdge {
                successes: 60,
                failures: 40,
                weight_override: None,
            }, // 0.6
        );

        // Whale Flow (6) -> Price Delta (0)
        graph.set_edge(
            SentinelVariable::WhaleNetFlow,
            SentinelVariable::PriceDelta,
            CausalEdge {
                successes: 85,
                failures: 15,
                weight_override: None,
            }, // 0.85
        );

        // Sentiment (11) -> Price Delta (0)
        graph.set_edge(
            SentinelVariable::Sentiment,
            SentinelVariable::PriceDelta,
            CausalEdge {
                successes: 70,
                failures: 30,
                weight_override: None,
            },
        );

        // Macro Factor (12) -> Volatility (2)
        graph.set_edge(
            SentinelVariable::MacroFactor,
            SentinelVariable::Volatility,
            CausalEdge {
                successes: 80,
                failures: 20,
                weight_override: None,
            },
        );

        // Liquidity Imbalance (7) -> Price Delta (0)
        graph.set_edge(
            SentinelVariable::LiquidityImbalance,
            SentinelVariable::PriceDelta,
            CausalEdge {
                successes: 75,
                failures: 25,
                weight_override: None,
            },
        );

        // Smart Money (8) -> Whale Flow (6) (Smart money precedes whales)
        graph.set_edge(
            SentinelVariable::SmartMoneyActivity,
            SentinelVariable::WhaleNetFlow,
            CausalEdge {
                successes: 65,
                failures: 35,
                weight_override: None,
            },
        );
    }

    pub fn get_mode(&self) -> modes::SentinelMode {
        self.mode
    }

    pub fn set_mode(&mut self, mode: modes::SentinelMode) {
        self.mode = mode;
    }

    /// Return current thermodynamic state (Arousal/Entropy levels)
    pub fn get_thermo_state(&self) -> Vec<f32> {
        self.thermo_state.iter().cloned().collect()
    }

    // Core Loop: Receive observation -> Update Brain -> Return Decision
    pub fn tick(&mut self, gas_price: f32, whale_flow: f32) -> String {
        let now = Utc::now().timestamp_millis();

        // 1. Update Thermodynamic State
        let target = nalgebra::DVector::from_vec(vec![
            gas_price.clamp(0.0, 1.0), // Volatility proxy
            0.5 + whale_flow * 0.5,    // Trend proxy
            0.8,                       // Liquidity (assumed high)
            0.5,                       // Cycle
            0.5,                       // Momentum
        ]);

        self.thermo.step(&mut self.thermo_state, &target);

        // 2. Adaptive Threshold based on Entropy
        let entropy = self.thermo.entropy(&self.thermo_state);
        let action_threshold = 0.8 - (entropy * 0.1).clamp(0.0, 0.3);

        // 3. Trauma Check
        if whale_flow > action_threshold {
            if self
                .trauma
                .is_inhibited(modes::SentinelMode::Berserk, "EnterMode", now)
            {
                return "TraumaInhibit: Staying Zen".to_string();
            }

            self.mode = modes::SentinelMode::Berserk;
            return "Signal: WhaleDetected".to_string();
        }

        // If gas price is high
        if gas_price > 0.8 {
            let volatility_risk = self
                .brain
                .get_causal_effect(SentinelVariable::GasPriceGwei, SentinelVariable::Volatility);

            if volatility_risk > 0.5 {
                if !self
                    .trauma
                    .is_inhibited(modes::SentinelMode::Stalking, "RiskResponse", now)
                {
                    self.mode = modes::SentinelMode::Stalking;
                    return "RiskAlert: HighGasParameters".to_string();
                }
            }
        }

        "Status: Zen".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sentinel::variables::SentinelVariable;

    #[test]
    fn test_sentinel_initialization() {
        let sentinel = Sentinel::new();
        assert_eq!(sentinel.get_mode(), modes::SentinelMode::Zen);
    }

    #[test]
    fn test_sentinel_priors() {
        let sentinel = Sentinel::new();
        let edge = sentinel.brain.weights[SentinelVariable::MempoolPendingCnt.index()]
            [SentinelVariable::GasPriceGwei.index()]
        .as_ref();
        assert!(edge.is_some());
        // Laplace smoothing: (95 + 1) / (95 + 5 + 2) = 96 / 102
        assert!((edge.unwrap().success_prob() - (96.0 / 102.0)).abs() < 1e-6);
    }

    #[test]
    fn test_sentinel_tick_logic() {
        let mut sentinel = Sentinel::new();
        let status = sentinel.tick(0.1, 0.1);
        assert_eq!(status, "Status: Zen");
        let status = sentinel.tick(0.9, 0.1);
        assert_eq!(status, "RiskAlert: HighGasParameters");
        assert_eq!(sentinel.get_mode(), modes::SentinelMode::Stalking);
    }

    #[test]
    fn test_trauma_inhibit() {
        let mut sentinel = Sentinel::new();
        let status = sentinel.tick(0.9, 0.1);
        assert_eq!(status, "RiskAlert: HighGasParameters");
        assert_eq!(sentinel.get_mode(), modes::SentinelMode::Stalking);

        // Record Trauma
        let now = Utc::now().timestamp_millis();
        sentinel
            .trauma
            .record_trauma(modes::SentinelMode::Stalking, "RiskResponse", 4.0, now);

        sentinel.set_mode(modes::SentinelMode::Zen);

        let status = sentinel.tick(0.9, 0.1);
        assert_eq!(status, "Status: Zen");
        assert_eq!(sentinel.get_mode(), modes::SentinelMode::Zen);
    }
}
