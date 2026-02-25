use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    pub capacity: f64,
    pub refill_per_sec: f64,
}

#[derive(Debug, Clone)]
pub struct RateLimitVerdict {
    pub allowed: bool,
    pub remaining_tokens: f64,
    pub retry_after_ms: u64,
}

#[derive(Debug)]
struct BucketState {
    tokens: f64,
    last_refill: Instant,
}

pub struct TenantRateLimiter {
    config: RateLimitConfig,
    buckets: Mutex<HashMap<String, BucketState>>,
}

impl TenantRateLimiter {
    pub fn from_env() -> Self {
        let capacity = std::env::var("EIDOLON_RATE_LIMIT_CAPACITY")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| *v > 0.0)
            .unwrap_or(60.0);
        let refill_per_sec = std::env::var("EIDOLON_RATE_LIMIT_REFILL_PER_SEC")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| *v > 0.0)
            .unwrap_or(10.0);

        Self::new(RateLimitConfig {
            capacity,
            refill_per_sec,
        })
    }

    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn check_and_consume(&self, tenant_id: &str, tokens: f64) -> RateLimitVerdict {
        let now = Instant::now();
        let mut guard = self.buckets.lock().expect("rate limiter lock poisoned");
        let bucket = guard
            .entry(tenant_id.to_string())
            .or_insert_with(|| BucketState {
                tokens: self.config.capacity,
                last_refill: now,
            });

        let elapsed_secs = now.duration_since(bucket.last_refill).as_secs_f64();
        let replenished = elapsed_secs * self.config.refill_per_sec;
        bucket.tokens = (bucket.tokens + replenished).min(self.config.capacity);
        bucket.last_refill = now;

        if bucket.tokens >= tokens {
            bucket.tokens -= tokens;
            RateLimitVerdict {
                allowed: true,
                remaining_tokens: bucket.tokens,
                retry_after_ms: 0,
            }
        } else {
            let needed = (tokens - bucket.tokens).max(0.0);
            let retry_after_secs = needed / self.config.refill_per_sec;
            RateLimitVerdict {
                allowed: false,
                remaining_tokens: bucket.tokens,
                retry_after_ms: (retry_after_secs * 1000.0).ceil() as u64,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limit_blocks_after_bucket_empty() {
        let limiter = TenantRateLimiter::new(RateLimitConfig {
            capacity: 1.0,
            refill_per_sec: 0.1,
        });

        let first = limiter.check_and_consume("tenant", 1.0);
        assert!(first.allowed);
        let second = limiter.check_and_consume("tenant", 1.0);
        assert!(!second.allowed);
        assert!(second.retry_after_ms > 0);
    }
}
