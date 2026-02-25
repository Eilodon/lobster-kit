use crate::sentinel::modes::SentinelMode;
use blake3::Hasher;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TraumaHit {
    pub sev_eff: f32,
    pub count: u32,
    pub inhibit_until_ts_us: i64,
    pub last_ts_us: i64,
}

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct TraumaRegistry {
    #[wasm_bindgen(skip)]
    pub records: HashMap<[u8; 32], TraumaHit>,
}

#[wasm_bindgen]
impl TraumaRegistry {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            records: HashMap::new(),
        }
    }

    /// Record a negative outcome ("Trauma")
    pub fn record_trauma(
        &mut self,
        mode: SentinelMode,
        action_name: &str,
        severity: f32, // 0.0 - 5.0
        now_ts_ms: i64,
    ) {
        let now_ts_us = now_ts_ms * 1000;
        let key = Self::hash_context(mode, action_name);

        let (new_count, new_sev, inhibit_duration_us) =
            if let Some(existing) = self.records.get(&key) {
                let new_count = existing.count.saturating_add(1);
                // Exponential Backoff: 1h, 2h, 4h... cap at 24h
                let base_hours: i64 = 1;
                let hours = (base_hours * (1 << (new_count.min(10) - 1))).min(24);
                let duration = hours * 3600 * 1_000_000;

                let alpha = 0.3;
                let new_sev = existing.sev_eff * (1.0 - alpha) + severity * alpha;

                (new_count, new_sev, duration)
            } else {
                // First offence: 1 hour inhibit
                (1, severity, 3600 * 1_000_000)
            };

        let hit = TraumaHit {
            sev_eff: new_sev.clamp(0.0, 5.0),
            count: new_count,
            inhibit_until_ts_us: now_ts_us + inhibit_duration_us,
            last_ts_us: now_ts_us,
        };

        self.records.insert(key, hit);
    }

    /// Check if action is inhibited
    pub fn is_inhibited(&self, mode: SentinelMode, action_name: &str, now_ts_ms: i64) -> bool {
        let key = Self::hash_context(mode, action_name);
        if let Some(hit) = self.records.get(&key) {
            let now = now_ts_ms * 1000;
            if now < hit.inhibit_until_ts_us {
                return true;
            }
        }
        false
    }

    /// Get remaining inhibition time in milliseconds
    pub fn get_remaining_ms(&self, mode: SentinelMode, action_name: &str, now_ts_ms: i64) -> i64 {
        let key = Self::hash_context(mode, action_name);
        if let Some(hit) = self.records.get(&key) {
            let now_us = now_ts_ms * 1000;
            if hit.inhibit_until_ts_us > now_us {
                return (hit.inhibit_until_ts_us - now_us) / 1000;
            }
        }
        0
    }

    /// Exposes raw severity for Direct Logit Trauma scaling
    pub fn get_trauma_severity(&self, mode: SentinelMode, action_name: &str) -> f32 {
        let key = Self::hash_context(mode, action_name);
        if let Some(hit) = self.records.get(&key) {
            hit.sev_eff
        } else {
            0.0
        }
    }

    /// Remove trauma record (heal)
    pub fn heal(&mut self, mode: SentinelMode, action_name: &str) {
        let key = Self::hash_context(mode, action_name);
        self.records.remove(&key);
    }

    /// Export records as JSON for persistence
    pub fn export_records(&self) -> Result<JsValue, JsValue> {
        // Convert binary keys to hex strings for JSON compatibility
        let mut dump: HashMap<String, TraumaHit> = HashMap::new();
        for (k, v) in self.records.iter() {
            dump.insert(hex::encode(k), v.clone());
        }
        serde_wasm_bindgen::to_value(&dump).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Import records from JSON
    pub fn import_records(&mut self, data: JsValue) -> Result<(), JsValue> {
        let dump: HashMap<String, TraumaHit> = serde_wasm_bindgen::from_value(data)
            .map_err(|e| JsValue::from_str(&format!("import_records: invalid payload: {}", e)))?;

        for (hex_key, hit) in dump {
            let key_vec = hex::decode(&hex_key).map_err(|e| {
                JsValue::from_str(&format!("import_records: bad hex key '{}': {}", hex_key, e))
            })?;

            if key_vec.len() != 32 {
                return Err(JsValue::from_str(&format!(
                    "import_records: invalid key length for '{}', expected 32",
                    hex_key
                )));
            }

            let mut key = [0u8; 32];
            key.copy_from_slice(&key_vec);
            self.records.insert(key, hit);
        }
        Ok(())
    }

    fn hash_context(mode: SentinelMode, action_name: &str) -> [u8; 32] {
        let mut hasher = Hasher::new();
        hasher.update(&[mode as u8]);
        hasher.update(action_name.as_bytes());
        *hasher.finalize().as_bytes()
    }
}

// Default impl
impl Default for TraumaRegistry {
    fn default() -> Self {
        Self::new()
    }
}
