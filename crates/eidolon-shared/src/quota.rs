use chrono::Utc;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Debug)]
pub struct QuotaConfig {
    pub max_requests_per_day: u64,
}

#[derive(Debug, Clone)]
pub struct QuotaVerdict {
    pub allowed: bool,
    pub remaining: u64,
}

pub struct TenantQuotaManager {
    config: QuotaConfig,
    counters: Mutex<HashMap<(String, String), u64>>,
}

impl TenantQuotaManager {
    pub fn from_env() -> Self {
        let max_requests_per_day = std::env::var("EIDOLON_QUOTA_MAX_REQUESTS_PER_DAY")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(100_000);
        Self::new(QuotaConfig {
            max_requests_per_day,
        })
    }

    pub fn new(config: QuotaConfig) -> Self {
        Self {
            config,
            counters: Mutex::new(HashMap::new()),
        }
    }

    pub fn consume(&self, tenant_id: &str) -> QuotaVerdict {
        let day_key = Utc::now().format("%Y-%m-%d").to_string();
        let mut guard = self.counters.lock().expect("quota lock poisoned");
        let counter = guard
            .entry((tenant_id.to_string(), day_key))
            .or_insert(0_u64);

        if *counter >= self.config.max_requests_per_day {
            return QuotaVerdict {
                allowed: false,
                remaining: 0,
            };
        }

        *counter += 1;
        QuotaVerdict {
            allowed: true,
            remaining: self.config.max_requests_per_day.saturating_sub(*counter),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quota_stops_after_limit() {
        let quota = TenantQuotaManager::new(QuotaConfig {
            max_requests_per_day: 1,
        });

        let first = quota.consume("tenant-x");
        assert!(first.allowed);
        let second = quota.consume("tenant-x");
        assert!(!second.allowed);
        assert_eq!(second.remaining, 0);
    }
}
