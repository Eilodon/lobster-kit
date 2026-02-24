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
            "clawkit_recall_user" => self.handle_recall_user(params).await,
            "clawkit_route_action" => self.handle_route_action(params).await,
            "clawkit_sense_intent" => self.handle_sense_intent(params).await,
            "clawkit_check_pattern" => self.handle_check_pattern(params).await,
            "clawkit_simulate_response" => self.handle_simulate_response(params).await,
            "clawkit_commit_pattern" => self.handle_commit_pattern(params).await,
            "clawkit_reason_chain" => self.handle_reason_chain(params).await,
            "clawkit_recall_similar" => self.handle_recall_similar(params).await,
            "clawkit_memory_query" => self.handle_memory_query(params).await,
            "clawkit_compress_context" => self.handle_compress_context(params).await,
            "clawkit_record_outcome" => self.handle_record_outcome(params).await,
            "clawkit_update_user" => self.handle_update_user(params).await,
            "clawkit_dream_conversation" => self.handle_dream_conversation(params).await,
            "clawkit_orchestrate" => self.handle_orchestrate(params).await,
            "clawkit_tool_recommend" => self.handle_tool_recommend(params).await,
            "clawkit_subbrain_auto" => self.handle_subbrain_auto(params).await,
            "clawkit_generated_tool_decision" => self.handle_generated_tool_decision(params).await,
            "eidolon_oracle_sense" => self.handle_oracle_sense(params).await,
            "eidolon_defi_quote" => self.handle_defi_quote(params).await,
            "eidolon_security_scan" => self.handle_security_scan(params).await,
            "eidolon_get_portfolio" => self.handle_get_portfolio(params).await,
            "eidolon_execute_swap" => self.handle_execute_swap(params).await,
            "eidolon_panic_button" => self.handle_panic_button(params).await,
            "clawkit_oracle_query" => self.handle_oracle_query(params).await,
            _ => serde_json::json!({ "error": "Unknown tool" }),
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
                        let params = req.get("params").cloned().unwrap_or(serde_json::json!({}));

                        let server_clone = self.clone();
                        let out_tx_clone = out_tx.clone();

                        tokio::spawn(async move {
                            let response = match method_owned.as_str() {
                                "initialize" => {
                                    serde_json::json!({
                                        "protocolVersion": "2024-11-05",
                                        "capabilities": { "tools": {}, "resources": {} },
                                        "serverInfo": { "name": "clawkit-v4", "version": "4.0.0" }
                                    })
                                }
                                "notifications/initialized" => return,
                                "tools/list" => Self::list_tools_payload(),
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
                                            Self::as_mcp_tool_text_response(result_content, false)
                                        }
                                    }
                                    Err(error_response) => {
                                        server_clone
                                            .record_tool_metric(
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
