// dispatch.rs — Tool call dispatch and STDIO transport.
//
// Contains the `handle_tool_call` dispatcher and
// the `run_stdio` JSON-RPC transport loop.
use crate::EidolonMcpServer;
use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt};

impl EidolonMcpServer {
    pub async fn handle_tool_call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let (resolved_method, params) = Self::normalize_legacy_tool_call(method, params);
        match resolved_method.as_str() {
            "eidolon_recall_user" => self.handle_recall_user(params).await,
            "eidolon_route_action" => self.handle_route_action(params).await,
            "eidolon_sense_intent" => self.handle_sense_intent(params).await,
            "eidolon_check_pattern" => self.handle_check_pattern(params).await,
            "eidolon_simulate_response" => self.handle_simulate_response(params).await,
            "eidolon_commit_pattern" => self.handle_commit_pattern(params).await,
            "eidolon_reason_chain" => self.handle_reason_chain(params).await,
            "eidolon_recall_similar" => self.handle_recall_similar(params).await,
            "eidolon_memory_query" => self.handle_memory_query(params).await,
            "eidolon_compress_context" => self.handle_compress_context(params).await,
            "eidolon_record_outcome" => self.handle_record_outcome(params).await,
            "eidolon_update_user" => self.handle_update_user(params).await,
            "eidolon_dream_conversation" => self.handle_dream_conversation(params).await,
            "eidolon_orchestrate" => self.handle_orchestrate(params).await,
            "eidolon_tool_recommend" => self.handle_tool_recommend(params).await,
            "eidolon_subbrain_auto" => self.handle_subbrain_auto(params).await,
            "eidolon_generated_tool_decision" => self.handle_generated_tool_decision(params).await,
            "eidolon_oracle_sense" => {
                if Self::legacy_defi_compat_enabled() {
                    self.handle_oracle_sense(params).await
                } else {
                    serde_json::json!({
                        "error": "legacy_compat_disabled",
                        "tool": "eidolon_oracle_sense",
                        "hint": "Enable LEGACY_DEFI_COMPAT_ENABLED=true for compatibility-mode legacy tools."
                    })
                }
            }
            "eidolon_defi_quote" => {
                if Self::legacy_defi_compat_enabled() {
                    self.handle_defi_quote(params).await
                } else {
                    serde_json::json!({
                        "error": "legacy_compat_disabled",
                        "tool": "eidolon_defi_quote",
                        "hint": "Enable LEGACY_DEFI_COMPAT_ENABLED=true for compatibility-mode legacy tools."
                    })
                }
            }
            "eidolon_security_scan" => {
                if Self::legacy_defi_compat_enabled() {
                    self.handle_security_scan(params).await
                } else {
                    serde_json::json!({
                        "error": "legacy_compat_disabled",
                        "tool": "eidolon_security_scan",
                        "hint": "Enable LEGACY_DEFI_COMPAT_ENABLED=true for compatibility-mode legacy tools."
                    })
                }
            }
            "eidolon_get_portfolio" => {
                if Self::legacy_defi_compat_enabled() {
                    self.handle_get_portfolio(params).await
                } else {
                    serde_json::json!({
                        "error": "legacy_compat_disabled",
                        "tool": "eidolon_get_portfolio",
                        "hint": "Enable LEGACY_DEFI_COMPAT_ENABLED=true for compatibility-mode legacy tools."
                    })
                }
            }
            "eidolon_execute_swap" => {
                if Self::legacy_defi_compat_enabled() {
                    self.handle_execute_swap(params).await
                } else {
                    serde_json::json!({
                        "error": "legacy_compat_disabled",
                        "tool": "eidolon_execute_swap",
                        "hint": "Enable LEGACY_DEFI_COMPAT_ENABLED=true for compatibility-mode legacy tools."
                    })
                }
            }
            "eidolon_panic_button" => {
                if Self::legacy_defi_compat_enabled() {
                    self.handle_panic_button(params).await
                } else {
                    serde_json::json!({
                        "error": "legacy_compat_disabled",
                        "tool": "eidolon_panic_button",
                        "hint": "Enable LEGACY_DEFI_COMPAT_ENABLED=true for compatibility-mode legacy tools."
                    })
                }
            }
            "eidolon_forge_tool" => self.handle_forge_tool(params).await,
            "eidolon_set_entropy" => self.handle_set_entropy(params).await,
            "eidolon_oracle_query" => self.handle_oracle_query(params).await,
            _ => {
                let is_dynamic = {
                    self.dynamic_tools
                        .read()
                        .await
                        .contains_key(resolved_method.as_str())
                };
                if is_dynamic {
                    self.execute_dynamic_tool(resolved_method.as_str(), params)
                        .await
                } else {
                    serde_json::json!({ "error": "Unknown tool" })
                }
            }
        }
    }
    pub async fn run_stdio(&self) {
        let stdin = io::stdin();
        let mut reader = io::BufReader::new(stdin).lines();

        // Demultiplexing to prevent I/O blocking
        let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<String>(100);

        // Single serialized STDOUT writer
        tokio::spawn(async move {
            let mut stdout = io::stdout();
            while let Some(msg) = out_rx.recv().await {
                let _ = stdout.write_all(format!("{}\n", msg).as_bytes()).await;
                let _ = stdout.flush().await;
            }
        });

        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(req) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(method_val) = req.get("method") {
                    if let Some(method) = method_val.as_str() {
                        let id = req["id"].clone();
                        let method_owned = method.to_string();
                        // Track last input ms for Continuous Background Dreaming
                        self.last_input_ms.store(
                            chrono::Utc::now().timestamp_millis() as u64,
                            std::sync::atomic::Ordering::Relaxed,
                        );

                        let params = req.get("params").cloned().unwrap_or(serde_json::json!({}));

                        let server_clone = self.clone();
                        let out_tx_clone = out_tx.clone();

                        tokio::spawn(async move {
                            let response = match method_owned.as_str() {
                                "initialize" => {
                                    serde_json::json!({
                                        "protocolVersion": "2024-11-05",
                                        "capabilities": { "tools": {}, "resources": {} },
                                        "serverInfo": { "name": "eidolon-v4", "version": "4.0.0" }
                                    })
                                }
                                "notifications/initialized" => return,
                                "tools/list" => server_clone.list_tools_payload().await,
                                "resources/list" => server_clone.list_resources_payload(),
                                "resources/templates/list" => {
                                    serde_json::json!({
                                        "resourceTemplates": []
                                    })
                                }
                                "resources/read" => {
                                    let uri = params["uri"].as_str().unwrap_or("");
                                    server_clone.read_resource_payload(uri).await.unwrap_or_else(|| {
                                        serde_json::json!({
                                            "contents": [
                                                {
                                                    "uri": uri,
                                                    "mimeType": "application/json",
                                                    "text": format!("{{\"error\":\"Unknown resource: {}\"}}", uri)
                                                }
                                            ],
                                            "isError": true
                                        })
                                    })
                                }
                                "tools/call" => match Self::parse_tools_call_payload(&params) {
                                    Ok((tool_name, tool_args)) => {
                                        let tenant_id = crate::helpers::extract_tenant_id(&tool_args);
                                        let started = std::time::Instant::now();
                                        let result_content = server_clone
                                            .handle_tool_call(&tool_name, tool_args)
                                            .await;
                                        let latency_us = started.elapsed().as_micros() as u64;
                                        let latency_ms = latency_us as f64 / 1000.0;
                                        let failed = result_content.get("error").is_some();
                                        let fallback_used = result_content
                                            .get("fallback_used")
                                            .and_then(|value| value.as_bool())
                                            .unwrap_or(false);
                                        let name_field = if params.get("name").is_some() {
                                            "name"
                                        } else if params.get("tool").is_some() {
                                            "tool"
                                        } else {
                                            "unknown"
                                        };
                                        let args_field = if params.get("arguments").is_some() {
                                            "arguments"
                                        } else if params.get("input").is_some() {
                                            "input"
                                        } else {
                                            "none"
                                        };

                                        server_clone
                                            .record_tool_metric(
                                                &tenant_id,
                                                &tool_name,
                                                failed,
                                                latency_us,
                                                fallback_used,
                                            )
                                            .await;

                                        if let Some(error_response) =
                                            Self::map_tool_call_failure(&tool_name, &result_content)
                                        {
                                            let reason = Self::extract_structured_error_code(
                                                &error_response,
                                            )
                                            .unwrap_or_else(|| "tool_execution_error".to_string());
                                            server_clone
                                                .record_generated_tool_audit(
                                                    &tenant_id,
                                                    &tool_name,
                                                    &tool_name,
                                                    "rejected",
                                                    &reason,
                                                    serde_json::json!({
                                                        "latency_us": latency_us,
                                                        "latency_ms": latency_ms,
                                                        "fallback_used": fallback_used,
                                                        "name_field": name_field,
                                                        "args_field": args_field
                                                    }),
                                                )
                                                .await;
                                            error_response
                                        } else {
                                            server_clone
                                                .record_generated_tool_audit(
                                                    &tenant_id,
                                                    &tool_name,
                                                    &tool_name,
                                                    "accepted",
                                                    "tool_call_ok",
                                                    serde_json::json!({
                                                        "latency_us": latency_us,
                                                        "latency_ms": latency_ms,
                                                        "fallback_used": fallback_used,
                                                        "name_field": name_field,
                                                        "args_field": args_field
                                                    }),
                                                )
                                                .await;

                                            // Phase 4: Auto-promotion governance check
                                            {
                                                let db_path =
                                                    (*server_clone.telemetry_db_path).clone();
                                                let tool_for_promo = tool_name.clone();
                                                let perf_row = tokio::task::spawn_blocking(move || {
                                                    EidolonMcpServer::load_tool_performance_row_sync(
                                                        &db_path,
                                                        &tool_for_promo,
                                                    )
                                                })
                                                .await
                                                .ok()
                                                .and_then(Result::ok)
                                                .flatten();

                                                if let Some(row) = perf_row {
                                                    let thresholds = Self::promotion_thresholds();
                                                    let (eligible, failures) =
                                                        Self::evaluate_tool_promotion(
                                                            &row,
                                                            &thresholds,
                                                        );
                                                    if eligible {
                                                        eprintln!(
                                                            "[Eidolon] 🏆 Tool '{}' promotion-eligible (calls:{}, err:{:.3}%, p95:{:.1}ms)",
                                                            tool_name, row.call_count,
                                                            (1.0 - row.success_rate) * 100.0,
                                                            row.latency_p95_ms
                                                        );
                                                    } else if row.call_count >= thresholds.min_calls
                                                    {
                                                        // Only log failures after min_calls met (avoid noise)
                                                        eprintln!(
                                                            "[Eidolon] ⚠️  Tool '{}' promotion blocked: {:?}",
                                                            tool_name, failures
                                                        );
                                                    }
                                                }
                                            }

                                            Self::as_mcp_tool_text_response(result_content, false)
                                        }
                                    }
                                    Err(error_response) => {
                                        let tenant_id = "default".to_string();
                                        server_clone
                                            .record_tool_metric(
                                                &tenant_id,
                                                "tools/call.invalid_params",
                                                true,
                                                0,
                                                false,
                                            )
                                            .await;
                                        let reason =
                                            Self::extract_structured_error_code(&error_response)
                                                .unwrap_or_else(|| "invalid_params".to_string());
                                        server_clone
                                            .record_generated_tool_audit(
                                                &tenant_id,
                                                "tools/call.invalid_params",
                                                "tools/call",
                                                "rejected",
                                                &reason,
                                                serde_json::json!({
                                                    "name_present": params.get("name").is_some() || params.get("tool").is_some(),
                                                    "arguments_present": params.get("arguments").is_some(),
                                                    "input_present": params.get("input").is_some()
                                                }),
                                            )
                                            .await;
                                        error_response
                                    }
                                },
                                _ => server_clone.handle_tool_call(&method_owned, params).await,
                            };

                            let result = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": response
                            });

                            if let Ok(res_str) = serde_json::to_string(&result) {
                                let _ = out_tx_clone.send(res_str).await;
                            }
                        });
                    }
                }
            }
        }
    }
}
