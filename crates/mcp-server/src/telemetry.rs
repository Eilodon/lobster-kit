// telemetry.rs — Tool metric recording and telemetry persistence.
//
// Extracted from main.rs. Uses impl-block extension pattern:
// EidolonMcpServer methods live here, struct definition remains in main.rs.

use crate::helpers::*;
use crate::types::*;
use crate::EidolonMcpServer;
use std::path::PathBuf;

impl EidolonMcpServer {
    pub(crate) fn telemetry_db_path() -> PathBuf {
        if let Ok(explicit) = std::env::var("EIDOLON_DB_PATH") {
            return PathBuf::from(explicit);
        }

        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(super::DEFAULT_TELEMETRY_DB_RELATIVE_PATH)
    }

    pub(crate) async fn record_tool_metric(
        &self,
        tenant_id: &str,
        tool_name: &str,
        failed: bool,
        latency_us: u64,
        fallback_used: bool,
    ) {
        if tool_name.is_empty() {
            return;
        }

        let snapshot = {
            let mut metrics = self.tool_metrics.write().await;
            // For in-memory stats, combine tenant and tool name so they are distinct
            let metric_key = format!("{}:{}", tenant_id, tool_name);
            let entry = metrics
                .entry(metric_key)
                .or_insert_with(ToolTelemetry::default);
            entry.calls = entry.calls.saturating_add(1);
            if failed {
                entry.errors = entry.errors.saturating_add(1);
            }
            if fallback_used {
                entry.fallback_count = entry.fallback_count.saturating_add(1);
            }
            entry.total_latency_us = entry.total_latency_us.saturating_add(latency_us);
            entry.total_latency_ms = entry
                .total_latency_ms
                .saturating_add((latency_us as f64 / 1000.0).round() as u64);
            entry.last_called = chrono::Utc::now().timestamp_millis();
            entry.latency_samples.push_back(latency_us);
            if entry.latency_samples.len() > MAX_LATENCY_SAMPLES {
                let _ = entry.latency_samples.pop_front();
            }

            let mut sorted_samples: Vec<u64> = entry.latency_samples.iter().copied().collect();
            sorted_samples.sort_unstable();
            entry.latency_p50_ms = percentile(&sorted_samples, 0.5) / 1000.0;
            entry.latency_p90_ms = percentile(&sorted_samples, 0.9) / 1000.0;
            entry.latency_p95_ms = percentile(&sorted_samples, 0.95) / 1000.0;
            entry.latency_p99_ms = percentile(&sorted_samples, 0.99) / 1000.0;
            entry.latency_sample_count = entry.latency_samples.len() as u64;

            let calls = entry.calls.max(1);
            let avg_latency_us = entry.total_latency_us as f64 / calls as f64;
            let avg_latency_ms = avg_latency_us / 1000.0;
            let success_rate = 1.0 - (entry.errors as f64 / calls as f64);
            let fallback_rate = entry.fallback_count as f64 / calls as f64;

            PersistedToolPerformanceRow {
                tenant_id: tenant_id.to_string(),
                tool_name: tool_name.to_string(),
                call_count: entry.calls,
                error_count: entry.errors,
                fallback_count: entry.fallback_count,
                success_rate: clamp01(success_rate),
                avg_latency_ms,
                avg_latency_us,
                latency_p50_ms: entry.latency_p50_ms,
                latency_p90_ms: entry.latency_p90_ms,
                latency_p95_ms: entry.latency_p95_ms,
                latency_p99_ms: entry.latency_p99_ms,
                fallback_rate: clamp01(fallback_rate),
                user_satisfaction: clamp01(entry.user_satisfaction),
                latency_sample_count: entry.latency_sample_count,
                last_called: entry.last_called,
            }
        };

        let db_path = (*self.telemetry_db_path).clone();
        let _ = tokio::task::spawn_blocking(move || {
            EidolonMcpServer::persist_tool_performance_sync(&db_path, &snapshot)
        })
        .await;
    }

    pub(crate) async fn record_generated_tool_audit(
        &self,
        tenant_id: &str,
        tool_name: &str,
        need: &str,
        status: &str,
        reason: &str,
        metadata: serde_json::Value,
    ) {
        let now = chrono::Utc::now().timestamp_millis();
        let runtime_profile = Self::normalized_runtime_profile();
        let decision_actor = std::env::var("TOOL_GEN_AUDIT_ACTOR")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| super::DEFAULT_TOOL_GEN_AUDIT_ACTOR.to_string());

        let mut metadata_obj = match metadata {
            serde_json::Value::Object(obj) => obj,
            other => {
                let mut wrapped = serde_json::Map::new();
                wrapped.insert("raw_metadata".to_string(), other);
                wrapped
            }
        };
        metadata_obj.insert(
            "audit_schema".to_string(),
            serde_json::Value::String("generated_tool_audit.v1".to_string()),
        );
        metadata_obj.insert(
            "decision_actor".to_string(),
            serde_json::Value::String(decision_actor),
        );
        metadata_obj.insert(
            "decision_source".to_string(),
            serde_json::Value::String("mcp-rust".to_string()),
        );
        metadata_obj.insert(
            "runtime_profile".to_string(),
            serde_json::Value::String(runtime_profile),
        );
        metadata_obj.insert("immutable".to_string(), serde_json::Value::Bool(true));
        let metadata_json = serde_json::to_string(&serde_json::Value::Object(metadata_obj))
            .unwrap_or_else(|_| "{}".to_string());
        let row = GeneratedToolAuditRow {
            tenant_id: tenant_id.to_string(),
            tool_name: if tool_name.is_empty() {
                "unknown_tool".to_string()
            } else {
                tool_name.to_string()
            },
            need: if need.is_empty() {
                "tool_call".to_string()
            } else {
                need.to_string()
            },
            status: if status.is_empty() {
                "unknown".to_string()
            } else {
                status.to_string()
            },
            reason: if reason.is_empty() {
                "unspecified".to_string()
            } else {
                reason.to_string()
            },
            metadata: metadata_json,
            created_at: now,
        };

        let db_path = (*self.telemetry_db_path).clone();
        let _ = tokio::task::spawn_blocking(move || {
            EidolonMcpServer::persist_generated_tool_audit_sync(&db_path, &row)
        })
        .await;
    }

    pub(crate) async fn record_recommender_shadow_audit(&self, row: RecommenderShadowAuditRow) {
        let db_path = (*self.telemetry_db_path).clone();
        let _ = tokio::task::spawn_blocking(move || {
            EidolonMcpServer::persist_recommender_shadow_audit_sync(&db_path, &row)
        })
        .await;
    }
}
