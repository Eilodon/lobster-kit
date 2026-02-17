use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// ==========================================
// 🛡️ VALUE INVARIANT (The Citadel)
// ==========================================

#[derive(Serialize, Deserialize)]
pub struct InvariantConfig {
    pub max_drawdown_per_block: f64, // Percentage (0.0 - 100.0)
    pub max_position_size: f64,      // USD Value
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
    pub fn new(max_drawdown_per_block: f64, max_position_size: f64, circuit_breaker_threshold: f64) -> ValueInvariant {
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

    pub fn check_invariant(&self, trade_value_usd: f64, predicted_impact: f64) -> JsValue {
        // 1. Sanity Checks
        if trade_value_usd.is_nan() || trade_value_usd < 0.0 {
            return serde_wasm_bindgen::to_value(&InvariantCheckResult {
                safe: false,
                reason: Some("INVALID_INPUT: Trade value is NaN or negative".to_string()),
                circuit_broken: false,
            }).unwrap();
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
            }).unwrap();
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
            }).unwrap();
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
            }).unwrap();
        }

        serde_wasm_bindgen::to_value(&InvariantCheckResult {
            safe: true,
            reason: None,
            circuit_broken: false,
        }).unwrap()
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
}

#[derive(Serialize)]
pub struct SecurityScore {
    pub score: u8, // 0-100
    pub is_honeypot: bool,
    pub liquidity_locked: bool,
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
    pub fn export_lists(&self) -> JsValue {
        let data = ListExport {
            whitelist: self.whitelist.iter().cloned().collect(),
            blacklist: self.blacklist.iter().cloned().collect(),
        };
        serde_wasm_bindgen::to_value(&data).unwrap()
    }

    /// Import previously persisted whitelist + blacklist from JSON
    pub fn import_lists(&mut self, data: JsValue) {
        if let Ok(imported) = serde_wasm_bindgen::from_value::<ListExport>(data) {
            for addr in imported.whitelist {
                self.whitelist.insert(addr.to_lowercase());
            }
            for addr in imported.blacklist {
                self.blacklist.insert(addr.to_lowercase());
            }
        }
    }

    pub fn check_token_security(&self, _token_address: &str) -> JsValue {
         // Fail-safe: If API fails, assume DANGER.
        serde_wasm_bindgen::to_value(&SecurityScore {
            score: 0,
            is_honeypot: false,
            liquidity_locked: false,
            contract_verified: false,
            owner_renounced: false,
            status: "DANGER".to_string(),
        }).unwrap()
    }

    /**
     * compute_score
     * Real logic: Takes raw API data and computes a rigorous safety score.
     */
    pub fn compute_score(&self, token_address: &str, data: JsValue) -> JsValue {
        let addr_lower = token_address.to_lowercase();
        
        // 0. Manual Override
        if self.blacklist.contains(&addr_lower) {
            return self.create_score(0, true, false, false, false, "BLACKLISTED");
        }
        if self.whitelist.contains(&addr_lower) {
            return self.create_score(100, false, true, true, true, "WHITELISTED");
        }

        let security_data: TokenSecurityData = match serde_wasm_bindgen::from_value(data) {
            Ok(d) => d,
            Err(_) => return JsValue::NULL,
        };

        let mut score: i16 = 100;

        // 1. Critical Failures (Instant Death)
        if security_data.is_honeypot { return self.create_score(0, true, false, false, false, "HONEYPOT"); }
        if security_data.owner_change_balance { return self.create_score(0, true, false, false, false, "OWNER_CONTROLS_BALANCE"); }
        if security_data.cannot_sell_all { return self.create_score(0, true, false, false, false, "CANNOT_SELL_ALL"); }
        if security_data.is_blacklisted { return self.create_score(0, true, false, false, false, "BLACKLISTED_BY_SOURCE"); }

        // 2. Major Risks
        if security_data.honeypot_with_same_creator { score -= 30; }
        if security_data.cannot_buy { score -= 20; }
        if security_data.is_proxy { score -= 20; }
        if security_data.is_mintable { score -= 15; }
        if !security_data.is_open_source { score -= 40; } // Verification is critical

        // 3. Tax Risks
        let buy_tax: f64 = security_data.buy_tax.parse().unwrap_or(0.0);
        let sell_tax: f64 = security_data.sell_tax.parse().unwrap_or(0.0);

        if buy_tax > 5.0 { score -= (buy_tax.round() as i16) * 4; } // Penalty scaling with rounding
        if sell_tax > 5.0 { score -= (sell_tax.round() as i16) * 4; }

        if buy_tax > 20.0 || sell_tax > 20.0 { 
            return self.create_score(10, false, false, security_data.is_open_source, false, "HIGH_TAX"); 
        }

        // 4. Ownership
        let renounced = security_data.owner_address.is_empty() || security_data.owner_address == "0x0000000000000000000000000000000000000000";
        if !renounced { score -= 15; }

        // 5. Positive Signals (Bonuses)
        if security_data.is_whitelisted { score += 10; }
        if security_data.is_open_source && renounced { score += 5; } // Verified & Renounced Synergy

        // Clamp 0-100
        if score < 0 { score = 0; }
        if score > 100 { score = 100; }

        let status = if score >= 80 { "SAFE" } else if score >= 50 { "CAUTION" } else { "DANGER" };

        self.create_score(score as u8, false, false, security_data.is_open_source, renounced, status)
    }

    fn create_score(&self, score: u8, is_honeypot: bool, liquidity_locked: bool, contract_verified: bool, owner_renounced: bool, status: &str) -> JsValue {
        serde_wasm_bindgen::to_value(&SecurityScore {
            score,
            is_honeypot,
            liquidity_locked,
            contract_verified,
            owner_renounced,
            status: status.to_string(),
        }).unwrap()
    }
}
