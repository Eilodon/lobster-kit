use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct TradingDomainConfig {
    pub max_leverage: u8,
    pub min_liquidity_threshold: u64, // In USD/Stablecoin
    pub max_slippage_bps: u32,
    pub gas_limit_gwei: u32,
    pub risk_aversion_factor: f32, // 0.0 to 1.0
}

#[wasm_bindgen]
impl TradingDomainConfig {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            max_leverage: 20,
            min_liquidity_threshold: 100_000,
            max_slippage_bps: 50, // 0.5%
            gas_limit_gwei: 100,
            risk_aversion_factor: 0.5,
        }
    }
    
    pub fn aggressive() -> Self {
        Self {
            max_leverage: 50,
            min_liquidity_threshold: 50_000,
            max_slippage_bps: 100,
            gas_limit_gwei: 300,
            risk_aversion_factor: 0.2,
        }
    }
    
    pub fn conservative() -> Self {
        Self {
            max_leverage: 5,
            min_liquidity_threshold: 500_000,
            max_slippage_bps: 20,
            gas_limit_gwei: 50,
            risk_aversion_factor: 0.8,
        }
    }
}
