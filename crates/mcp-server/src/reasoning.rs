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
            let metrics = self.tool_metrics.lock().await;
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
}
