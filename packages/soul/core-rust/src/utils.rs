//! Utility functions for WASM module

/// Set panic hook for better error messages in console
pub fn set_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Log to browser console
#[allow(dead_code)]
pub fn log(msg: &str) {
    web_sys::console::log_1(&msg.into());
}

/// Log warning to browser console
#[allow(dead_code)]
pub fn warn(msg: &str) {
    web_sys::console::warn_1(&msg.into());
}

/// Log error to browser console
#[allow(dead_code)]
pub fn error(msg: &str) {
    web_sys::console::error_1(&msg.into());
}
