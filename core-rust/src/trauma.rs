use blake3::Hasher;
use serde::Serialize;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug, Serialize)]
pub struct TraumaHit {
    pub sev_eff: f32,
    pub count: u32,
    pub inhibit_until_ts_ms: i64,
    pub last_ts_ms: i64,
}

#[wasm_bindgen]
pub struct TraumaRegistry {
    records: HashMap<Vec<u8>, TraumaHit>,
}

#[wasm_bindgen]
impl TraumaRegistry {
    #[wasm_bindgen(constructor)]
    pub fn new() -> TraumaRegistry {
        TraumaRegistry {
            records: HashMap::new(),
        }
    }

    pub fn record_trauma(
        &mut self,
        mode: u8,
        action_name: &str,
        severity: f32,
        now_ts_ms: i64,
    ) -> Result<(), JsValue> {
        let key = hash_context(mode, action_name);
        let clamped = severity.clamp(0.0, 5.0);
        let alpha = 0.3f32;

        if let Some(hit) = self.records.get_mut(&key) {
            hit.count += 1;
            let hours = (1u32 << (hit.count.min(10) - 1)).min(24);
            hit.inhibit_until_ts_ms = now_ts_ms + (hours as i64) * 60 * 60 * 1000;
            hit.sev_eff = (hit.sev_eff * (1.0 - alpha) + clamped * alpha).clamp(0.0, 5.0);
            hit.last_ts_ms = now_ts_ms;
        } else {
            self.records.insert(
                key,
                TraumaHit {
                    sev_eff: clamped,
                    count: 1,
                    inhibit_until_ts_ms: now_ts_ms + 60 * 60 * 1000,
                    last_ts_ms: now_ts_ms,
                },
            );
        }

        Ok(())
    }

    pub fn is_inhibited(&self, mode: u8, action_name: &str, now_ts_ms: i64) -> bool {
        let key = hash_context(mode, action_name);
        self.records
            .get(&key)
            .map(|h| h.inhibit_until_ts_ms > now_ts_ms)
            .unwrap_or(false)
    }

    pub fn get_remaining_ms(&self, mode: u8, action_name: &str, now_ts_ms: i64) -> i64 {
        let key = hash_context(mode, action_name);
        self.records
            .get(&key)
            .map(|h| (h.inhibit_until_ts_ms - now_ts_ms).max(0))
            .unwrap_or(0)
    }

    pub fn heal(&mut self, mode: u8, action_name: &str) {
        let key = hash_context(mode, action_name);
        self.records.remove(&key);
    }

    pub fn export_records(&self) -> Result<JsValue, JsValue> {
        let mut dump: HashMap<String, TraumaHit> = HashMap::new();
        for (k, v) in self.records.iter() {
            dump.insert(hex_key(k), v.clone());
        }
        serde_wasm_bindgen::to_value(&dump).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

fn hash_context(mode: u8, action_name: &str) -> Vec<u8> {
    let mut hasher = Hasher::new();
    hasher.update(&[mode]);
    hasher.update(action_name.as_bytes());
    hasher.finalize().as_bytes().to_vec()
}

fn hex_key(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}
