mod security;
mod q64_96;
mod hyper_memory;
mod liquid_brain;

// New Eidolon Engine modules
mod order_book;
mod risk;
mod token_math;
mod utils;

pub mod sentinel;

// Legacy Exports (Maintain backward compatibility using new modules)
pub use security::{ValueInvariant, AntiRug, InvariantCheckResult, SecurityScore, InvariantConfig, VolatileSecret};
// Re-export specific structs from sentinel to match legacy API
pub use sentinel::causal::CausalGraph;
pub use sentinel::trauma::TraumaRegistry;
pub use sentinel::causal::{Intervenable, CounterfactualResult};
pub use sentinel::conversation_config::ConversationDomainConfig;

// Keep these as they are unique
pub use q64_96::{q64_96_mul, q64_96_div, sqrt_price_x96_to_price_wad};
pub use hyper_memory::HyperMemory;
pub use liquid_brain::LiquidBrain;

// New Exports (Eidolon Engine)
pub use order_book::*;
pub use risk::*;
pub use token_math::*;
pub use sentinel::Sentinel;

use wasm_bindgen::prelude::*;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

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
