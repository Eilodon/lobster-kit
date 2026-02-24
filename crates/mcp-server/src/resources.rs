// resources.rs — MCP resource endpoint handlers.
//
// Extracted from main.rs. Uses impl-block extension pattern:
// EidolonMcpServer methods live here, struct definition remains in main.rs.

use crate::helpers::*;
use crate::EidolonMcpServer;

impl EidolonMcpServer {
    pub(crate) fn list_resources_payload(&self) -> serde_json::Value {
        serde_json::json!({
            "resources": [
                {
                    "uri": "eidolon://bioreactor",
                    "name": "Bioreactor State",
                    "description": "Runtime metabolic state snapshot",
                    "mimeType": "application/json"
                },
                {
                    "uri": "eidolon://logs",
                    "name": "Thought Stream",
                    "description": "Recent in-memory cognitive events",
                    "mimeType": "application/json"
                },
                {
                    "uri": "eidolon://telemetry",
                    "name": "Tool Telemetry",
                    "description": "Tool call/error/latency counters",
                    "mimeType": "application/json"
                },
                {
                    "uri": "eidolon://generated-tool-audit",
                    "name": "Generated Tool Audit",
                    "description": "Generated tool acceptance/rejection audit",
                    "mimeType": "application/json"
                },
                {
                    "uri": "eidolon://recommender-shadow",
                    "name": "Recommender Shadow Audit",
                    "description": "A/B comparison logs for v1 vs v2 recommender",
                    "mimeType": "application/json"
                },
                {
                    "uri": "eidolon://contracts",
                    "name": "Runtime Contracts",
                    "description": "Runtime compatibility contract manifest",
                    "mimeType": "application/json"
                }
            ]
        })
    }

    pub(crate) async fn read_resource_payload(&self, uri: &str) -> Option<serde_json::Value> {
        let payload = match uri {
            "eidolon://bioreactor" => {
                let memory_count = {
                    let memories = self.memories.lock().await;
                    memories.len()
                };
                let user_count = {
                    let users = self.users.lock().await;
                    users.len()
                };

                let entropy = {
                    let mut thermo = self.thermo.lock().await;
                    let baseline = nalgebra::DVector::from_element(5, 0.5);
                    thermo.entropy(&baseline)
                };

                serde_json::json!({
                    "timestamp": chrono::Utc::now().timestamp_millis(),
                    "entropy": entropy,
                    "memory_entries": memory_count,
                    "known_users": user_count
                })
            }
            "eidolon://logs" => {
                let entries: Vec<serde_json::Value> = {
                    let memories = self.memories.lock().await;
                    memories
                        .iter()
                        .rev()
                        .take(50)
                        .map(|entry| {
                            serde_json::json!({
                                "timestamp": entry.timestamp,
                                "category": entry.category,
                                "content": entry.content
                            })
                        })
                        .collect()
                };

                serde_json::json!({
                    "timestamp": chrono::Utc::now().timestamp_millis(),
                    "count": entries.len(),
                    "entries": entries
                })
            }
            "eidolon://telemetry" => {
                let db_path = (*self.telemetry_db_path).clone();
                let persisted_rows = tokio::task::spawn_blocking(move || {
                    EidolonMcpServer::load_tool_performance_rows_sync(&db_path, 200)
                })
                .await
                .ok()
                .and_then(Result::ok);

                let rows: Vec<serde_json::Value> = if let Some(rows) = persisted_rows {
                    rows.into_iter()
                        .map(|row| {
                            serde_json::json!({
                                "tool": row.tool_name,
                                "calls": row.call_count,
                                "errors": row.error_count,
                                "error_rate": clamp01(1.0 - row.success_rate),
                                "avg_latency_ms": row.avg_latency_ms,
                                "avg_latency_us": row.avg_latency_us,
                                "latency_p50_ms": row.latency_p50_ms,
                                "latency_p90_ms": row.latency_p90_ms,
                                "latency_p95_ms": row.latency_p95_ms,
                                "latency_p99_ms": row.latency_p99_ms,
                                "fallback_rate": row.fallback_rate,
                                "latency_sample_count": row.latency_sample_count,
                                "last_called": row.last_called
                            })
                        })
                        .collect()
                } else {
                    let metrics = self.tool_metrics.lock().await;
                    let mut fallback_rows: Vec<serde_json::Value> = metrics
                        .iter()
                        .map(|(tool, metric)| {
                            let calls = metric.calls.max(1);
                            let avg_latency_ms = average_latency_ms(metric);
                            let error_rate = metric.errors as f64 / calls as f64;
                            let fallback_rate = metric.fallback_count as f64 / calls as f64;

                            serde_json::json!({
                                "tool": tool,
                                "calls": metric.calls,
                                "errors": metric.errors,
                                "error_rate": clamp01(error_rate),
                                "avg_latency_ms": avg_latency_ms,
                                "avg_latency_us": avg_latency_ms * 1000.0,
                                "latency_p50_ms": metric.latency_p50_ms,
                                "latency_p90_ms": metric.latency_p90_ms,
                                "latency_p95_ms": metric.latency_p95_ms,
                                "latency_p99_ms": metric.latency_p99_ms,
                                "fallback_rate": clamp01(fallback_rate),
                                "latency_sample_count": metric.latency_sample_count,
                                "last_called": metric.last_called
                            })
                        })
                        .collect();

                    fallback_rows.sort_by(|a, b| {
                        let a_last = a.get("last_called").and_then(|v| v.as_i64()).unwrap_or(0);
                        let b_last = b.get("last_called").and_then(|v| v.as_i64()).unwrap_or(0);
                        b_last.cmp(&a_last)
                    });
                    fallback_rows
                };

                serde_json::json!({
                    "timestamp": chrono::Utc::now().timestamp_millis(),
                    "tool_count": rows.len(),
                    "tools": rows
                })
            }
            "eidolon://generated-tool-audit" => {
                let db_path = (*self.telemetry_db_path).clone();
                let records = tokio::task::spawn_blocking(move || {
                    EidolonMcpServer::load_generated_tool_audit_rows_sync(&db_path, 200)
                })
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or_default();

                serde_json::json!({
                    "timestamp": chrono::Utc::now().timestamp_millis(),
                    "source": "mcp-rust",
                    "records": records.into_iter().map(|row| {
                        serde_json::json!({
                            "tool_name": row.tool_name,
                            "need": row.need,
                            "status": row.status,
                            "reason": row.reason,
                            "metadata": row.metadata,
                            "created_at": row.created_at
                        })
                    }).collect::<Vec<serde_json::Value>>()
                })
            }
            "eidolon://recommender-shadow" => {
                let db_path = (*self.telemetry_db_path).clone();
                let rows = tokio::task::spawn_blocking(move || {
                    EidolonMcpServer::load_recommender_shadow_rows_sync(&db_path, 200)
                })
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or_default();

                let total = rows.len();
                let agreements = rows.iter().filter(|row| row.top1_agreement).count();
                let disagreement_rate = if total > 0 {
                    1.0 - (agreements as f64 / total as f64)
                } else {
                    0.0
                };

                serde_json::json!({
                    "timestamp": chrono::Utc::now().timestamp_millis(),
                    "source": "mcp-rust",
                    "total": total,
                    "top1_agreement_rate": if total > 0 { agreements as f64 / total as f64 } else { 0.0 },
                    "top1_disagreement_rate": disagreement_rate,
                    "records": rows.into_iter().map(|row| {
                        serde_json::json!({
                            "task": row.task,
                            "available_tools": row.available_tools,
                            "primary_model": row.primary_model,
                            "primary_top_tool": row.primary_top_tool,
                            "primary_top_score": row.primary_top_score,
                            "shadow_model": row.shadow_model,
                            "shadow_top_tool": row.shadow_top_tool,
                            "shadow_top_score": row.shadow_top_score,
                            "top1_agreement": row.top1_agreement,
                            "top3_overlap_ratio": row.top3_overlap_ratio,
                            "metadata": row.metadata,
                            "created_at": row.created_at
                        })
                    }).collect::<Vec<serde_json::Value>>()
                })
            }
            "eidolon://contracts" => serde_json::json!({
                "runtime": {
                    "name": "clawkit-v4",
                    "language": "rust",
                    "version": "4.0.0"
                },
                "interfaces": {
                    "mcp_protocol_version": "2024-11-05",
                    "tools": true,
                    "resources": true
                },
                "artifacts": {
                    "phase_gates": "docs/runtime-migration/slo/phase-gates.v1.json",
                    "contracts": "docs/runtime-migration/contracts/runtime-v1/"
                }
            }),
            _ => return None,
        };

        let text = serde_json::to_string_pretty(&payload).ok()?;
        Some(serde_json::json!({
            "contents": [
                {
                    "uri": uri,
                    "mimeType": "application/json",
                    "text": text
                }
            ]
        }))
    }
}
