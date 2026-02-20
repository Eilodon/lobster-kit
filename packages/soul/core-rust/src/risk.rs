//! Risk Management - Margin and Liquidation Calculations
//!
//! High-performance risk calculations with SIMD batch processing.

use wasm_bindgen::prelude::*;

// ============================================
// Risk Levels
// ============================================

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RiskLevel {
    Low = 0,
    Medium = 1,
    High = 2,
    Liquidation = 3,
}

// ============================================
// Risk Configuration
// ============================================

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct RiskConfig {
    pub liquidation_level: f32,  // Margin level that triggers liquidation (e.g., 50%)
    pub warning_level: f32,      // Margin level that triggers warning (e.g., 100%)
    pub max_leverage: u16,       // Maximum allowed leverage (e.g., 125x)
    pub max_positions: u16,      // Maximum positions per account
}

#[wasm_bindgen]
impl RiskConfig {
    #[wasm_bindgen(constructor)]
    pub fn new() -> RiskConfig {
        RiskConfig {
            liquidation_level: 50.0,
            warning_level: 100.0,
            max_leverage: 125,
            max_positions: 50,
        }
    }

    pub fn with_levels(liquidation: f32, warning: f32) -> RiskConfig {
        RiskConfig {
            liquidation_level: liquidation,
            warning_level: warning,
            max_leverage: 125,
            max_positions: 50,
        }
    }
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================
// Risk Calculator
// ============================================

#[wasm_bindgen]
pub struct RiskCalculator {
    config: RiskConfig,
}

#[wasm_bindgen]
impl RiskCalculator {
    #[wasm_bindgen(constructor)]
    pub fn new(config: RiskConfig) -> RiskCalculator {
        RiskCalculator { config }
    }

    /// Calculate margin level: (Equity / Margin) * 100
    pub fn calculate_margin_level(&self, equity: f32, margin: f32) -> f32 {
        if margin <= 0.0 {
            return f32::INFINITY;
        }
        (equity / margin) * 100.0
    }

    /// Determine risk level from margin level
    pub fn determine_risk_level(&self, margin_level: f32) -> RiskLevel {
        if margin_level <= self.config.liquidation_level {
            RiskLevel::Liquidation
        } else if margin_level <= self.config.warning_level {
            RiskLevel::High
        } else if margin_level <= 200.0 {
            RiskLevel::Medium
        } else {
            RiskLevel::Low
        }
    }

    /// Calculate required margin for a position
    pub fn calculate_margin_required(
        &self,
        quantity: f32,
        price: f32,
        leverage: u16,
    ) -> f32 {
        (quantity * price) / leverage as f32
    }

    /// Check if new position is allowed
    pub fn can_open_position(
        &self,
        account_margin_level: f32,
        account_risk_level: RiskLevel,
        leverage: u16,
        current_positions: u16,
    ) -> bool {
        // Check leverage limit
        if leverage > self.config.max_leverage {
            return false;
        }

        // Check position count
        if current_positions >= self.config.max_positions {
            return false;
        }

        // Check risk level
        if account_risk_level == RiskLevel::Liquidation || account_risk_level == RiskLevel::High {
            return false;
        }

        true
    }

    /// Calculate position size for given risk percentage
    pub fn calculate_position_size(
        &self,
        equity: f32,
        price: f32,
        leverage: u16,
        risk_percent: f32,
    ) -> f32 {
        let risk_amount = equity * (risk_percent / 100.0);
        (risk_amount * leverage as f32) / price
    }

    /// Calculate stop loss price for given max loss
    pub fn calculate_stop_loss(
        &self,
        side: u8,  // 0 = LONG, 1 = SHORT
        entry_price: f32,
        quantity: f32,
        max_loss: f32,
    ) -> f32 {
        let price_delta = max_loss / quantity;
        
        if side == 0 {
            // LONG: stop loss is below entry
            entry_price - price_delta
        } else {
            // SHORT: stop loss is above entry
            entry_price + price_delta
        }
    }

    /// Calculate liquidation price
    pub fn calculate_liquidation_price(
        &self,
        side: u8,  // 0 = LONG, 1 = SHORT
        entry_price: f32,
        leverage: u16,
        maintenance_margin_rate: f32,
    ) -> f32 {
        // Simplified liquidation price calculation
        // Real formula depends on exchange specifics
        let margin_diff = 1.0 / leverage as f32 - maintenance_margin_rate;
        
        if side == 0 {
            // LONG: liquidation when price drops
            entry_price * (1.0 - margin_diff)
        } else {
            // SHORT: liquidation when price rises
            entry_price * (1.0 + margin_diff)
        }
    }
}

// ============================================
// Batch Operations (SIMD-ready)
// ============================================

/// Batch check accounts for liquidation
/// Returns indices of accounts that need liquidation
#[wasm_bindgen]
pub fn batch_check_liquidation(
    margin_levels: &[f32],
    liquidation_threshold: f32,
) -> Vec<u32> {
    margin_levels
        .iter()
        .enumerate()
        .filter(|(_, &level)| level <= liquidation_threshold && level > 0.0)
        .map(|(i, _)| i as u32)
        .collect()
}

/// Batch calculate equity from balance and unrealized PnL
#[wasm_bindgen]
pub fn batch_calculate_equity(
    balances: &[f32],
    unrealized_pnl: &[f32],
    equity: &mut [f32],
    count: usize,
) {
    for i in 0..count {
        equity[i] = balances[i] + unrealized_pnl[i];
    }
}

/// Batch update risk levels based on margin levels
#[wasm_bindgen]
pub fn batch_update_risk_levels(
    margin_levels: &[f32],
    risk_levels: &mut [u8],
    liquidation_threshold: f32,
    warning_threshold: f32,
    count: usize,
) {
    for i in 0..count {
        let level = margin_levels[i];
        risk_levels[i] = if level <= liquidation_threshold {
            RiskLevel::Liquidation as u8
        } else if level <= warning_threshold {
            RiskLevel::High as u8
        } else if level <= 200.0 {
            RiskLevel::Medium as u8
        } else {
            RiskLevel::Low as u8
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_margin_level() {
        let calc = RiskCalculator::new(RiskConfig::new());
        
        // 10000 equity, 5000 margin = 200% margin level
        let level = calc.calculate_margin_level(10000.0, 5000.0);
        assert!((level - 200.0).abs() < 0.001);
    }

    #[test]
    fn test_risk_levels() {
        let calc = RiskCalculator::new(RiskConfig::new());
        
        assert_eq!(calc.determine_risk_level(40.0), RiskLevel::Liquidation);
        assert_eq!(calc.determine_risk_level(80.0), RiskLevel::High);
        assert_eq!(calc.determine_risk_level(150.0), RiskLevel::Medium);
        assert_eq!(calc.determine_risk_level(300.0), RiskLevel::Low);
    }

    #[test]
    fn test_batch_liquidation_check() {
        let levels = [300.0f32, 40.0, 150.0, 30.0, 200.0];
        let to_liquidate = batch_check_liquidation(&levels, 50.0);
        
        assert_eq!(to_liquidate.len(), 2);
        assert!(to_liquidate.contains(&1));
        assert!(to_liquidate.contains(&3));
    }
}
