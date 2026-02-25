// routing.rs — Adaptive Routing Policy Engine (Phase 3)
//
// Quyết định khi nào gọi Local (TensorOracle/Ollama) vs External API
// dựa trên Entropy, Trauma, Budget, Privacy, và Provider Health.
// Circuit Breaker FSM: Closed → Open → HalfOpen → Closed.

use std::sync::Mutex;

// ============================================
// Core Types
// ============================================

/// Snapshot không-locking của trạng thái hệ thống tại thời điểm routing.
/// Phải được build trước khi acquire bất kỳ RwLock nào khác.
#[derive(Clone, Debug)]
pub struct RoutingContext {
    /// Thermodynamic entropy hiện tại (0.0 - 1.0).
    /// Giá trị cao → exploratory → candidates for External.
    pub entropy: f32,
    /// Trauma severity snapshot (0.0 - 5.0).
    /// Khi > 3.0, hệ thống ở Guardian mode → chỉ Local.
    pub trauma_severity: f32,
    /// SLO latency budget từ caller (ms).
    pub latency_budget_ms: u64,
    /// true = dữ liệu nhạy cảm → không được gửi ra External dù entropy cao.
    pub privacy_sensitive: bool,
    /// true = hành động thực tế (execute swap, etc.) → local only.
    pub is_action: bool,
    /// Tenant ID của request.
    pub tenant_id: String,
}

/// Kết quả quyết định của Router.
#[derive(Debug, Clone)]
pub enum RoutingDecision {
    /// Ưu tiên tuyệt đối: local Candle/GGUF inference.
    LocalTensorOracle,
    /// Fallback local: Ollama HTTP (localhost:11434).
    LocalOllama,
    /// External API (OpenAI-compatible).
    External { url: String, model: String },
    /// Tất cả providers đều không khả dụng.
    Unavailable { reason: String },
}

/// Xác định provider nào đang được đề cập.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    TensorOracle,
    Ollama,
    External,
}

// ============================================
// Circuit Breaker
// ============================================

/// Trạng thái của một provider theo Circuit Breaker FSM.
#[derive(Debug, Default)]
pub struct ProviderHealth {
    /// Số lần failure trong cửa sổ hiện tại.
    pub failures_recent: u32,
    /// ms timestamp của lần failure cuối.
    pub last_failure_ms: i64,
    /// true = circuit mở (provider bị cắt).
    pub circuit_open: bool,
    /// ms timestamp — khi nào mới cho phép thử lại (HalfOpen).
    pub cooldown_until_ms: i64,
    /// Đang ở HalfOpen: đã gửi probe request, chờ kết quả.
    pub half_open_probe_sent: bool,
}

/// Cấu hình Circuit Breaker, đọc từ env.
#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    /// Bao nhiêu lần fail liên tiếp mới trip circuit.
    pub failure_threshold: u32,
    /// Cooldown sau khi circuit open (giây).
    pub cooldown_secs: u64,
    /// URL external provider (rỗng = disabled).
    pub external_url: String,
    /// API key cho external provider (None = không cần).
    pub external_api_key: Option<String>,
    /// Model name cho external provider.
    pub external_model: String,
    /// Timeout HTTP cho external provider (giây).
    pub external_timeout_secs: u64,
    /// Ngưỡng entropy để route sang External (cần > này).
    pub external_entropy_threshold: f32,
    /// true = external provider được phép dùng (env flag).
    pub external_enabled: bool,
}

impl CircuitBreakerConfig {
    /// Đọc cấu hình từ biến môi trường, với defaults an toàn.
    pub fn from_env() -> Self {
        let external_enabled = std::env::var("ROUTING_EXTERNAL_ENABLED")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);

        let external_url = std::env::var("ROUTING_EXTERNAL_URL")
            .unwrap_or_default()
            .trim()
            .to_string();

        let external_api_key = std::env::var("ROUTING_EXTERNAL_API_KEY")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        let external_model = std::env::var("ROUTING_EXTERNAL_MODEL")
            .unwrap_or_else(|_| "gpt-4o-mini".to_string())
            .trim()
            .to_string();

        let external_timeout_secs = std::env::var("ROUTING_EXTERNAL_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(15);

        let external_entropy_threshold = std::env::var("ROUTING_EXTERNAL_ENTROPY_THRESHOLD")
            .ok()
            .and_then(|v| v.trim().parse::<f32>().ok())
            .unwrap_or(0.6);

        let failure_threshold = std::env::var("ROUTING_CIRCUIT_BREAKER_FAILURE_THRESHOLD")
            .ok()
            .and_then(|v| v.trim().parse::<u32>().ok())
            .unwrap_or(3);

        let cooldown_secs = std::env::var("ROUTING_CIRCUIT_BREAKER_COOLDOWN_SECS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(60);

        Self {
            failure_threshold,
            cooldown_secs,
            external_url,
            external_api_key,
            external_model,
            external_timeout_secs,
            external_entropy_threshold,
            external_enabled,
        }
    }
}

// ============================================
// RoutingPolicyEngine
// ============================================

/// Engine chính — thread-safe, Clone-safe (Arc wrapper ở EidolonMcpServer).
pub struct RoutingPolicyEngine {
    tensor_health: Mutex<ProviderHealth>,
    ollama_health: Mutex<ProviderHealth>,
    external_health: Mutex<ProviderHealth>,
    pub config: CircuitBreakerConfig,
}

impl RoutingPolicyEngine {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            tensor_health: Mutex::new(ProviderHealth::default()),
            ollama_health: Mutex::new(ProviderHealth::default()),
            external_health: Mutex::new(ProviderHealth::default()),
            config,
        }
    }

    /// Kiểm tra circuit có mở không, đồng thời tự động chuyển HalfOpen nếu cooldown hết.
    pub fn is_circuit_open(&self, provider: Provider) -> bool {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let health_mutex = match provider {
            Provider::TensorOracle => &self.tensor_health,
            Provider::Ollama => &self.ollama_health,
            Provider::External => &self.external_health,
        };
        let mut health = health_mutex.lock().expect("circuit lock poisoned");
        if health.circuit_open && now_ms >= health.cooldown_until_ms {
            // Cooldown hết → HalfOpen: cho phép 1 probe request
            health.circuit_open = false;
            health.half_open_probe_sent = false;
        }
        health.circuit_open
    }

    /// Ghi nhận thành công cho provider → reset failure counter.
    pub fn record_success(&self, provider: Provider) {
        let health_mutex = match provider {
            Provider::TensorOracle => &self.tensor_health,
            Provider::Ollama => &self.ollama_health,
            Provider::External => &self.external_health,
        };
        let mut health = health_mutex.lock().expect("circuit lock poisoned");
        health.failures_recent = 0;
        health.circuit_open = false;
        health.half_open_probe_sent = false;
    }

    /// Ghi nhận failure cho provider → trip circuit nếu đạt threshold.
    pub fn record_failure(&self, provider: Provider) {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let health_mutex = match provider {
            Provider::TensorOracle => &self.tensor_health,
            Provider::Ollama => &self.ollama_health,
            Provider::External => &self.external_health,
        };
        let mut health = health_mutex.lock().expect("circuit lock poisoned");
        health.failures_recent = health.failures_recent.saturating_add(1);
        health.last_failure_ms = now_ms;
        if health.failures_recent >= self.config.failure_threshold {
            health.circuit_open = true;
            health.cooldown_until_ms = now_ms + (self.config.cooldown_secs as i64 * 1000);
            eprintln!(
                "[Eidolon Router] ⚡ Circuit OPEN for {:?} after {} failures. Cooldown: {}s",
                provider, health.failures_recent, self.config.cooldown_secs
            );
        }
    }

    /// Quyết định provider dựa trên 7 policy rules theo thứ tự ưu tiên nghiêm ngặt.
    pub fn decide(&self, ctx: &RoutingContext) -> RoutingDecision {
        let tensor_circuit_open = self.is_circuit_open(Provider::TensorOracle);
        let ollama_circuit_open = self.is_circuit_open(Provider::Ollama);
        let external_circuit_open = self.is_circuit_open(Provider::External);

        // Rule 1: Privacy Gate — KHÔNG BAO GIỜ gửi ra External
        if ctx.privacy_sensitive {
            eprintln!("[Eidolon Router] Rule 1: privacy_sensitive → LocalTensorOracle");
            if !tensor_circuit_open {
                return RoutingDecision::LocalTensorOracle;
            }
            if !ollama_circuit_open {
                return RoutingDecision::LocalOllama;
            }
            return RoutingDecision::Unavailable {
                reason: "privacy_gate: all_local_circuits_open".to_string(),
            };
        }

        // Rule 2: Action Gate — Hành động thực tế phải qua local (determinism)
        if ctx.is_action {
            eprintln!("[Eidolon Router] Rule 2: is_action → LocalTensorOracle");
            if !tensor_circuit_open {
                return RoutingDecision::LocalTensorOracle;
            }
            if !ollama_circuit_open {
                return RoutingDecision::LocalOllama;
            }
            return RoutingDecision::Unavailable {
                reason: "action_gate: all_local_circuits_open".to_string(),
            };
        }

        // Rule 3: Trauma Guardian Mode — Severity cao → Local chắc chắn nhất
        if ctx.trauma_severity > 3.0 {
            eprintln!(
                "[Eidolon Router] Rule 3: trauma_severity={:.1} > 3.0 → Guardian/LocalTensorOracle",
                ctx.trauma_severity
            );
            if !tensor_circuit_open {
                return RoutingDecision::LocalTensorOracle;
            }
            if !ollama_circuit_open {
                return RoutingDecision::LocalOllama;
            }
            return RoutingDecision::Unavailable {
                reason: "trauma_guardian: all_local_circuits_open".to_string(),
            };
        }

        // Rule 4: External Route — Entropy cao + external enabled + circuit OK
        let external_viable = self.config.external_enabled
            && !self.config.external_url.is_empty()
            && ctx.entropy > self.config.external_entropy_threshold
            && !external_circuit_open;

        if external_viable {
            eprintln!(
                "[Eidolon Router] Rule 4: entropy={:.2} > {:.2} → External ({})",
                ctx.entropy, self.config.external_entropy_threshold, self.config.external_model
            );
            return RoutingDecision::External {
                url: self.config.external_url.clone(),
                model: self.config.external_model.clone(),
            };
        }

        // Rule 5: Local TensorOracle (ưu tiên nhất trong local)
        if !tensor_circuit_open {
            eprintln!("[Eidolon Router] Rule 5: LocalTensorOracle");
            return RoutingDecision::LocalTensorOracle;
        }

        // Rule 6: Ollama fallback (local HTTP)
        if !ollama_circuit_open {
            eprintln!("[Eidolon Router] Rule 6: TensorOracle circuit open → LocalOllama fallback");
            return RoutingDecision::LocalOllama;
        }

        // Rule 7: Tất cả đều dead
        let reason = if self.config.external_enabled {
            "all_providers_circuit_open"
        } else {
            "all_local_circuits_open_and_external_disabled"
        };
        eprintln!(
            "[Eidolon Router] Rule 7: All providers unavailable ({})",
            reason
        );
        RoutingDecision::Unavailable {
            reason: reason.to_string(),
        }
    }
}

// ============================================
// Unit Tests (deterministic, no IO)
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(external_enabled: bool, entropy_threshold: f32) -> CircuitBreakerConfig {
        CircuitBreakerConfig {
            failure_threshold: 3,
            cooldown_secs: 60,
            external_url: if external_enabled {
                "https://api.example.com/v1/chat/completions".to_string()
            } else {
                "".to_string()
            },
            external_api_key: None,
            external_model: "test-model".to_string(),
            external_timeout_secs: 10,
            external_entropy_threshold: entropy_threshold,
            external_enabled,
        }
    }

    fn make_ctx(
        entropy: f32,
        trauma: f32,
        privacy: bool,
        is_action: bool,
        budget: u64,
    ) -> RoutingContext {
        RoutingContext {
            entropy,
            trauma_severity: trauma,
            latency_budget_ms: budget,
            privacy_sensitive: privacy,
            is_action,
            tenant_id: "test_tenant".to_string(),
        }
    }

    // Rule 1: Privacy Gate
    #[test]
    fn test_routing_privacy_forces_local_tensor() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.5));
        let ctx = make_ctx(0.9, 0.0, true, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalTensorOracle));
    }

    #[test]
    fn test_routing_privacy_falls_to_ollama_if_tensor_open() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.5));
        // Force TensorOracle circuit open via 3 failures
        engine.record_failure(Provider::TensorOracle);
        engine.record_failure(Provider::TensorOracle);
        engine.record_failure(Provider::TensorOracle);
        let ctx = make_ctx(0.9, 0.0, true, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalOllama));
    }

    #[test]
    fn test_routing_privacy_unavailable_if_all_local_open() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.5));
        for _ in 0..3 {
            engine.record_failure(Provider::TensorOracle);
            engine.record_failure(Provider::Ollama);
        }
        let ctx = make_ctx(0.9, 0.0, true, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::Unavailable { .. }));
    }

    // Rule 2: Action Gate
    #[test]
    fn test_routing_action_forces_local() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.5));
        let ctx = make_ctx(0.9, 0.0, false, true, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalTensorOracle));
    }

    // Rule 3: Trauma Guardian
    #[test]
    fn test_routing_high_trauma_forces_local() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.5));
        let ctx = make_ctx(0.9, 4.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalTensorOracle));
    }

    #[test]
    fn test_routing_trauma_below_threshold_allows_external() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.5));
        let ctx = make_ctx(0.9, 2.9, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::External { .. }));
    }

    // Rule 4: External Route
    #[test]
    fn test_routing_high_entropy_goes_external_when_enabled() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.6));
        let ctx = make_ctx(0.9, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::External { .. }));
    }

    #[test]
    fn test_routing_external_disabled_by_env_stays_local() {
        let engine = RoutingPolicyEngine::new(make_config(false, 0.6));
        let ctx = make_ctx(0.9, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        // External disabled → phải là local
        assert!(matches!(
            decision,
            RoutingDecision::LocalTensorOracle | RoutingDecision::LocalOllama
        ));
    }

    #[test]
    fn test_routing_entropy_below_threshold_stays_local() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.6));
        let ctx = make_ctx(0.4, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalTensorOracle));
    }

    #[test]
    fn test_routing_external_circuit_open_falls_to_local() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.5));
        for _ in 0..3 {
            engine.record_failure(Provider::External);
        }
        let ctx = make_ctx(0.9, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalTensorOracle));
    }

    // Rule 5: Local TensorOracle
    #[test]
    fn test_routing_low_entropy_prefers_local_tensor() {
        let engine = RoutingPolicyEngine::new(make_config(true, 0.6));
        let ctx = make_ctx(0.2, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalTensorOracle));
    }

    // Rule 6: Ollama fallback
    #[test]
    fn test_routing_tensor_dead_falls_to_ollama() {
        let engine = RoutingPolicyEngine::new(make_config(false, 0.6));
        for _ in 0..3 {
            engine.record_failure(Provider::TensorOracle);
        }
        let ctx = make_ctx(0.2, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalOllama));
    }

    // Rule 7: All providers dead
    #[test]
    fn test_routing_all_dead_returns_unavailable() {
        let engine = RoutingPolicyEngine::new(make_config(false, 0.6));
        for _ in 0..3 {
            engine.record_failure(Provider::TensorOracle);
            engine.record_failure(Provider::Ollama);
        }
        let ctx = make_ctx(0.2, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::Unavailable { .. }));
    }

    // Circuit Breaker FSM
    #[test]
    fn test_circuit_breaker_opens_after_threshold() {
        let engine = RoutingPolicyEngine::new(make_config(false, 0.6));
        assert!(!engine.is_circuit_open(Provider::Ollama));
        engine.record_failure(Provider::Ollama);
        engine.record_failure(Provider::Ollama);
        assert!(!engine.is_circuit_open(Provider::Ollama)); // Chưa đủ threshold
        engine.record_failure(Provider::Ollama);
        assert!(engine.is_circuit_open(Provider::Ollama)); // Đã đủ 3 failures
    }

    #[test]
    fn test_circuit_breaker_closes_on_success() {
        let engine = RoutingPolicyEngine::new(make_config(false, 0.6));
        engine.record_failure(Provider::TensorOracle);
        engine.record_failure(Provider::TensorOracle);
        engine.record_failure(Provider::TensorOracle);
        assert!(engine.is_circuit_open(Provider::TensorOracle));
        engine.record_success(Provider::TensorOracle);
        assert!(!engine.is_circuit_open(Provider::TensorOracle));
    }

    #[test]
    fn test_circuit_failure_counter_resets_on_success() {
        let engine = RoutingPolicyEngine::new(make_config(false, 0.6));
        engine.record_failure(Provider::External);
        engine.record_failure(Provider::External);
        engine.record_success(Provider::External);
        // 2 failures + 1 success → counter reset → 2 more failures không đủ trip
        engine.record_failure(Provider::External);
        engine.record_failure(Provider::External);
        assert!(!engine.is_circuit_open(Provider::External));
    }

    #[test]
    fn test_circuit_breaker_each_provider_independent() {
        let engine = RoutingPolicyEngine::new(make_config(false, 0.6));
        for _ in 0..3 {
            engine.record_failure(Provider::TensorOracle);
        }
        assert!(engine.is_circuit_open(Provider::TensorOracle));
        assert!(!engine.is_circuit_open(Provider::Ollama));
        assert!(!engine.is_circuit_open(Provider::External));
    }

    // Policy Priority
    #[test]
    fn test_routing_privacy_beats_trauma_beats_external() {
        // privacy=true + trauma=4.0 + entropy=0.99 → privacy wins → LocalTensorOracle
        let engine = RoutingPolicyEngine::new(make_config(true, 0.3));
        let ctx = make_ctx(0.99, 4.0, true, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalTensorOracle));
    }

    #[test]
    fn test_routing_action_beats_external() {
        // is_action=true + entropy=0.99 → action wins over external
        let engine = RoutingPolicyEngine::new(make_config(true, 0.3));
        let ctx = make_ctx(0.99, 0.0, false, true, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(decision, RoutingDecision::LocalTensorOracle));
    }

    #[test]
    fn test_routing_external_url_empty_forces_local() {
        let mut config = make_config(true, 0.5);
        config.external_url = "".to_string(); // URL rỗng = disabled thực tế
        let engine = RoutingPolicyEngine::new(config);
        let ctx = make_ctx(0.9, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        assert!(matches!(
            decision,
            RoutingDecision::LocalTensorOracle | RoutingDecision::LocalOllama
        ));
    }

    #[test]
    fn test_routing_unavailable_reason_contains_context() {
        let engine = RoutingPolicyEngine::new(make_config(false, 0.6));
        for _ in 0..3 {
            engine.record_failure(Provider::TensorOracle);
            engine.record_failure(Provider::Ollama);
        }
        let ctx = make_ctx(0.5, 0.0, false, false, 1000);
        let decision = engine.decide(&ctx);
        if let RoutingDecision::Unavailable { reason } = decision {
            assert!(!reason.is_empty());
        } else {
            panic!("Expected Unavailable");
        }
    }
}
