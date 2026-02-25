// tool_gen.rs — Tool generation governance: promotion, autopilot, recommender.
//
// Owns all toolgen-related logic: env config helpers, threshold evaluation,
// recommendation models (v1 keyword + v2 tracker), shadow audit sampling.
// Some methods use `&self` for telemetry access.

use crate::helpers::*;
use crate::types::*;
use crate::EidolonMcpServer;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

// ── Environment config helpers ──────────────────────────────────────
impl EidolonMcpServer {
    pub(crate) fn normalize_env_label(raw: &str) -> String {
        let normalized = raw.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "dev" => "development".to_string(),
            "prod" => "production".to_string(),
            "stage" => "staging".to_string(),
            _ => normalized,
        }
    }

    pub(crate) fn parse_allowed_envs(raw: &str) -> Vec<String> {
        raw.split(',')
            .map(Self::normalize_env_label)
            .filter(|item| !item.is_empty())
            .collect::<Vec<String>>()
    }

    pub(crate) fn env_flag(name: &str, default: bool) -> bool {
        let Ok(raw) = std::env::var(name) else {
            return default;
        };
        match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default,
        }
    }

    pub(crate) fn env_percent(name: &str, default: u64) -> u64 {
        let Ok(raw) = std::env::var(name) else {
            return default.clamp(0, 100);
        };
        raw.parse::<u64>()
            .ok()
            .map(|value| value.clamp(0, 100))
            .unwrap_or(default.clamp(0, 100))
    }

    pub(crate) fn env_u64(name: &str, default: u64) -> u64 {
        let Ok(raw) = std::env::var(name) else {
            return default;
        };
        raw.trim().parse::<u64>().ok().unwrap_or(default)
    }

    pub(crate) fn env_f64(name: &str, default: f64) -> f64 {
        let Ok(raw) = std::env::var(name) else {
            return default;
        };
        raw.trim().parse::<f64>().ok().unwrap_or(default)
    }

    pub(crate) fn normalized_runtime_profile() -> String {
        let raw = std::env::var("MCP_ENV_PROFILE")
            .or_else(|_| std::env::var("RUNTIME_ENV"))
            .or_else(|_| std::env::var("NODE_ENV"))
            .unwrap_or_else(|_| "development".to_string());
        Self::normalize_env_label(&raw)
    }

    pub(crate) fn allowed_tool_gen_profiles() -> Vec<String> {
        let raw = std::env::var("TOOL_GEN_ALLOWED_ENVS")
            .unwrap_or_else(|_| super::DEFAULT_TOOL_GEN_ALLOWED_ENVS.to_string());
        Self::parse_allowed_envs(&raw)
    }

    pub(crate) fn is_tool_gen_enabled_in_runtime() -> (bool, String, Vec<String>) {
        let profile = Self::normalized_runtime_profile();
        let allowed_profiles = Self::allowed_tool_gen_profiles();
        let profile_allowed = allowed_profiles.iter().any(|entry| entry == &profile);
        let tool_gen_enabled = Self::env_flag("TOOL_GEN_EXPERIMENTAL_ENABLED", false);
        (
            tool_gen_enabled && profile_allowed,
            profile,
            allowed_profiles,
        )
    }

    pub(crate) fn legacy_defi_compat_enabled() -> bool {
        let compat_requested = Self::env_flag(
            "LEGACY_DEFI_COMPAT_ENABLED",
            super::DEFAULT_LEGACY_DEFI_COMPAT_ENABLED,
        );
        if !compat_requested {
            return false;
        }

        let profile = Self::normalized_runtime_profile();
        let allowed_profiles = std::env::var("LEGACY_DEFI_COMPAT_ALLOWED_ENVS")
            .map(|value| Self::parse_allowed_envs(&value))
            .unwrap_or_else(|_| {
                Self::parse_allowed_envs(super::DEFAULT_LEGACY_DEFI_COMPAT_ALLOWED_ENVS)
            });
        allowed_profiles.iter().any(|entry| entry == &profile)
    }
}

// ── Promotion & Autopilot ───────────────────────────────────────────
impl EidolonMcpServer {
    pub(crate) fn promotion_thresholds() -> ToolPromotionThresholds {
        ToolPromotionThresholds {
            min_calls: Self::env_u64(
                "TOOL_GEN_PROMOTE_MIN_CALLS",
                super::DEFAULT_TOOL_GEN_PROMOTE_MIN_CALLS,
            )
            .max(1),
            max_error_rate: clamp01(Self::env_f64(
                "TOOL_GEN_PROMOTE_MAX_ERROR_RATE",
                super::DEFAULT_TOOL_GEN_PROMOTE_MAX_ERROR_RATE,
            )),
            max_p95_ms: Self::env_f64(
                "TOOL_GEN_PROMOTE_MAX_P95_MS",
                super::DEFAULT_TOOL_GEN_PROMOTE_MAX_P95_MS,
            )
            .max(1.0),
            max_fallback_rate: clamp01(Self::env_f64(
                "TOOL_GEN_PROMOTE_MAX_FALLBACK_RATE",
                super::DEFAULT_TOOL_GEN_PROMOTE_MAX_FALLBACK_RATE,
            )),
            min_satisfaction: clamp01(Self::env_f64(
                "TOOL_GEN_PROMOTE_MIN_SATISFACTION",
                super::DEFAULT_TOOL_GEN_PROMOTE_MIN_SATISFACTION,
            )),
        }
    }

    pub(crate) fn evaluate_tool_promotion(
        row: &PersistedToolPerformanceRow,
        thresholds: &ToolPromotionThresholds,
    ) -> (bool, Vec<String>) {
        let error_rate = clamp01(1.0 - row.success_rate);
        let mut reasons = Vec::new();

        if row.call_count < thresholds.min_calls {
            reasons.push(format!(
                "calls_below_min:{}<{}",
                row.call_count, thresholds.min_calls
            ));
        }
        if error_rate > thresholds.max_error_rate {
            reasons.push(format!(
                "error_rate_exceeds:{:.4}>{:.4}",
                error_rate, thresholds.max_error_rate
            ));
        }
        if row.latency_p95_ms > thresholds.max_p95_ms {
            reasons.push(format!(
                "p95_exceeds:{:.2}>{:.2}",
                row.latency_p95_ms, thresholds.max_p95_ms
            ));
        }
        if row.fallback_rate > thresholds.max_fallback_rate {
            reasons.push(format!(
                "fallback_rate_exceeds:{:.4}>{:.4}",
                row.fallback_rate, thresholds.max_fallback_rate
            ));
        }
        if row.user_satisfaction < thresholds.min_satisfaction {
            reasons.push(format!(
                "satisfaction_below_min:{:.4}<{:.4}",
                row.user_satisfaction, thresholds.min_satisfaction
            ));
        }

        (reasons.is_empty(), reasons)
    }

    pub(crate) fn autopilot_guardrails() -> ToolAutopilotGuardrails {
        ToolAutopilotGuardrails {
            max_error_rate: clamp01(Self::env_f64(
                "TOOL_GEN_AUTOPILOT_MAX_ERROR_RATE",
                super::DEFAULT_TOOL_GEN_AUTOPILOT_MAX_ERROR_RATE,
            )),
            max_fallback_rate: clamp01(Self::env_f64(
                "TOOL_GEN_AUTOPILOT_MAX_FALLBACK_RATE",
                super::DEFAULT_TOOL_GEN_AUTOPILOT_MAX_FALLBACK_RATE,
            )),
            max_p95_ms: Self::env_f64(
                "TOOL_GEN_AUTOPILOT_MAX_P95_MS",
                super::DEFAULT_TOOL_GEN_AUTOPILOT_MAX_P95_MS,
            )
            .max(1.0),
            max_p99_p50_ratio: Self::env_f64(
                "TOOL_GEN_AUTOPILOT_MAX_P99_P50_RATIO",
                super::DEFAULT_TOOL_GEN_AUTOPILOT_MAX_P99_P50_RATIO,
            )
            .max(1.0),
            min_sample_count: Self::env_u64(
                "TOOL_GEN_AUTOPILOT_MIN_SAMPLE_COUNT",
                super::DEFAULT_TOOL_GEN_AUTOPILOT_MIN_SAMPLE_COUNT,
            )
            .max(1),
        }
    }

    pub(crate) fn evaluate_tool_autopilot(
        row: &PersistedToolPerformanceRow,
        guardrails: &ToolAutopilotGuardrails,
    ) -> (bool, Vec<String>) {
        let mut failures = Vec::new();
        let error_rate = clamp01(1.0 - row.success_rate);
        if row.latency_sample_count < guardrails.min_sample_count {
            failures.push(format!(
                "sample_count_below_min:{}<{}",
                row.latency_sample_count, guardrails.min_sample_count
            ));
        }
        if error_rate > guardrails.max_error_rate {
            failures.push(format!(
                "error_rate_exceeds:{:.4}>{:.4}",
                error_rate, guardrails.max_error_rate
            ));
        }
        if row.fallback_rate > guardrails.max_fallback_rate {
            failures.push(format!(
                "fallback_rate_exceeds:{:.4}>{:.4}",
                row.fallback_rate, guardrails.max_fallback_rate
            ));
        }
        if row.latency_p95_ms > guardrails.max_p95_ms {
            failures.push(format!(
                "p95_exceeds:{:.2}>{:.2}",
                row.latency_p95_ms, guardrails.max_p95_ms
            ));
        }
        let p99_p50_ratio = if row.latency_p50_ms > 0.0 {
            row.latency_p99_ms / row.latency_p50_ms.max(1e-6)
        } else {
            row.latency_p99_ms.max(0.0)
        };
        if p99_p50_ratio > guardrails.max_p99_p50_ratio {
            failures.push(format!(
                "p99_p50_ratio_exceeds:{:.3}>{:.3}",
                p99_p50_ratio, guardrails.max_p99_p50_ratio
            ));
        }
        (failures.is_empty(), failures)
    }
}

// ── Recommender ─────────────────────────────────────────────────────
impl EidolonMcpServer {
    pub(crate) fn normalize_recommender_model(raw: &str, fallback: &str) -> String {
        let normalized = raw.trim().to_ascii_lowercase();
        if normalized == "v1" || normalized == "v2" {
            normalized
        } else {
            fallback.to_string()
        }
    }

    pub(crate) fn configured_primary_recommender_model() -> String {
        std::env::var("COGNITIVE_RECOMMENDER_PRIMARY")
            .ok()
            .map(|value| {
                Self::normalize_recommender_model(&value, super::DEFAULT_RECOMMENDER_PRIMARY_MODEL)
            })
            .unwrap_or_else(|| super::DEFAULT_RECOMMENDER_PRIMARY_MODEL.to_string())
    }

    pub(crate) fn configured_shadow_recommender_model(primary_model: &str) -> String {
        if let Ok(explicit) = std::env::var("COGNITIVE_RECOMMENDER_SHADOW") {
            return Self::normalize_recommender_model(
                &explicit,
                super::DEFAULT_RECOMMENDER_SHADOW_MODEL,
            );
        }

        if primary_model == "v1" {
            "v2".to_string()
        } else {
            "v1".to_string()
        }
    }

    pub(crate) fn should_run_shadow_sample(task: &str, sample_percent: u64) -> bool {
        let bounded = sample_percent.clamp(0, 100);
        if bounded == 0 {
            return false;
        }
        if bounded == 100 {
            return true;
        }

        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        task.hash(&mut hasher);
        let now_bucket = chrono::Utc::now().timestamp_millis() / 10_000;
        now_bucket.hash(&mut hasher);
        let bucket = hasher.finish() % 100;
        bucket < bounded
    }

    pub(crate) fn intent_boost(task: &str, tool_name: &str) -> f64 {
        let lowered_task = task.to_lowercase();
        let lowered_tool = tool_name.to_lowercase();
        let mut boost = 0.0;
        if lowered_task.contains("compress") && lowered_tool.contains("compress") {
            boost += 0.1;
        }
        if lowered_task.contains("reason") && lowered_tool.contains("reason") {
            boost += 0.1;
        }
        if lowered_task.contains("memory")
            && (lowered_tool.contains("memory") || lowered_tool.contains("recall"))
        {
            boost += 0.1;
        }
        if lowered_task.contains("simulate") && lowered_tool.contains("simulate") {
            boost += 0.1;
        }
        boost
    }

    pub(crate) fn recommend_tools_v1_keyword(
        task: &str,
        available_tools: &[String],
    ) -> Vec<(String, f64)> {
        let lowered_task = task.to_lowercase();
        let mut ranked: Vec<(String, f64)> = available_tools
            .iter()
            .map(|tool_name| {
                let lowered_tool = tool_name.to_lowercase();
                let mut score = 0.2;

                if lowered_tool.contains("reason_chain") {
                    score += 0.08;
                }
                if lowered_tool.contains("memory") || lowered_tool.contains("recall") {
                    score += 0.05;
                }
                if lowered_tool.contains("tool_recommend") {
                    score -= 0.1;
                }

                let rules: [(&str, &[&str]); 8] = [
                    ("reason", &["reason_chain"]),
                    ("memory", &["memory_query", "recall_similar", "recall_user"]),
                    ("compress", &["compress_context"]),
                    ("simulate", &["simulate_response"]),
                    (
                        "update",
                        &["update_user", "commit_pattern", "record_outcome"],
                    ),
                    ("orchestrate", &["orchestrate"]),
                    ("dream", &["dream_conversation"]),
                    ("intent", &["sense_intent"]),
                ];

                for (keyword, candidates) in rules {
                    if lowered_task.contains(keyword)
                        && candidates.iter().any(|entry| lowered_tool.contains(entry))
                    {
                        score += 0.45;
                    }
                }

                score += Self::intent_boost(task, tool_name);
                (tool_name.clone(), clamp01(score.min(0.99)))
            })
            .collect();

        ranked.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.cmp(&b.0))
        });
        ranked
    }

    pub(crate) async fn recommender_shadow_penalties(&self) -> HashMap<String, (f64, f64)> {
        let db_path = (*self.telemetry_db_path).clone();
        let rows = tokio::task::spawn_blocking(move || {
            EidolonMcpServer::load_recommender_shadow_rows_sync(&db_path, 500)
        })
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();

        let mut aggregate: HashMap<String, (u64, u64, f64)> = HashMap::new();
        for row in rows {
            let entry = aggregate
                .entry(row.primary_top_tool)
                .or_insert((0u64, 0u64, 0.0f64));
            entry.0 += 1;
            if !row.top1_agreement {
                entry.1 += 1;
            }
            entry.2 += (row.shadow_top_score - row.primary_top_score).max(0.0);
        }

        aggregate
            .into_iter()
            .map(|(tool_name, (total, disagreements, regret_sum))| {
                let denom = total.max(1) as f64;
                let disagreement_rate = clamp01(disagreements as f64 / denom);
                let avg_regret = clamp01(regret_sum / denom);
                (tool_name, (disagreement_rate, avg_regret))
            })
            .collect()
    }

    pub(crate) async fn recommend_tools_v2_tracker(
        &self,
        task: &str,
        available_tools: &[String],
    ) -> Vec<(String, f64)> {
        let shadow_penalties = self.recommender_shadow_penalties().await;
        let metrics = self.tool_metrics.lock().await;
        let mut ranked: Vec<(String, f64)> = available_tools
            .iter()
            .map(|tool_name| {
                let historical = metrics.get(tool_name).map_or(0.0, |metric| {
                    if metric.calls == 0 {
                        return 0.25;
                    }

                    let calls = metric.calls.max(1) as f64;
                    let success_rate = 1.0 - (metric.errors as f64 / calls);
                    let fallback_rate = metric.fallback_count as f64 / calls;
                    let avg_latency_ms = average_latency_ms(metric);
                    let p50_latency_ms = metric.latency_p50_ms.max(0.0);
                    let p90_latency_ms = metric.latency_p90_ms.max(0.0);
                    let p95_latency_ms = metric.latency_p95_ms.max(0.0);
                    let p99_latency_ms = metric.latency_p99_ms.max(0.0);
                    let latency_component = (latency_score(avg_latency_ms) * 0.2
                        + latency_score(p50_latency_ms) * 0.2
                        + latency_score(p90_latency_ms) * 0.2
                        + latency_score(p95_latency_ms) * 0.2
                        + latency_score(p99_latency_ms) * 0.2)
                        .min(1.0);
                    let satisfaction = clamp01(metric.user_satisfaction);
                    let fallback_component = clamp01(1.0 - fallback_rate);
                    let tail_component = if p99_latency_ms > p50_latency_ms {
                        latency_score((p99_latency_ms - p50_latency_ms).max(1.0))
                    } else {
                        1.0
                    };
                    let correction_rate = clamp01(
                        (metric.errors as f64 + metric.fallback_count as f64 * 0.5) / calls,
                    );
                    let (disagreement_rate, avg_regret) = shadow_penalties
                        .get(tool_name)
                        .copied()
                        .unwrap_or((0.0, 0.0));

                    let base = clamp01(success_rate) * 0.32
                        + latency_component * 0.16
                        + fallback_component * 0.12
                        + satisfaction * 0.12
                        + clamp01(tail_component) * 0.10
                        + clamp01(1.0 - correction_rate) * 0.10
                        + clamp01(1.0 - disagreement_rate) * 0.08;
                    clamp01(base - avg_regret * 0.10)
                });

                let score = (historical + Self::intent_boost(task, tool_name)).min(0.99);
                (tool_name.clone(), score)
            })
            .collect();

        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked
    }

    pub(crate) async fn recommend_tools_with_model(
        &self,
        model: &str,
        task: &str,
        available_tools: &[String],
    ) -> Vec<(String, f64)> {
        if model == "v1" {
            Self::recommend_tools_v1_keyword(task, available_tools)
        } else {
            self.recommend_tools_v2_tracker(task, available_tools).await
        }
    }

    pub(crate) fn top3_overlap_ratio(primary: &[(String, f64)], shadow: &[(String, f64)]) -> f64 {
        let primary_top3: HashSet<&str> = primary
            .iter()
            .take(3)
            .map(|(tool, _)| tool.as_str())
            .collect();
        let shadow_top3: HashSet<&str> = shadow
            .iter()
            .take(3)
            .map(|(tool, _)| tool.as_str())
            .collect();

        if primary_top3.is_empty() && shadow_top3.is_empty() {
            return 1.0;
        }
        let overlap = primary_top3.intersection(&shadow_top3).count() as f64;
        let denom = primary_top3.union(&shadow_top3).count().max(1) as f64;
        clamp01(overlap / denom)
    }

    pub(crate) fn default_reasoning_latency_budget_ms() -> u64 {
        std::env::var("COGNITIVE_REASONING_LATENCY_BUDGET_MS")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .filter(|value| *value >= 200)
            .unwrap_or(1200)
    }
}
