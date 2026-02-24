//! Token Math - Fixed-Point 128-bit Arithmetic
//!
//! Provides precise token calculations for crypto trading.
//! Uses 128-bit fixed-point to avoid floating-point errors.

use wasm_bindgen::prelude::*;

pub mod q64_96;
pub use q64_96::Q64_96;

/// Decimals constant for most crypto tokens (18 decimals)


/// Decimals for stablecoins (6 decimals - USDC/USDT)


// ============================================
// Fixed-Point Token Amount (128-bit)
// ============================================

/// Multiply two token amounts with proper decimal handling
/// Returns result in the same decimal precision as input
#[wasm_bindgen]
pub fn token_multiply(amount_a: u64, amount_b: u64, decimals: u32) -> u64 {
    let scale = 10u128.pow(decimals);
    let result = (amount_a as u128 * amount_b as u128) / scale;
    result as u64
}

/// Divide two token amounts with proper decimal handling
#[wasm_bindgen]
pub fn token_divide(numerator: u64, denominator: u64, decimals: u32) -> u64 {
    if denominator == 0 {
        return 0;
    }
    let scale = 10u128.pow(decimals);
    let result = (numerator as u128 * scale) / denominator as u128;
    result as u64
}

/// Calculate percentage (basis points: 10000 = 100%)
#[wasm_bindgen]
pub fn token_percentage(amount: u64, bps: u32) -> u64 {
    ((amount as u128 * bps as u128) / 10000) as u64
}

/// Convert from one decimal precision to another
#[wasm_bindgen]
pub fn convert_decimals(amount: u64, from_decimals: u32, to_decimals: u32) -> u64 {
    if from_decimals == to_decimals {
        return amount;
    }
    
    if from_decimals > to_decimals {
        let diff = from_decimals - to_decimals;
        amount / 10u64.pow(diff)
    } else {
        let diff = to_decimals - from_decimals;
        amount * 10u64.pow(diff)
    }
}

// ============================================
// DeFi Calculations
// ============================================

/// Result of LP value calculation
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct LpValue {
    pub amount_a: u64,
    pub amount_b: u64,
}

/// Calculate LP token value from reserves
/// xy = k formula for constant product AMM
#[wasm_bindgen]
pub fn calculate_lp_value(
    reserve_a: u64,
    reserve_b: u64,
    total_supply: u64,
    lp_tokens: u64,
) -> LpValue {
    if total_supply == 0 {
        return LpValue { amount_a: 0, amount_b: 0 };
    }
    
    let share = (lp_tokens as u128 * 1_000_000) / total_supply as u128;
    let amount_a = ((reserve_a as u128 * share) / 1_000_000) as u64;
    let amount_b = ((reserve_b as u128 * share) / 1_000_000) as u64;
    
    LpValue { amount_a, amount_b }
}

/// Calculate swap output for constant product AMM (x * y = k)
/// fee_bps: fee in basis points (30 = 0.3%)
#[wasm_bindgen]
pub fn calculate_swap_output(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_bps: u32,
) -> u64 {
    if reserve_in == 0 || reserve_out == 0 {
        return 0;
    }
    
    // Apply fee
    let amount_in_with_fee = amount_in as u128 * (10000 - fee_bps as u128) / 10000;
    
    // x * y = k
    // (x + dx) * (y - dy) = k
    // dy = y * dx / (x + dx)
    let numerator = amount_in_with_fee * reserve_out as u128;
    let denominator = reserve_in as u128 + amount_in_with_fee;
    
    (numerator / denominator) as u64
}

/// Calculate price impact for a swap
/// Returns impact in basis points (100 = 1%)
#[wasm_bindgen]
pub fn calculate_price_impact(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
) -> u32 {
    if reserve_in == 0 || reserve_out == 0 {
        return 10000; // 100% impact
    }
    
    // Spot price before swap
    let spot_price = (reserve_out as u128 * 1_000_000) / reserve_in as u128;
    
    // Execution price
    let amount_out = calculate_swap_output(amount_in, reserve_in, reserve_out, 0);
    if amount_out == 0 {
        return 10000;
    }
    let exec_price = (amount_out as u128 * 1_000_000) / amount_in as u128;
    
    // Price impact
    if exec_price >= spot_price {
        return 0;
    }
    
    (((spot_price - exec_price) * 10000) / spot_price) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_multiply() {
        // 1.5 * 2.0 = 3.0 (with 6 decimals)
        let a = 1_500_000u64; // 1.5
        let b = 2_000_000u64; // 2.0
        let result = token_multiply(a, b, 6);
        assert_eq!(result, 3_000_000); // 3.0
    }

    #[test]
    fn test_token_divide() {
        // 6.0 / 2.0 = 3.0 (with 6 decimals)
        let a = 6_000_000u64; // 6.0
        let b = 2_000_000u64; // 2.0
        let result = token_divide(a, b, 6);
        assert_eq!(result, 3_000_000); // 3.0
    }

    #[test]
    fn test_swap_output() {
        // Pool: 1000 ETH / 2,000,000 USDC
        // Swap 1 ETH -> USDC (0.3% fee)
        let reserve_eth = 1000_000_000u64; // 1000 with 6 decimals
        let reserve_usdc = 2_000_000_000_000u64; // 2,000,000 with 6 decimals
        let amount_in = 1_000_000u64; // 1 ETH
        
        let out = calculate_swap_output(amount_in, reserve_eth, reserve_usdc, 30);
        // Should be approximately 1994 USDC (with slippage + fee)
        assert!(out > 1_990_000_000 && out < 2_000_000_000);
    }
}
