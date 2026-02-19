mod security;
mod causal;
mod trauma;
mod q64_96;
mod hyper_memory;
mod liquid_brain;

pub use security::{ValueInvariant, AntiRug, InvariantCheckResult, SecurityScore, InvariantConfig};
pub use causal::CausalGraph;
pub use trauma::{TraumaRegistry, TraumaHit};
pub use q64_96::{q64_96_mul, q64_96_div, sqrt_price_x96_to_price_wad};
pub use hyper_memory::HyperMemory;
pub use liquid_brain::LiquidBrain;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;
