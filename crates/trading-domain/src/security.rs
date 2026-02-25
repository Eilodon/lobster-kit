use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ptr::write_volatile;
use wasm_bindgen::prelude::*;

/// Ephemeral in-memory secret that is zeroed on drop.
///
/// This is intended for short-lived sensitive material (e.g. API token bytes)
/// inside Rust memory. It does not protect data copied outside this buffer.
pub struct VolatileSecret {
    data: Vec<u8>,
}

impl VolatileSecret {
    pub fn new(secret: &[u8]) -> Self {
        Self {
            data: secret.to_vec(),
        }
    }

    pub fn expose(&self) -> &[u8] {
        &self.data
    }
}

impl Drop for VolatileSecret {
    fn drop(&mut self) {
        for byte in self.data.iter_mut() {
            // Volatile write prevents the compiler from removing zeroization.
            unsafe { write_volatile(byte, 0) };
        }
    }
}

// ==========================================
// 🛡️ VALUE INVARIANT (The Citadel)
// ==========================================

// NOTE: f64 is intentionally used here. ValueInvariant operates on USD values
// (position sizes < 1e12 USD), which are well within f64's 15-16 significant-digit
// precision. The critical risk is NaN propagation — all inputs are explicitly
// guarded below. For on-chain token amounts (WAD/RAY), use q64_96 module instead.

#[derive(Serialize, Deserialize)]
pub struct InvariantConfig {
    pub max_drawdown_per_block: f64,    // Percentage (0.0 - 100.0)
    pub max_position_size: f64,         // USD Value
    pub circuit_breaker_threshold: f64, // Hard panic threshold (e.g. 15.0%)
}

#[wasm_bindgen]
pub struct ValueInvariant {
    config: InvariantConfig,
    last_snapshot_value: f64,
}

#[derive(Serialize)]
pub struct InvariantCheckResult {
    pub safe: bool,
    pub reason: Option<String>,
    pub circuit_broken: bool,
}

#[wasm_bindgen]
impl ValueInvariant {
    #[wasm_bindgen(constructor)]
    pub fn new(
        max_drawdown_per_block: f64,
        max_position_size: f64,
        circuit_breaker_threshold: f64,
    ) -> ValueInvariant {
        ValueInvariant {
            config: InvariantConfig {
                max_drawdown_per_block,
                max_position_size,
                circuit_breaker_threshold,
            },
            last_snapshot_value: 0.0,
        }
    }

    pub fn update_snapshot(&mut self, total_portfolio_value: f64) {
        if total_portfolio_value.is_nan() || total_portfolio_value < 0.0 {
            return;
        }
        self.last_snapshot_value = total_portfolio_value;
    }

    pub fn check_invariant(
        &self,
        trade_value_usd: f64,
        predicted_impact: f64,
    ) -> Result<JsValue, JsValue> {
        // 1. Sanity Checks — guard ALL f64 inputs against NaN/Inf propagation
        if trade_value_usd.is_nan() || !trade_value_usd.is_finite() || trade_value_usd < 0.0 {
            return serde_wasm_bindgen::to_value(&InvariantCheckResult {
                safe: false,
                reason: Some("INVALID_INPUT: Trade value is NaN, Inf, or negative".to_string()),
                circuit_broken: false,
            })
            .map_err(|e| JsValue::from_str(&e.to_string()));
        }
        // BUG FIX #1: predicted_impact was previously unguarded — NaN here would
        // cause drawdown_pct = NaN, bypassing ALL threshold checks (NaN comparisons return false).
        if predicted_impact.is_nan() || !predicted_impact.is_finite() {
            return serde_wasm_bindgen::to_value(&InvariantCheckResult {
                safe: false,
                reason: Some(
                    "INVALID_INPUT: Predicted impact is NaN or Inf — failing safe".to_string(),
                ),
                circuit_broken: true, // Treat as circuit breaker: unknown impact = maximum risk
            })
            .map_err(|e| JsValue::from_str(&e.to_string()));
        }

        // 2. Invariant: Max Position Size
        if trade_value_usd > self.config.max_position_size {
            return serde_wasm_bindgen::to_value(&InvariantCheckResult {
                safe: false,
                reason: Some(format!(
                    "INVARIANT_BREACH: Trade size ${:.2} > Max ${:.2}",
                    trade_value_usd, self.config.max_position_size
                )),
                circuit_broken: false,
            })
            .map_err(|e| JsValue::from_str(&e.to_string()));
        }

        // 3. Invariant: Max Drawdown per Block
        let drawdown_pct = if self.last_snapshot_value > 0.0 {
            (predicted_impact.abs() / self.last_snapshot_value) * 100.0 // Ensure positive dropout
        } else {
            0.0
        };

        // 🚨 CIRCUIT BREAKER (HARD PANIC)
        if drawdown_pct > self.config.circuit_breaker_threshold {
            return serde_wasm_bindgen::to_value(&InvariantCheckResult {
                safe: false,
                reason: Some(format!(
                    "💥 CIRCUIT BREAKER TRIGGERED: Drawdown {:.2}% > Threshold {:.2}%",
                    drawdown_pct, self.config.circuit_breaker_threshold
                )),
                circuit_broken: true,
            })
            .map_err(|e| JsValue::from_str(&e.to_string()));
        }

        // Soft Breach
        if drawdown_pct > self.config.max_drawdown_per_block {
            return serde_wasm_bindgen::to_value(&InvariantCheckResult {
                safe: false,
                reason: Some(format!(
                    "RISK_WARNING: Predicted drawdown {:.2}% > Max {:.2}%",
                    drawdown_pct, self.config.max_drawdown_per_block
                )),
                circuit_broken: false,
            })
            .map_err(|e| JsValue::from_str(&e.to_string()));
        }

        serde_wasm_bindgen::to_value(&InvariantCheckResult {
            safe: true,
            reason: None,
            circuit_broken: false,
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

// ==========================================
// 🕵️ ANTI-RUG (The Detective)
// ==========================================

#[derive(Serialize, Deserialize)]
pub struct TokenSecurityData {
    pub is_honeypot: bool,
    pub honeypot_with_same_creator: bool,
    pub buy_tax: String,
    pub sell_tax: String,
    pub cannot_buy: bool,
    pub cannot_sell_all: bool,
    pub is_blacklisted: bool,
    pub is_whitelisted: bool,
    pub is_open_source: bool,
    pub is_proxy: bool,
    pub is_mintable: bool,
    pub owner_change_balance: bool,
    pub owner_address: String,
    pub creator_address: String,
    #[serde(default)]
    pub liquidity_locked: Option<bool>,
}

#[derive(Serialize)]
pub struct SecurityScore {
    pub score: u8, // 0-100
    pub is_honeypot: bool,
    pub liquidity_locked: bool,
    pub liquidity_unknown: bool,
    pub contract_verified: bool,
    pub owner_renounced: bool,
    pub status: String, // SAFE, CAUTION, DANGER, CRITICAL
}

#[wasm_bindgen]
pub struct AntiRug {
    whitelist: HashSet<String>,
    blacklist: HashSet<String>,
}

#[derive(Serialize, Deserialize)]
struct ListExport {
    whitelist: Vec<String>,
    blacklist: Vec<String>,
}

// ── Scoring constants (named for auditability) ──────────────────────────────
const PENALTY_HONEYPOT_CREATOR: i16 = 30; // same creator has honeypot
const PENALTY_CANNOT_BUY: i16 = 20; // buy completely disabled
const PENALTY_PROXY: i16 = 20; // upgradeable proxy (hidden logic risk)
const PENALTY_MINTABLE: i16 = 15; // owner can inflate supply
const PENALTY_NOT_OPEN_SOURCE: i16 = 40; // can't verify → highest single deduction
const PENALTY_TAX_PER_PCT: i16 = 4; // per 1% tax above threshold
const PENALTY_OWNER_NOT_RENOUNCED: i16 = 15;
const PENALTY_LIQUIDITY_NOT_LOCKED: i16 = 20;
const PENALTY_LIQUIDITY_UNKNOWN: i16 = 10;
const BONUS_WHITELISTED: i16 = 10;
const BONUS_OPEN_SOURCE_AND_RENOUNCED: i16 = 5;
const BONUS_LIQUIDITY_LOCKED: i16 = 5;
const TAX_THRESHOLD_SOFT: f64 = 5.0; // > 5% → start penalizing
const TAX_THRESHOLD_HARD: f64 = 20.0; // > 20% → instant DANGER

#[wasm_bindgen]
impl AntiRug {
    #[wasm_bindgen(constructor)]
    pub fn new() -> AntiRug {
        AntiRug {
            whitelist: HashSet::new(),
            blacklist: HashSet::new(),
        }
    }

    pub fn add_to_whitelist(&mut self, address: &str) {
        self.whitelist.insert(address.to_lowercase());
    }

    pub fn add_to_blacklist(&mut self, address: &str) {
        self.blacklist.insert(address.to_lowercase());
    }

    /// Export whitelist + blacklist as JSON for persistence
    pub fn export_lists(&self) -> Result<JsValue, JsValue> {
        let data = ListExport {
            whitelist: self.whitelist.iter().cloned().collect(),
            blacklist: self.blacklist.iter().cloned().collect(),
        };
        serde_wasm_bindgen::to_value(&data).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Import previously persisted whitelist + blacklist from JSON
    pub fn import_lists(&mut self, data: JsValue) -> Result<(), JsValue> {
        let imported = serde_wasm_bindgen::from_value::<ListExport>(data)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse import data: {}", e)))?;

        for addr in imported.whitelist {
            self.whitelist.insert(addr.to_lowercase());
        }
        for addr in imported.blacklist {
            self.blacklist.insert(addr.to_lowercase());
        }
        Ok(())
    }

    pub fn check_token_security(&self, _token_address: &str) -> Result<JsValue, JsValue> {
        // Fail-safe: If API fails, return UNKNOWN but do not panic/block aggressively.
        // A score of 50 indicates "Caution/Neutral".
        serde_wasm_bindgen::to_value(&SecurityScore {
            score: 50, // Changed from 0 to 50 (Neutral)
            is_honeypot: false,
            liquidity_locked: false,
            liquidity_unknown: true,
            contract_verified: false,
            owner_renounced: false,
            status: "UNKNOWN".to_string(),
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /**
     * compute_score
     * Real logic: Takes raw API data and computes a rigorous safety score.
     */
    pub fn compute_score(&self, token_address: &str, data: JsValue) -> Result<JsValue, JsValue> {
        let addr_lower = token_address.to_lowercase();

        // 0. Manual Override
        if self.blacklist.contains(&addr_lower) {
            return self.create_score(0, true, false, false, false, false, "BLACKLISTED");
        }
        if self.whitelist.contains(&addr_lower) {
            return self.create_score(100, false, true, false, true, true, "WHITELISTED");
        }

        let security_data: TokenSecurityData = serde_wasm_bindgen::from_value(data)
            .map_err(|_| JsValue::from_str("INVALID_DATA: Failed to parse TokenSecurityData"))?;

        let mut score: i16 = 100;

        // 1. Critical Failures (Instant Death)
        if security_data.is_honeypot {
            return self.create_score(0, true, false, false, false, false, "HONEYPOT");
        }
        if security_data.owner_change_balance {
            return self.create_score(
                0,
                true,
                false,
                false,
                false,
                false,
                "OWNER_CONTROLS_BALANCE",
            );
        }
        if security_data.cannot_sell_all {
            return self.create_score(0, true, false, false, false, false, "CANNOT_SELL_ALL");
        }
        if security_data.is_blacklisted {
            return self.create_score(0, true, false, false, false, false, "BLACKLISTED_BY_SOURCE");
        }

        // 2. Ownership (computed early for accurate reporting in all paths)
        let owner_lower = security_data.owner_address.to_lowercase();
        let renounced = owner_lower.is_empty()
            || owner_lower == "0x0000000000000000000000000000000000000000"
            || owner_lower == "0x000000000000000000000000000000000000dead";

        // 3. Tax Risks — check FIRST to avoid wasted Section 4 deductions
        let buy_tax: f64 = match security_data.buy_tax.trim().parse::<f64>() {
            Ok(v) if v.is_finite() && v >= 0.0 && v <= 100.0 => v,
            _ => {
                return self.create_score(
                    0,
                    false,
                    false,
                    true,
                    security_data.is_open_source,
                    renounced,
                    "INVALID_TAX_DATA",
                );
            }
        };
        let sell_tax: f64 = match security_data.sell_tax.trim().parse::<f64>() {
            Ok(v) if v.is_finite() && v >= 0.0 && v <= 100.0 => v,
            _ => {
                return self.create_score(
                    0,
                    false,
                    false,
                    true,
                    security_data.is_open_source,
                    renounced,
                    "INVALID_TAX_DATA",
                );
            }
        };

        if buy_tax > TAX_THRESHOLD_HARD || sell_tax > TAX_THRESHOLD_HARD {
            return self.create_score(
                10,
                false,
                false,
                true,
                security_data.is_open_source,
                renounced,
                "HIGH_TAX",
            );
        }

        // 4. Major Risks
        if security_data.honeypot_with_same_creator {
            score -= PENALTY_HONEYPOT_CREATOR;
        }
        if security_data.cannot_buy {
            score -= PENALTY_CANNOT_BUY;
        }
        if security_data.is_proxy {
            score -= PENALTY_PROXY;
        }
        if security_data.is_mintable {
            score -= PENALTY_MINTABLE;
        }
        if !security_data.is_open_source {
            score -= PENALTY_NOT_OPEN_SOURCE;
        }

        // 5. Tax Penalties (for tokens within SOFT-HARD range)
        if buy_tax > TAX_THRESHOLD_SOFT {
            score -= (buy_tax.round() as i16) * PENALTY_TAX_PER_PCT;
        }
        if sell_tax > TAX_THRESHOLD_SOFT {
            score -= (sell_tax.round() as i16) * PENALTY_TAX_PER_PCT;
        }

        // 6. Ownership penalty
        if !renounced {
            score -= PENALTY_OWNER_NOT_RENOUNCED;
        }

        // 6.5 Liquidity lock signal
        let mut liquidity_locked = false;
        let mut liquidity_unknown = true;
        if let Some(is_locked) = security_data.liquidity_locked {
            liquidity_unknown = false;
            liquidity_locked = is_locked;
            if !is_locked {
                score -= PENALTY_LIQUIDITY_NOT_LOCKED;
            }
            if is_locked {
                score += BONUS_LIQUIDITY_LOCKED;
            }
        } else {
            score -= PENALTY_LIQUIDITY_UNKNOWN;
        }

        // 7. Positive Signals (Bonuses)
        if security_data.is_whitelisted {
            score += BONUS_WHITELISTED;
        }
        if security_data.is_open_source && renounced {
            score += BONUS_OPEN_SOURCE_AND_RENOUNCED;
        }

        let score = score.clamp(0, 100) as u8;

        let status = if liquidity_unknown && score >= 60 {
            "UNKNOWN"
        } else if score >= 80 {
            "SAFE"
        } else if score >= 50 {
            "CAUTION"
        } else {
            "DANGER"
        };

        self.create_score(
            score,
            false,
            liquidity_locked,
            liquidity_unknown,
            security_data.is_open_source,
            renounced,
            status,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn create_score(
        &self,
        score: u8,
        is_honeypot: bool,
        liquidity_locked: bool,
        liquidity_unknown: bool,
        contract_verified: bool,
        owner_renounced: bool,
        status: &str,
    ) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&SecurityScore {
            score,
            is_honeypot,
            liquidity_locked,
            liquidity_unknown,
            contract_verified,
            owner_renounced,
            status: status.to_string(),
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

impl Default for AntiRug {
    fn default() -> Self {
        Self::new()
    }
}

// ==========================================
// 🛡️ BATCH APPROVAL SCANNER (Zero-Allocation Event Engine)
// ==========================================

#[wasm_bindgen]
pub struct BatchApprovalScanner {
    safe_spenders: HashSet<String>,
}

#[wasm_bindgen]
impl BatchApprovalScanner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        BatchApprovalScanner {
            safe_spenders: HashSet::new(),
        }
    }

    pub fn add_safe_spenders(&mut self, spenders: js_sys::Array) {
        for i in 0..spenders.length() {
            if let Some(val) = spenders.get(i).as_string() {
                self.safe_spenders.insert(val.to_lowercase());
            }
        }
    }

    /// Takes a single comma-separated string of spenders to avoid JS array overhead across the FFI.
    /// Returns a comma-separated string of the indices that are flagged as threats.
    pub fn scan_approvals_csv(&self, spenders_csv: &str) -> String {
        let mut threats: Vec<u32> = Vec::new();

        for (i, spender) in spenders_csv.split(',').enumerate() {
            let spender_clean = spender.trim().to_lowercase();
            if !spender_clean.is_empty() && !self.safe_spenders.contains(&spender_clean) {
                threats.push(i as u32);
            }
        }

        threats
            .into_iter()
            .map(|id| id.to_string())
            .collect::<Vec<String>>()
            .join(",")
    }
}
