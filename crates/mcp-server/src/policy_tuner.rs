// policy_tuner.rs — Closed-loop policy threshold tuning via runtime telemetry.
//
// The tuner is conservative by design:
// - always starts from static safe defaults
// - only adjusts after minimum sample size
// - clamps everything to hard guardrail bounds

use crate::helpers::clamp01;
use crate::types::EffectivePolicyThresholds;
use crate::EidolonMcpServer;

impl EidolonMcpServer {
    pub(crate) fn baseline_policy_thresholds() -> EffectivePolicyThresholds {
        EffectivePolicyThresholds {
            auto_execute_min_confidence: 0.88,
            propose_min_confidence: 0.62,
            ingress_block_risk: 0.82,
            ingress_block_critical: 0.72,
            ingress_ask_risk: 0.62,
            ingress_ask_critical: 0.58,
        }
    }

    pub(crate) fn policy_tuner_enabled() -> bool {
        Self::env_flag("POLICY_TUNER_ENABLED", false)
    }

    pub(crate) fn policy_tuner_min_samples() -> u64 {
        Self::env_u64("POLICY_TUNER_MIN_SAMPLES", 25).max(5)
    }

    pub(crate) fn tuned_policy_thresholds_from_observation(
        base: &EffectivePolicyThresholds,
        calls: u64,
        error_rate: f64,
        fallback_rate: f64,
        latency_p95_ms: f64,
    ) -> EffectivePolicyThresholds {
        if calls == 0 {
            return base.clone();
        }

        let mut tuned = base.clone();
        let error_rate = clamp01(error_rate);
        let fallback_rate = clamp01(fallback_rate);
        let p95_pressure = clamp01((latency_p95_ms / 2500.0).max(0.0));
        let instability = clamp01(error_rate * 0.55 + fallback_rate * 0.30 + p95_pressure * 0.15);
        // Pivot 0.35: above = tighten safety, below = mildly relax.
        let drift = instability - 0.35;

        tuned.auto_execute_min_confidence =
            (tuned.auto_execute_min_confidence + drift * 0.18).clamp(0.82, 0.97);
        tuned.propose_min_confidence =
            (tuned.propose_min_confidence + drift * 0.14).clamp(0.48, 0.88);

        // For risk thresholds, lower threshold => stricter gate.
        tuned.ingress_block_risk = (tuned.ingress_block_risk - drift * 0.12).clamp(0.55, 0.92);
        tuned.ingress_block_critical =
            (tuned.ingress_block_critical - drift * 0.10).clamp(0.45, 0.88);
        tuned.ingress_ask_risk = (tuned.ingress_ask_risk - drift * 0.10).clamp(0.45, 0.86);
        tuned.ingress_ask_critical = (tuned.ingress_ask_critical - drift * 0.08).clamp(0.40, 0.82);

        tuned
    }

    pub(crate) async fn effective_policy_thresholds(
        &self,
        tenant_id: &str,
        tool_name: &str,
    ) -> EffectivePolicyThresholds {
        let mut tuned = Self::baseline_policy_thresholds();
        if !Self::policy_tuner_enabled() {
            return tuned;
        }

        let key = format!("{}:{}", tenant_id, tool_name);
        let snapshot = {
            let metrics = self.tool_metrics.read().await;
            metrics.get(&key).cloned()
        };
        let Some(metric) = snapshot else {
            return tuned;
        };
        if metric.calls < Self::policy_tuner_min_samples() {
            return tuned;
        }
        let calls = metric.calls.max(1) as f64;
        let error_rate = metric.errors as f64 / calls;
        let fallback_rate = metric.fallback_count as f64 / calls;
        Self::tuned_policy_thresholds_from_observation(
            &tuned,
            metric.calls,
            error_rate,
            fallback_rate,
            metric.latency_p95_ms,
        )
    }
}
