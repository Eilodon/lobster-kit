use crate::helpers::*;
use crate::types::*;
use crate::EidolonMcpServer;
use std::collections::HashMap;

impl EidolonMcpServer {
    pub(crate) async fn handle_orchestrate(&self, params: serde_json::Value) -> serde_json::Value {
        // P2: role-specialized multi-agent orchestration with arbitration policy.
        let agents = params["agent_count"].as_u64().unwrap_or(3).clamp(1, 100) as usize;
        let task = params["task"].as_str().unwrap_or("general_orchestration");
        let confidence = params["confidence"].as_f64().map(clamp01).unwrap_or(0.7);
        let latency_budget_ms = params["latency_budget_ms"]
            .as_u64()
            .unwrap_or_else(Self::default_reasoning_latency_budget_ms)
            .max(200);
        let (mut reasoning_mode, mut fallback_used, mut policy_reason) = self
            .select_reasoning_mode("auto", task, "", latency_budget_ms)
            .await;
        if confidence < 0.55 && reasoning_mode == "fast" && latency_budget_ms >= 900 {
            reasoning_mode = "deep".to_string();
            fallback_used = false;
            policy_reason = "confidence_low_promote_deep".to_string();
        } else if confidence >= 0.85 && reasoning_mode == "deep" {
            reasoning_mode = "fast".to_string();
            fallback_used = true;
            policy_reason = "confidence_high_downgrade_fast".to_string();
        }

        let task_lower = task.to_ascii_lowercase();
        let risk_intensity = lexical_intent_risk_score(task);
        let retrieval_need = if ["retrieve", "memory", "evidence", "context"]
            .iter()
            .any(|cue| task_lower.contains(cue))
        {
            1.0
        } else {
            0.35
        };
        let planning_need = if ["plan", "execute", "strategy", "response"]
            .iter()
            .any(|cue| task_lower.contains(cue))
        {
            1.0
        } else {
            0.45
        };
        let verification_need = if ["critical", "incident", "unsafe", "risk", "security"]
            .iter()
            .any(|cue| task_lower.contains(cue))
        {
            1.0
        } else {
            0.5
        };
        let uncertainty = clamp01((1.0 - confidence) * 0.7 + risk_intensity * 0.3);

        let mut role_plan: Vec<String> = Vec::new();
        let core_roles = vec![
            "planner".to_string(),
            "retriever".to_string(),
            "critic".to_string(),
            "verifier".to_string(),
        ];
        for role in core_roles.into_iter().take(agents) {
            role_plan.push(role);
        }
        while role_plan.len() < agents {
            let idx = role_plan.len();
            let role = if idx % 3 == 0 {
                "risk-analyst"
            } else if idx % 3 == 1 {
                "ops-executor"
            } else {
                "memory-operator"
            };
            role_plan.push(role.to_string());
        }

        let mut handles = vec![];
        for (i, role) in role_plan.iter().enumerate() {
            let role_name = role.clone();
            let role_task = task.to_string();
            let role_mode = reasoning_mode.clone();
            let role_confidence = confidence;
            let role_uncertainty = uncertainty;
            let role_retrieval_need = retrieval_need;
            let role_planning_need = planning_need;
            let role_verification_need = verification_need;
            let handle = tokio::spawn(async move {
                let mut state = nalgebra::DVector::from_element(5, (i as f32 + 1.0) / 100.0);
                let target = nalgebra::DVector::from_element(5, 0.5);
                let mut thermo = core_rust::sentinel::thermo::ThermodynamicEngine::new(
                    core_rust::sentinel::thermo::ThermoConfig::default(),
                );
                thermo.step(&mut state, &target);
                let entropy = thermo.entropy(&state) as f64;

                let role_focus = match role_name.as_str() {
                    "planner" => role_planning_need,
                    "retriever" | "memory-operator" => role_retrieval_need,
                    "critic" | "verifier" | "risk-analyst" => role_verification_need,
                    _ => 0.55,
                };
                let depth_bonus = if role_mode == "deep" { 0.12 } else { 0.03 };
                let role_score = clamp01(
                    role_focus * 0.45
                        + (1.0 - role_uncertainty) * 0.25
                        + role_confidence * 0.2
                        + depth_bonus
                        + (1.0 - entropy).clamp(0.0, 1.0) * 0.1,
                );
                let role_uncertainty_adjusted =
                    clamp01((role_uncertainty + entropy * 0.2).min(1.0));
                let recommendation = if role_name == "critic" || role_name == "verifier" {
                    if role_uncertainty_adjusted > 0.62 {
                        "revise"
                    } else {
                        "proceed"
                    }
                } else if role_name == "risk-analyst" && role_uncertainty_adjusted > 0.7 {
                    "halt"
                } else if role_task.to_ascii_lowercase().contains("incident")
                    && role_uncertainty_adjusted > 0.6
                {
                    "revise"
                } else {
                    "proceed"
                };

                serde_json::json!({
                    "role": role_name,
                    "score": role_score,
                    "uncertainty": role_uncertainty_adjusted,
                    "recommendation": recommendation,
                    "entropy": entropy
                })
            });
            handles.push(handle);
        }

        let results = futures::future::join_all(handles).await;

        let mut valid_results: Vec<serde_json::Value> = vec![];
        let mut sum_entropy = 0.0f64;
        for res in results {
            if let Ok(value) = res {
                sum_entropy += value.get("entropy").and_then(|v| v.as_f64()).unwrap_or(0.0);
                valid_results.push(value);
            }
        }

        let consensus = if valid_results.is_empty() {
            0.0f64
        } else {
            (sum_entropy / valid_results.len() as f64) as f64
        };

        let mut vote_scores: HashMap<String, f64> = HashMap::from([
            ("proceed".to_string(), 0.0),
            ("revise".to_string(), 0.0),
            ("halt".to_string(), 0.0),
        ]);
        let mut budget_weights: HashMap<String, f64> = HashMap::new();
        for item in &valid_results {
            let role = item.get("role").and_then(|v| v.as_str()).unwrap_or("agent");
            let score = item.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let recommendation = item
                .get("recommendation")
                .and_then(|v| v.as_str())
                .unwrap_or("proceed");
            let adjusted_weight = score
                * match role {
                    "verifier" | "critic" => 1.2,
                    "planner" | "retriever" => 1.0,
                    _ => 0.9,
                };
            *vote_scores.entry(recommendation.to_string()).or_insert(0.0) += adjusted_weight;
            budget_weights.insert(role.to_string(), adjusted_weight.max(0.05));
        }

        let arbitration_decision = vote_scores
            .iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, _)| k.clone())
            .unwrap_or_else(|| "proceed".to_string());
        let vote_sum: f64 = vote_scores.values().sum::<f64>().max(1e-6);
        let arbitration_confidence = clamp01(
            vote_scores
                .get(&arbitration_decision)
                .copied()
                .unwrap_or(0.0)
                / vote_sum,
        );

        let total_weight: f64 = budget_weights.values().sum::<f64>().max(1e-6);
        let budget_allocation: Vec<serde_json::Value> = budget_weights
            .iter()
            .map(|(role, weight)| {
                let share = clamp01(*weight / total_weight);
                serde_json::json!({
                    "role": role,
                    "budget_ms": ((latency_budget_ms as f64) * share).round() as u64,
                    "share": share
                })
            })
            .collect();

        serde_json::json!({
            "status": "consensus_reached",
            "agents_spawned": agents,
            "agents_responded": valid_results.len(),
            "consensus_entropy": consensus,
            "strategy": if consensus < 0.5 { "Convergent" } else { "Divergent" },
            "role_specialization": {
                "roles": role_plan,
                "agent_outputs": valid_results
            },
            "arbitration": {
                "decision": arbitration_decision,
                "confidence": arbitration_confidence,
                "vote_scores": vote_scores
            },
            "budget_allocation": {
                "latency_budget_ms": latency_budget_ms,
                "allocations": budget_allocation,
                "uncertainty": uncertainty
            },
            "reasoning_mode_policy": {
                "mode_selected": reasoning_mode,
                "requested_mode": "auto",
                "confidence": confidence,
                "latency_budget_ms": latency_budget_ms,
                "fallback_used": fallback_used,
                "decision_reason": policy_reason
            }
        })
    }

    pub(crate) async fn handle_tool_recommend(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let task = params["task"].as_str().unwrap_or("").to_string();
        let available_tools: Vec<String> = params["available_tools"]
            .as_array()
            .map(|raw_tools| {
                raw_tools
                    .iter()
                    .filter_map(|value| value.as_str().map(|item| item.to_string()))
                    .collect::<Vec<String>>()
            })
            .filter(|tools| !tools.is_empty())
            .unwrap_or_else(|| {
                super::DEFAULT_COGNITIVE_TOOL_CATALOG
                    .iter()
                    .map(|tool| (*tool).to_string())
                    .collect::<Vec<String>>()
            });

        let primary_model = params["recommender_model"]
            .as_str()
            .map(|value| {
                Self::normalize_recommender_model(value, super::DEFAULT_RECOMMENDER_PRIMARY_MODEL)
            })
            .unwrap_or_else(Self::configured_primary_recommender_model);
        let shadow_model = if primary_model == "v1" {
            "v2".to_string()
        } else {
            Self::configured_shadow_recommender_model(&primary_model)
        };
        let shadow_mode_requested = params
            .get("shadow_mode")
            .and_then(|value| value.as_bool())
            .unwrap_or_else(|| Self::env_flag("COGNITIVE_SHADOW_MODE_ENABLED", true));
        let shadow_sample_percent = Self::env_percent(
            "COGNITIVE_SHADOW_SAMPLE_PERCENT",
            super::DEFAULT_SHADOW_SAMPLE_PERCENT,
        );
        let shadow_executed = shadow_mode_requested
            && primary_model != shadow_model
            && Self::should_run_shadow_sample(&task, shadow_sample_percent);

        let mut ranked = self
            .recommend_tools_with_model(&primary_model, &task, &available_tools)
            .await;
        if ranked.is_empty() {
            ranked.push(("eidolon_reason_chain".to_string(), 0.5));
            ranked.push(("eidolon_recall_similar".to_string(), 0.5));
        }

        let mut shadow_top1_agreement = None;
        let mut shadow_top3_overlap = None;
        let mut shadow_top_tool: Option<String> = None;
        let mut shadow_regret_estimate = None;
        if shadow_executed {
            let mut shadow_ranked = self
                .recommend_tools_with_model(&shadow_model, &task, &available_tools)
                .await;
            if shadow_ranked.is_empty() {
                shadow_ranked.push(("eidolon_reason_chain".to_string(), 0.5));
                shadow_ranked.push(("eidolon_recall_similar".to_string(), 0.5));
            }

            let primary_top = ranked
                .first()
                .cloned()
                .unwrap_or_else(|| ("".to_string(), 0.0));
            let shadow_top = shadow_ranked
                .first()
                .cloned()
                .unwrap_or_else(|| ("".to_string(), 0.0));
            let top1_agreement = !primary_top.0.is_empty() && primary_top.0 == shadow_top.0;
            let top3_overlap_ratio = Self::top3_overlap_ratio(&ranked, &shadow_ranked);
            let regret_estimate = (shadow_top.1 - primary_top.1).max(0.0);

            shadow_top1_agreement = Some(top1_agreement);
            shadow_top3_overlap = Some(top3_overlap_ratio);
            shadow_top_tool = Some(shadow_top.0.clone());
            shadow_regret_estimate = Some(regret_estimate);

            let available_tools_json =
                serde_json::to_string(&available_tools).unwrap_or_else(|_| "[]".to_string());
            let metadata = serde_json::json!({
                "shadow_sample_percent": shadow_sample_percent,
                "available_tools_count": available_tools.len(),
                "online_regret_estimate": regret_estimate,
                "top1_agreement": top1_agreement,
                "top3_overlap_ratio": top3_overlap_ratio
            });
            let metadata_json =
                serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string());

            self.record_recommender_shadow_audit(RecommenderShadowAuditRow {
                task: task.clone(),
                available_tools: available_tools_json,
                primary_model: primary_model.clone(),
                primary_top_tool: primary_top.0,
                primary_top_score: primary_top.1,
                shadow_model: shadow_model.clone(),
                shadow_top_tool: shadow_top.0,
                shadow_top_score: shadow_top.1,
                top1_agreement,
                top3_overlap_ratio,
                metadata: metadata_json,
                created_at: chrono::Utc::now().timestamp_millis(),
            })
            .await;
        }

        let results: Vec<serde_json::Value> = ranked
            .iter()
            .take(3)
            .map(|(tool, score)| {
                serde_json::json!({
                    "tool": tool,
                    "relevance_score": score.min(0.99)
                })
            })
            .collect();

        let primary_tool_correction_rate = {
            let top_tool = ranked.first().map(|entry| entry.0.as_str()).unwrap_or("");
            let metrics = self.tool_metrics.write().await;
            metrics.get(top_tool).map_or(0.0, |metric| {
                let calls = metric.calls.max(1) as f64;
                clamp01((metric.errors as f64 + metric.fallback_count as f64 * 0.5) / calls)
            })
        };

        serde_json::json!({
            "task": task,
            "available_tools": available_tools,
            "recommended_tools": results,
            "recommender": {
                "primary_model": primary_model,
                "shadow_mode_requested": shadow_mode_requested,
                "shadow_executed": shadow_executed,
                "shadow_model": if shadow_executed { serde_json::Value::String(shadow_model) } else { serde_json::Value::Null },
                "shadow_sample_percent": shadow_sample_percent,
                "shadow_top1_agreement": shadow_top1_agreement,
                "shadow_top3_overlap_ratio": shadow_top3_overlap,
                "shadow_top_tool": shadow_top_tool,
                "shadow_regret_estimate": shadow_regret_estimate,
                "primary_tool_correction_rate": primary_tool_correction_rate
            }
        })
    }

    pub(crate) async fn handle_generated_tool_decision(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let tenant_id = crate::helpers::extract_tenant_id(&params);
        let tool_name = params["tool_name"]
            .as_str()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        if tool_name.is_empty() {
            return serde_json::json!({
                "error": "tool_name_required"
            });
        }

        let action = params["action"]
            .as_str()
            .unwrap_or("reject")
            .trim()
            .to_ascii_lowercase();
        let need = params["need"]
            .as_str()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "tool_generator_review".to_string());
        let requested_reason = params["reason"]
            .as_str()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "manual_review".to_string());

        let (tool_gen_enabled, runtime_profile, allowed_profiles) =
            Self::is_tool_gen_enabled_in_runtime();
        if !tool_gen_enabled {
            self.record_generated_tool_audit(
                &tenant_id,
                &tool_name,
                &need,
                "rejected",
                "tool_gen_disabled_in_env",
                serde_json::json!({
                    "action": action,
                    "runtime_profile": runtime_profile,
                    "allowed_profiles": allowed_profiles,
                    "requested_reason": requested_reason
                }),
            )
            .await;

            return serde_json::json!({
                "tool_name": tool_name,
                "action": action,
                "approved": false,
                "status": "rejected",
                "reason": "tool_gen_disabled_in_env",
                "runtime_profile": runtime_profile,
                "allowed_profiles": allowed_profiles
            });
        }

        let max_dynamic_tools = Self::env_u64("TOOL_GEN_MAX_DYNAMIC_TOOLS", 32).max(1);
        let db_path = (*self.telemetry_db_path).clone();
        let active_tool_count = tokio::task::spawn_blocking(move || {
            EidolonMcpServer::load_tool_generator_active_count_sync(&db_path)
        })
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(0);

        if (action == "accept" || action == "promote") && active_tool_count >= max_dynamic_tools {
            let reason = "tool_gen_capacity_exceeded";
            self.record_generated_tool_audit(
                &tenant_id,
                &tool_name,
                &need,
                "rejected",
                reason,
                serde_json::json!({
                    "action": action,
                    "active_tool_count": active_tool_count,
                    "max_dynamic_tools": max_dynamic_tools,
                    "runtime_profile": runtime_profile
                }),
            )
            .await;

            return serde_json::json!({
                "tool_name": tool_name,
                "action": action,
                "approved": false,
                "status": "rejected",
                "reason": reason,
                "active_tool_count": active_tool_count,
                "max_dynamic_tools": max_dynamic_tools
            });
        }

        let (status, decision_reason, approved, threshold_details) = match action.as_str() {
            "accept" => (
                "accepted".to_string(),
                requested_reason.to_string(),
                true,
                serde_json::json!({}),
            ),
            "reject" => (
                "rejected".to_string(),
                requested_reason.to_string(),
                false,
                serde_json::json!({}),
            ),
            "promote" => {
                let db_path = (*self.telemetry_db_path).clone();
                let lookup_tool_name = tool_name.clone();
                let perf_row = tokio::task::spawn_blocking(move || {
                    EidolonMcpServer::load_tool_performance_row_sync(&db_path, &lookup_tool_name)
                })
                .await
                .ok()
                .and_then(Result::ok)
                .flatten();

                if let Some(row) = perf_row {
                    let thresholds = Self::promotion_thresholds();
                    let (eligible, promotion_failures) =
                        Self::evaluate_tool_promotion(&row, &thresholds);
                    let autopilot_enabled = Self::env_flag("TOOL_GEN_AUTOPILOT_ENABLED", true);
                    let guardrails = Self::autopilot_guardrails();
                    let (autopilot_pass, autopilot_failures) = if autopilot_enabled {
                        Self::evaluate_tool_autopilot(&row, &guardrails)
                    } else {
                        (true, Vec::new())
                    };
                    let mut threshold_details = serde_json::json!({
                        "thresholds": {
                            "min_calls": thresholds.min_calls,
                            "max_error_rate": thresholds.max_error_rate,
                            "max_p95_ms": thresholds.max_p95_ms,
                            "max_fallback_rate": thresholds.max_fallback_rate,
                            "min_satisfaction": thresholds.min_satisfaction
                        },
                        "metrics": {
                            "call_count": row.call_count,
                            "error_rate": clamp01(1.0 - row.success_rate),
                            "latency_p95_ms": row.latency_p95_ms,
                            "latency_p50_ms": row.latency_p50_ms,
                            "latency_p99_ms": row.latency_p99_ms,
                            "fallback_rate": row.fallback_rate,
                            "user_satisfaction": row.user_satisfaction,
                            "latency_sample_count": row.latency_sample_count
                        },
                        "eligibility_failures": promotion_failures,
                        "autopilot": {
                            "enabled": autopilot_enabled,
                            "guardrails": {
                                "max_error_rate": guardrails.max_error_rate,
                                "max_fallback_rate": guardrails.max_fallback_rate,
                                "max_p95_ms": guardrails.max_p95_ms,
                                "max_p99_p50_ratio": guardrails.max_p99_p50_ratio,
                                "min_sample_count": guardrails.min_sample_count
                            },
                            "quarantine_failures": autopilot_failures
                        }
                    });
                    if eligible {
                        if autopilot_pass {
                            (
                                "promoted".to_string(),
                                "promotion_threshold_passed".to_string(),
                                true,
                                threshold_details,
                            )
                        } else {
                            if let Some(obj) = threshold_details.as_object_mut() {
                                obj.insert(
                                    "canary_hook".to_string(),
                                    serde_json::json!({
                                        "action": "rollback_canary",
                                        "reason": "autopilot_quarantine_triggered"
                                    }),
                                );
                            }
                            (
                                "quarantined".to_string(),
                                "autopilot_quarantine_triggered".to_string(),
                                false,
                                threshold_details,
                            )
                        }
                    } else {
                        (
                            "rejected".to_string(),
                            "promotion_threshold_failed".to_string(),
                            false,
                            threshold_details,
                        )
                    }
                } else {
                    (
                        "rejected".to_string(),
                        "promotion_telemetry_missing".to_string(),
                        false,
                        serde_json::json!({
                            "eligibility_failures": ["telemetry_missing"]
                        }),
                    )
                }
            }
            _ => (
                "rejected".to_string(),
                "invalid_action".to_string(),
                false,
                serde_json::json!({}),
            ),
        };

        self.record_generated_tool_audit(
            &tenant_id,
            &tool_name,
            &need,
            &status,
            &decision_reason,
            serde_json::json!({
                "action": action,
                "requested_reason": requested_reason,
                "approved": approved,
                "runtime_profile": runtime_profile,
                "allowed_profiles": allowed_profiles,
                "active_tool_count": active_tool_count,
                "max_dynamic_tools": max_dynamic_tools,
                "promotion_checks": threshold_details
            }),
        )
        .await;

        serde_json::json!({
            "tool_name": tool_name,
            "action": action,
            "approved": approved,
            "status": status,
            "reason": decision_reason,
            "runtime_profile": runtime_profile,
            "allowed_profiles": allowed_profiles,
            "active_tool_count": active_tool_count,
            "max_dynamic_tools": max_dynamic_tools,
            "promotion_checks": threshold_details
        })
    }

    pub(crate) async fn handle_oracle_sense(&self, params: serde_json::Value) -> serde_json::Value {
        let query = params["query"].as_str().unwrap_or("market overview");
        let insight = self.tensor_oracle_insight(query, false).await;
        serde_json::json!({
            "compatibility_mode": "legacy_emulation",
            "tool": "eidolon_oracle_sense",
            "inference_backend": "tensor_oracle_candle",
            "insight": insight
        })
    }

    pub(crate) async fn handle_defi_quote(&self, params: serde_json::Value) -> serde_json::Value {
        let token_in = params["token_in"].as_str().unwrap_or("UNKNOWN");
        let token_out = params["token_out"].as_str().unwrap_or("UNKNOWN");
        serde_json::json!({
            "compatibility_mode": "legacy_emulation",
            "tool": "eidolon_defi_quote",
            "token_in": token_in,
            "token_out": token_out,
            "amount": params.get("amount").cloned().unwrap_or(serde_json::json!(0)),
            "quote": {
                "status": "unavailable",
                "reason": "defi_router_not_integrated_in_mcp_rust"
            }
        })
    }

    pub(crate) async fn handle_security_scan(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let contract = params["contract"].as_str().unwrap_or("unknown");
        serde_json::json!({
            "compatibility_mode": "legacy_emulation",
            "tool": "eidolon_security_scan",
            "contract": contract,
            "risk_level": "unknown",
            "warnings": ["security_engine_not_integrated_in_mcp_rust"]
        })
    }

    pub(crate) async fn handle_get_portfolio(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let owner = params["owner"].as_str().unwrap_or("unknown");
        serde_json::json!({
            "compatibility_mode": "legacy_emulation",
            "tool": "eidolon_get_portfolio",
            "owner": owner,
            "positions": [],
            "total_value_usd": serde_json::Value::Null
        })
    }

    pub(crate) async fn handle_execute_swap(&self, params: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "compatibility_mode": "legacy_emulation",
            "tool": "eidolon_execute_swap",
            "executed": false,
            "status": "dry_run_only",
            "reason": "swap_executor_not_integrated_in_mcp_rust",
            "request": params
        })
    }

    pub(crate) async fn handle_panic_button(&self, params: serde_json::Value) -> serde_json::Value {
        let wallet = params["wallet"].as_str().unwrap_or("unknown");
        serde_json::json!({
            "compatibility_mode": "legacy_emulation",
            "tool": "eidolon_panic_button",
            "wallet": wallet,
            "status": "simulated",
            "actions": ["revoke_approvals", "pause_automation", "raise_alert"]
        })
    }

    pub(crate) async fn handle_oracle_query(&self, params: serde_json::Value) -> serde_json::Value {
        let query = params["query"].as_str().unwrap_or("analyze");
        let insight = self.tensor_oracle_insight(query, false).await;
        serde_json::json!({
            "inference_backend": "tensor_oracle_candle",
            "insight": insight
        })
    }

    async fn tensor_oracle_insight(&self, query: &str, is_action: bool) -> String {
        // Phase 3: Build routing context snapshot — trauma read, then drop lock.
        let base_entropy: f32 = if is_action { 0.2 } else { 0.8 };
        let routing_ctx = self
            .build_routing_context(
                base_entropy,
                core_rust::sentinel::modes::SentinelMode::Zen,
                "oracle_query",
                2000, // oracle queries get a generous latency budget
                false,
                is_action,
                "default",
            )
            .await;

        match self.routed_generate(&routing_ctx, query).await {
            Ok(text) => text,
            Err(err) => {
                eprintln!(
                    "[Eidolon TensorOracle] oracle_query unavailable: {}. Returning deterministic fallback.",
                    err
                );
                "TensorOracle unavailable (model/tokenizer not booted).".to_string()
            }
        }
    }
}
