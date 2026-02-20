use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SentinelAction {
    // --- Basic Actions ---
    Hold,
    Swap {
        token_in: String,
        token_out: String,
        amount_in: String, // String to avoid u128 WASM issues
        slippage_tol: f32,
    },
    
    // --- Advanced Actions ---
    Hedge {
        ratio: f32,
    },
    Rebalance,
    
    // --- God-Tier Actions ---
    BundleAttack {
        target_block: u64,
        // Raw txs would be passed as generic bytes or simpler rep for now
        tx_count: u8, 
    },
    Liquidation {
        target_account: String,
    }
}

impl SentinelAction {
    pub fn intrusiveness(&self) -> f32 {
        match self {
            Self::BundleAttack { .. } => 1.0, // God-tier, max risk
            Self::Liquidation { .. } => 0.8,
            Self::Swap { .. } => 0.6,
            Self::Hedge { .. } => 0.4,
            Self::Rebalance => 0.5,
            Self::Hold => 0.0,
        }
    }

    pub fn requires_simulation(&self) -> bool {
        self.intrusiveness() > 0.5
    }
}
