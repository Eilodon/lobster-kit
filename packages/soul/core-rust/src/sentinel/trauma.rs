use crate::sentinel::modes::SentinelMode;
use blake3::Hasher;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TraumaHit {
    pub sev_eff: f32,
    pub count: u32,
    pub inhibit_until_ts_us: i64,
    pub last_ts_us: i64,
}

#[derive(Serialize, Deserialize)]
pub struct TraumaRegistry {
    records: HashMap<Vec<u8>, TraumaHit>,
}

impl TraumaRegistry {
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
    ) {
        let now_ts_us = Utc::now().timestamp_micros();
        let key = Self::hash_context(mode, action_name);
        
        let (new_count, new_sev, inhibit_duration_us) = if let Some(existing) = self.records.get(&key) {
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
    pub fn is_inhibited(&self, mode: SentinelMode, action_name: &str) -> bool {
        let key = Self::hash_context(mode, action_name);
        if let Some(hit) = self.records.get(&key) {
            let now = Utc::now().timestamp_micros();
            if now < hit.inhibit_until_ts_us {
                return true;
            }
        }
        false
    }

    fn hash_context(mode: SentinelMode, action_name: &str) -> Vec<u8> {
        let mut hasher = Hasher::new();
        hasher.update(&[mode as u8]); // Assuming SentinelMode is repr(u8) or essentially enum
        hasher.update(action_name.as_bytes());
        hasher.finalize().as_bytes().to_vec()
    }
}

// Default impl
impl Default for TraumaRegistry {
    fn default() -> Self {
        Self::new()
    }
}
