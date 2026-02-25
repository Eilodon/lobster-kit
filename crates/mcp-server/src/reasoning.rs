// reasoning.rs — Cognitive reasoning mode selection and embedding dispatch.
//
// Extracted from main.rs. Uses impl-block extension pattern:
// EidolonMcpServer methods live here, struct definition remains in main.rs.

use crate::helpers::*;
use crate::EidolonMcpServer;

impl EidolonMcpServer {
    pub(crate) async fn select_reasoning_mode(
        &self,
        requested_mode: &str,
        draft: &str,
        context: &str,
        latency_budget_ms: u64,
    ) -> (String, bool, String) {
        let requested = requested_mode.trim().to_ascii_lowercase();
        if requested == "fast" || requested == "deep" {
            return (
                requested.clone(),
                false,
                "explicit_mode_requested".to_string(),
            );
        }

        let draft_tokens = simple_tokenize(draft).len();
        let context_tokens = simple_tokenize(context).len();
        let complexity_tokens = draft_tokens + context_tokens;
        let context_lower = context.to_ascii_lowercase();
        let has_high_risk_cues = ["critical", "complex", "high risk", "unsafe", "incident"]
            .iter()
            .any(|cue| context_lower.contains(cue));
        let critical_action_signals_present = has_critical_action_signals(context);

        let historical_pressure = {
            let metrics = self.tool_metrics.read().await;
            metrics
                .get("eidolon_reason_chain")
                .map(|metric| metric.latency_p95_ms)
                .unwrap_or(0.0)
        };

        let prefer_deep =
            complexity_tokens >= 120 || has_high_risk_cues || critical_action_signals_present;
        let budget_constrained = latency_budget_ms < 900
            || (historical_pressure > 0.0 && historical_pressure > latency_budget_ms as f64);

        if critical_action_signals_present {
            (
                "deep".to_string(),
                false,
                if budget_constrained {
                    "auto_critical_action_force_deep_budget_override".to_string()
                } else {
                    "auto_critical_action_force_deep".to_string()
                },
            )
        } else if prefer_deep && !budget_constrained {
            (
                "deep".to_string(),
                false,
                "auto_complexity_selected_deep".to_string(),
            )
        } else if prefer_deep && budget_constrained {
            (
                "fast".to_string(),
                true,
                "auto_budget_guard_fallback_fast".to_string(),
            )
        } else {
            ("fast".to_string(), false, "auto_default_fast".to_string())
        }
    }

    pub(crate) fn embed_text_with_fallback(&self, text: &str) -> (Vec<f32>, &'static str) {
        if let Some(ref engine) = *self.embedding_engine {
            if let Ok(vector) = engine.embed(text) {
                if !vector.is_empty() {
                    return (vector, "onnx_minilm");
                }
            }
        }
        (pseudo_embed(text), "pseudo_embed")
    }

    /// Build RoutingContext từ snapshot không-blocking.
    /// Phải gọi TRƯỚC khi thực hiện inference để tránh locking trong quá trình gọi model.
    pub(crate) async fn build_routing_context(
        &self,
        entropy: f32,
        trauma_mode: core_rust::sentinel::modes::SentinelMode,
        trauma_context_key: &str,
        latency_budget_ms: u64,
        privacy_sensitive: bool,
        is_action: bool,
        tenant_id: &str,
    ) -> crate::routing::RoutingContext {
        // Snapshot trauma severity (non-blocking read, drop lock immediately)
        let trauma_severity = {
            let trauma = self.trauma.read().await;
            trauma.get_trauma_severity(trauma_mode, trauma_context_key) as f32
        };
        crate::routing::RoutingContext {
            entropy,
            trauma_severity,
            latency_budget_ms,
            privacy_sensitive,
            is_action,
            tenant_id: tenant_id.to_string(),
        }
    }

    /// Execute inference qua Routing Engine.
    /// Tự động record success/failure vào Circuit Breaker.
    /// Fallback: nếu decision là Unavailable, trả về Err.
    pub(crate) async fn routed_generate(
        &self,
        ctx: &crate::routing::RoutingContext,
        prompt: &str,
    ) -> Result<String, String> {
        let started = std::time::Instant::now();
        let decision = self.routing_engine.decide(ctx);
        let provider = crate::providers::provider_name_from_decision(&decision).to_string();
        let mut reason = match &decision {
            crate::routing::RoutingDecision::LocalTensorOracle => {
                "policy_local_tensor_oracle".to_string()
            }
            crate::routing::RoutingDecision::LocalOllama => {
                "policy_local_ollama_fallback".to_string()
            }
            crate::routing::RoutingDecision::External { .. } => {
                "policy_external_high_entropy".to_string()
            }
            crate::routing::RoutingDecision::Unavailable { reason } => {
                format!("policy_unavailable:{}", reason)
            }
        };
        let mut fallback_used = matches!(
            &decision,
            crate::routing::RoutingDecision::LocalOllama
                | crate::routing::RoutingDecision::Unavailable { .. }
        );

        eprintln!(
            "[Eidolon Router] tenant={} decision={:?}",
            ctx.tenant_id,
            crate::providers::provider_name_from_decision(&decision)
        );

        let result = match &decision {
            crate::routing::RoutingDecision::LocalTensorOracle => {
                let result = self
                    .tensor_oracle
                    .generate_with_thermodynamics(
                        prompt,
                        ctx.entropy,
                        ctx.trauma_severity,
                        ctx.is_action,
                    )
                    .await;
                match result {
                    Ok(text) => {
                        self.routing_engine
                            .record_success(crate::routing::Provider::TensorOracle);
                        Ok(text)
                    }
                    Err(e) => {
                        self.routing_engine
                            .record_failure(crate::routing::Provider::TensorOracle);
                        Err(format!("tensor_oracle_error: {}", e))
                    }
                }
            }
            crate::routing::RoutingDecision::LocalOllama => {
                use crate::providers::LlmProvider;
                let adapter = crate::providers::OllamaAdapter::from_env();
                let result = adapter
                    .generate(prompt, ctx.entropy, ctx.trauma_severity, ctx.is_action)
                    .await;
                match result {
                    crate::providers::InferenceResult::Ok(text) => {
                        self.routing_engine
                            .record_success(crate::routing::Provider::Ollama);
                        Ok(text)
                    }
                    crate::providers::InferenceResult::Timeout => {
                        self.routing_engine
                            .record_failure(crate::routing::Provider::Ollama);
                        Err("ollama_timeout".to_string())
                    }
                    crate::providers::InferenceResult::Error(e) => {
                        self.routing_engine
                            .record_failure(crate::routing::Provider::Ollama);
                        Err(e)
                    }
                }
            }
            crate::routing::RoutingDecision::External { url, model } => {
                use crate::providers::LlmProvider;
                let adapter = crate::providers::ExternalLlmAdapter::new(
                    url.clone(),
                    self.routing_engine.config.external_api_key.clone(),
                    model.clone(),
                    self.routing_engine.config.external_timeout_secs,
                );
                let result = adapter
                    .generate(prompt, ctx.entropy, ctx.trauma_severity, ctx.is_action)
                    .await;
                match result {
                    crate::providers::InferenceResult::Ok(text) => {
                        // Phase 4: Critic gate for external output before returning to caller.
                        let expect_json = prompt.contains("Return ONLY a JSON object")
                            || prompt.contains("return ONLY a JSON object")
                            || prompt.contains("'factual_consistency'");
                        let critic = crate::critic::OutputCritic::from_env();
                        let verdict = critic.evaluate(&text, expect_json, "external");
                        if verdict.passed {
                            self.routing_engine
                                .record_success(crate::routing::Provider::External);
                            Ok(text)
                        } else {
                            self.routing_engine
                                .record_failure(crate::routing::Provider::External);
                            fallback_used = true;
                            reason = format!(
                                "{};critic_reject:score={:.2},violations={}",
                                reason,
                                verdict.score,
                                verdict.violations.len()
                            );
                            eprintln!(
                                "[Eidolon Router] External output rejected by critic. Falling back to local /think."
                            );
                            let fallback_entropy = ctx.entropy.max(0.9);
                            let fallback = self
                                .tensor_oracle
                                .generate_with_thermodynamics(
                                    prompt,
                                    fallback_entropy,
                                    ctx.trauma_severity,
                                    false,
                                )
                                .await;
                            match fallback {
                                Ok(local_text) => {
                                    self.routing_engine
                                        .record_success(crate::routing::Provider::TensorOracle);
                                    Ok(local_text)
                                }
                                Err(e) => {
                                    self.routing_engine
                                        .record_failure(crate::routing::Provider::TensorOracle);
                                    Err(format!(
                                        "external_critic_rejected_and_local_fallback_failed: {}",
                                        e
                                    ))
                                }
                            }
                        }
                    }
                    crate::providers::InferenceResult::Timeout => {
                        self.routing_engine
                            .record_failure(crate::routing::Provider::External);
                        Err("external_timeout".to_string())
                    }
                    crate::providers::InferenceResult::Error(e) => {
                        self.routing_engine
                            .record_failure(crate::routing::Provider::External);
                        Err(e)
                    }
                }
            }
            crate::routing::RoutingDecision::Unavailable { reason } => {
                Err(format!("all_providers_unavailable: {}", reason))
            }
        };

        let latency_ms = started.elapsed().as_millis();
        let status = if result.is_ok() { "ok" } else { "error" };
        let fallback_reason = if fallback_used {
            Some(reason.clone())
        } else {
            None
        };
        let audit = eidolon_shared::observability::RouteDecisionAudit::new(
            ctx.tenant_id.clone(),
            provider,
            reason,
            fallback_used,
            fallback_reason,
            latency_ms,
            status,
        );
        eprintln!("[Eidolon Router Audit] {}", audit.to_json());

        result
    }
}
