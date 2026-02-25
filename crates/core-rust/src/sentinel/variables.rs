use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[wasm_bindgen]
pub enum SentinelVariable {
    // --- Basic Financial Vars ---
    PriceDelta,  // Price change (normalized)
    VolumeSpike, // Volume increase factor
    Volatility,  // ATR / StdDev
    Momentum,    // RSI / MACD Signal

    // --- Eidolon Sentinel Specific ---
    GasPriceGwei,       // Network congestion cost
    MempoolPendingCnt,  // Pending tx count (pressure)
    WhaleNetFlow,       // Net flow of tracked whale wallets
    LiquidityImbalance, // Bid/Ask depth ratio
    SmartMoneyActivity, // Activity from "Smart Money" labels

    // --- Internal/System Vars ---
    PortfolioRisk, // Current drawdown / exposure
    UserAction,    // The action taken (for causal analysis)

    // --- Legacy / Macro ---
    Sentiment,   // Social sentiment / News
    MacroFactor, // Interest rates / Global events
}

impl SentinelVariable {
    pub const COUNT: usize = 13;

    pub const ALL: [SentinelVariable; 13] = [
        SentinelVariable::PriceDelta,
        SentinelVariable::VolumeSpike,
        SentinelVariable::Volatility,
        SentinelVariable::Momentum,
        SentinelVariable::GasPriceGwei,
        SentinelVariable::MempoolPendingCnt,
        SentinelVariable::WhaleNetFlow,
        SentinelVariable::LiquidityImbalance,
        SentinelVariable::SmartMoneyActivity,
        SentinelVariable::PortfolioRisk,
        SentinelVariable::UserAction,
        SentinelVariable::Sentiment,
        SentinelVariable::MacroFactor,
    ];

    pub fn index(&self) -> usize {
        *self as usize
    }

    pub fn from_index(idx: usize) -> Option<Self> {
        Self::ALL.get(idx).copied()
    }

    pub fn name(&self) -> &'static str {
        match self {
            SentinelVariable::PriceDelta => "PriceDelta",
            SentinelVariable::VolumeSpike => "VolumeSpike",
            SentinelVariable::Volatility => "Volatility",
            SentinelVariable::Momentum => "Momentum",
            SentinelVariable::GasPriceGwei => "GasPriceGwei",
            SentinelVariable::MempoolPendingCnt => "MempoolPendingCnt",
            SentinelVariable::WhaleNetFlow => "WhaleNetFlow",
            SentinelVariable::LiquidityImbalance => "LiquidityImbalance",
            SentinelVariable::SmartMoneyActivity => "SmartMoneyActivity",
            SentinelVariable::PortfolioRisk => "PortfolioRisk",
            SentinelVariable::UserAction => "UserAction",
            SentinelVariable::Sentiment => "Sentiment",
            SentinelVariable::MacroFactor => "MacroFactor",
        }
    }

    pub fn all() -> &'static [Self] {
        &Self::ALL
    }
}
