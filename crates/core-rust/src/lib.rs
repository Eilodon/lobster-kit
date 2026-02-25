pub mod cognitive;
mod hyper_memory;
pub mod liquid_brain;
#[path = "q64_96.rs"]
mod q64_96_wasm;
mod utils;

pub mod sentinel;

// Domain exports are sourced from the dedicated trading-domain crate.
pub use trading_domain::{
    AntiRug, BatchApprovalScanner, InvariantCheckResult, InvariantConfig, SecurityScore,
    ValueInvariant, VolatileSecret,
};
// Re-export specific structs from sentinel to match legacy API
pub use sentinel::causal::CausalGraph;
pub use sentinel::causal::{CounterfactualResult, Intervenable};
pub use sentinel::conversation_config::ConversationDomainConfig;
pub use sentinel::trauma::TraumaRegistry;

// Keep these as they are unique
pub use hyper_memory::HyperMemory;
pub use liquid_brain::LiquidBrain;
pub use q64_96_wasm::{q64_96_div, q64_96_mul, sqrt_price_x96_to_price_wad};

// Trading vertical exports remain available via re-export for compatibility.
pub use cognitive::approx_vector_index::{SearchResultWasm, WasmApproxVectorIndex};
pub use sentinel::Sentinel;
pub use trading_domain::*;

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

/// Get the ABI version of the WASM core for protocol compatibility
#[wasm_bindgen]
pub fn get_abi_version() -> u32 {
    1 // Current ABI version
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
