// ingress_policy.rs — Fast ingress policy layer for tools/call.
//
// Runs before tool execution to provide a single, auditable decision context.
// This is intentionally heuristic/rule-based (no additional model call).

use crate::helpers::{clamp01, critical_action_signal_score, lexical_intent_risk_score};
use crate::types::{PolicyDecision, PolicySignalSnapshot, UnifiedPolicyContext};
use crate::EidolonMcpServer;

fn is_actionable_tool(tool_name: &str) -> bool {
    let lowered = tool_name.to_ascii_lowercase();
    [
        "execute",
        "swap",
        "panic",
        "forge",
        "set_entropy",
        "generated_tool_decision",
    ]
    .iter()
    .any(|cue| lowered.contains(cue))
}

fn payload_contains_sensitive_terms(payload: &str) -> bool {
    let lowered = payload.to_ascii_lowercase();
    [
        "private key",
        "mnemonic",
        "seed phrase",
        "api_key",
        "api-key",
        "bearer ",
        "password",
        "secret",
        "token=",
    ]
    .iter()
    .any(|cue| lowered.contains(cue))
}

impl EidolonMcpServer {
    pub(crate) async fn evaluate_ingress_policy(
        &self,
        tenant_id: &str,
        tool_name: &str,
        tool_args: &serde_json::Value,
    ) -> UnifiedPolicyContext {
        let payload_fingerprint = format!("{} {}", tool_name, tool_args);
        let lexical_risk_score = lexical_intent_risk_score(&payload_fingerprint);
        let critical_action_signal = critical_action_signal_score(&payload_fingerprint);
        let actionable_tool = is_actionable_tool(tool_name);
        let privacy_sensitive_payload = payload_contains_sensitive_terms(&payload_fingerprint);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let request_id = format!(
            "ingress-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );

        let trauma_inhibited = {
            let trauma = self.trauma.read().await;
            trauma.is_inhibited(
                core_rust::sentinel::modes::SentinelMode::Zen,
                &format!("{}:{}", tenant_id, tool_name),
                now_ms,
            )
        };

        let (historical_success_rate, historical_fallback_rate, historical_calls) = {
            let metrics = self.tool_metrics.read().await;
            let key = format!("{}:{}", tenant_id, tool_name);
            if let Some(metric) = metrics.get(&key) {
                let calls = metric.calls.max(1);
                let success_rate = 1.0 - (metric.errors as f64 / calls as f64);
                let fallback_rate = metric.fallback_count as f64 / calls as f64;
                (clamp01(success_rate), clamp01(fallback_rate), metric.calls)
            } else {
                (0.5, 0.0, 0)
            }
        };
        let thresholds = self.effective_policy_thresholds(tenant_id, tool_name).await;

        // Lightweight confidence proxy for route gate:
        // lower confidence when risk/action signals are strong.
        let mut ingress_intent_confidence =
            clamp01(1.0 - (lexical_risk_score * 0.65 + critical_action_signal * 0.35));
        if privacy_sensitive_payload {
            ingress_intent_confidence = clamp01(ingress_intent_confidence * 0.82);
        }

        let route_gate = self
            .handle_route_action(serde_json::json!({
                "tenant_id": tenant_id,
                "suggested_tool": tool_name,
                "intent_confidence": ingress_intent_confidence
            }))
            .await;
        let route_strategy = route_gate["strategy"].as_str().unwrap_or("ASK_USER");

        let (decision, decision_reason) = if trauma_inhibited {
            (PolicyDecision::Block, "trauma_registry_inhibited")
        } else if actionable_tool
            && privacy_sensitive_payload
            && lexical_risk_score >= thresholds.ingress_block_risk
        {
            (PolicyDecision::Block, "sensitive_payload_actionable_tool")
        } else if actionable_tool
            && (critical_action_signal >= thresholds.ingress_block_critical
                || lexical_risk_score >= thresholds.ingress_block_risk)
            && route_strategy == "ASK_USER"
        {
            (PolicyDecision::Block, "high_risk_action_requires_human")
        } else if actionable_tool
            && route_strategy == "ASK_USER"
            && (critical_action_signal >= thresholds.ingress_ask_critical
                || lexical_risk_score >= thresholds.ingress_ask_risk)
        {
            (PolicyDecision::AskUser, "route_gate_requires_human_review")
        } else {
            (PolicyDecision::Allow, "ingress_policy_pass")
        };

        UnifiedPolicyContext {
            policy_version: "ingress_policy.v1".to_string(),
            request_id,
            tenant_id: tenant_id.to_string(),
            tool_name: tool_name.to_string(),
            timestamp_ms: now_ms,
            signals: PolicySignalSnapshot {
                lexical_risk_score,
                critical_action_signal,
                privacy_sensitive_payload,
                actionable_tool,
                trauma_inhibited,
                historical_success_rate,
                historical_fallback_rate,
                historical_calls,
            },
            thresholds,
            route_gate,
            decision,
            decision_reason: decision_reason.to_string(),
        }
    }
}
