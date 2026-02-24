use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[wasm_bindgen]
pub enum SentinelMode {
    Stalking,       // Low activity, monitoring
    Berserk,        // High frequency trading
    Arbitrage,      // Atomic checks
    Liquidation,    // Hunting bad debt
    Snipe,          // New token launch
    Emergency,      // Pull everything
    #[default]
    Zen,            // Balanced / Idle
}

impl SentinelMode {
    pub const COUNT: usize = 7;

    pub fn risk_level(&self) -> f32 {
        match self {
            Self::Stalking => 0.1,
            Self::Arbitrage => 0.05,
            Self::Liquidation => 0.4,
            Self::Snipe => 0.9,
            Self::Berserk => 0.7,
            Self::Emergency => 1.0,
            Self::Zen => 0.2, // Default safe mode
        }
    }

    pub fn max_leverage(&self) -> u8 {
        match self {
            Self::Arbitrage => 10,
            Self::Liquidation => 5,
            Self::Berserk => 3,
            Self::Stalking => 1,
            Self::Snipe => 1,
            Self::Emergency => 0,
            Self::Zen => 1,
        }
    }
}
