//! Eidolon WASM Core - High-Performance Trading Engine
//!
//! This crate provides the performance-critical components for the
//! Eidolon Crypto/Trading/Blockchain engine, compiled to WebAssembly.
//!
//! ## Modules
//! - `order_book`: Lock-free order matching engine
//! - `risk`: Margin and liquidation calculations
//! - `token_math`: Fixed-point 128-bit token arithmetic
//! - `utils`: Shared utilities and FFI helpers

mod order_book;
mod risk;
mod token_math;
mod utils;

pub mod sentinel;

use wasm_bindgen::prelude::*;

// Re-exports for JS consumption
pub use order_book::*;
pub use risk::*;
pub use token_math::*;

/// Initialize the WASM module with panic hook for better error messages
#[wasm_bindgen(start)]
pub fn init() {
    utils::set_panic_hook();
}

/// Get the version of the WASM core
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Health check - returns true if WASM module is working
#[wasm_bindgen]
pub fn health_check() -> bool {
    true
}

// ============================================
// SharedArrayBuffer Bridge (Zero-Copy FFI)
// ============================================

/// Update positions PnL from mark prices
/// This operates directly on SharedArrayBuffer data
#[wasm_bindgen]
pub fn batch_update_pnl(
    position_entry: &[f32],
    position_quantity: &[f32],
    position_side: &[u8],
    position_pnl: &mut [f32],
    mark_price: f32,
    count: usize,
) {
    for i in 0..count {
        let entry = position_entry[i];
        let qty = position_quantity[i];
        let side = position_side[i];

        let pnl = if side == 0 {
            // LONG: profit when price goes up
            (mark_price - entry) * qty
        } else {
            // SHORT: profit when price goes down
            (entry - mark_price) * qty
        };

        position_pnl[i] = pnl;
    }
}

/// Calculate margin levels for multiple accounts
#[wasm_bindgen]
pub fn batch_calculate_margin_levels(
    equity: &[f32],
    margin: &[f32],
    margin_level: &mut [f32],
    count: usize,
) {
    for i in 0..count {
        if margin[i] > 0.0 {
            margin_level[i] = (equity[i] / margin[i]) * 100.0;
        } else {
            margin_level[i] = f32::INFINITY;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check() {
        assert!(health_check());
    }

    #[test]
    fn test_batch_pnl_long() {
        let entry = [100.0f32];
        let qty = [1.0f32];
        let side = [0u8]; // LONG
        let mut pnl = [0.0f32];

        batch_update_pnl(&entry, &qty, &side, &mut pnl, 110.0, 1);

        assert!((pnl[0] - 10.0).abs() < 0.001);
    }

    #[test]
    fn test_batch_pnl_short() {
        let entry = [100.0f32];
        let qty = [1.0f32];
        let side = [1u8]; // SHORT
        let mut pnl = [0.0f32];

        batch_update_pnl(&entry, &qty, &side, &mut pnl, 90.0, 1);

        assert!((pnl[0] - 10.0).abs() < 0.001);
    }
}
