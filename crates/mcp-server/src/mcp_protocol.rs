// mcp_protocol.rs — MCP JSON-RPC protocol helpers and tool definitions.
//
// Stateless helpers for MCP wire protocol: error formatting, tool list,
// payload parsing, and legacy tool normalization.
// Implements as associated functions on EidolonMcpServer (impl-block extension).

use crate::EidolonMcpServer;

impl EidolonMcpServer {
    pub(crate) fn as_mcp_tool_text_response(
        payload: serde_json::Value,
        is_error: bool,
    ) -> serde_json::Value {
        serde_json::json!({
            "isError": is_error,
            "content": [
                {
                    "type": "text",
                    "text": serde_json::to_string(&payload).unwrap_or_else(|_| "{\"error\":\"serialization_failed\"}".to_string())
                }
            ]
        })
    }

    pub(crate) fn structured_mcp_error_payload(
        code: &str,
        jsonrpc_code: i64,
        message: &str,
        details: serde_json::Value,
    ) -> serde_json::Value {
        serde_json::json!({
            "error": {
                "type": "structured_mcp_error",
                "code": code,
                "jsonrpc_code": jsonrpc_code,
                "message": message,
                "details": details
            }
        })
    }

    pub(crate) fn structured_mcp_error_response(
        code: &str,
        jsonrpc_code: i64,
        message: &str,
        details: serde_json::Value,
    ) -> serde_json::Value {
        Self::as_mcp_tool_text_response(
            Self::structured_mcp_error_payload(code, jsonrpc_code, message, details),
            true,
        )
    }

    pub(crate) fn parse_tools_call_payload(
        params: &serde_json::Value,
    ) -> Result<(String, serde_json::Value), serde_json::Value> {
        let tool_name = params
            .get("name")
            .and_then(|value| value.as_str())
            .or_else(|| params.get("tool").and_then(|value| value.as_str()))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let Some(tool_name) = tool_name else {
            return Err(Self::structured_mcp_error_response(
                "invalid_params",
                -32602,
                "tools/call requires one of [name, tool] fields.",
                serde_json::json!({
                    "accepted_name_fields": ["name", "tool"],
                    "accepted_args_fields": ["arguments", "input"]
                }),
            ));
        };

        let tool_args = if params.get("arguments").is_some() {
            params["arguments"].clone()
        } else if params.get("input").is_some() {
            params["input"].clone()
        } else {
            serde_json::json!({})
        };

        Ok((tool_name, tool_args))
    }

    pub(crate) fn map_tool_call_failure(
        tool_name: &str,
        result_content: &serde_json::Value,
    ) -> Option<serde_json::Value> {
        let raw_error = result_content.get("error")?;
        let message = raw_error
            .as_str()
            .map(str::to_string)
            .or_else(|| raw_error.as_object().map(|_| raw_error.to_string()))
            .unwrap_or_else(|| "Tool call failed.".to_string());

        let response = if message == "Unknown tool" {
            Self::structured_mcp_error_response(
                "tool_not_found",
                -32601,
                "Requested tool is not registered by this MCP runtime.",
                serde_json::json!({
                    "tool_name": tool_name,
                    "accepted_name_fields": ["name", "tool"],
                    "accepted_args_fields": ["arguments", "input"]
                }),
            )
        } else {
            Self::structured_mcp_error_response(
                "tool_execution_error",
                -32603,
                "Tool execution failed.",
                serde_json::json!({
                    "tool_name": tool_name,
                    "raw_error": message
                }),
            )
        };

        Some(response)
    }

    pub(crate) fn extract_structured_error_code(response: &serde_json::Value) -> Option<String> {
        let text = response
            .get("content")?
            .as_array()?
            .first()?
            .get("text")?
            .as_str()?;
        let payload: serde_json::Value = serde_json::from_str(text).ok()?;
        payload
            .get("error")?
            .get("code")?
            .as_str()
            .map(|code| code.to_string())
    }

    pub(crate) async fn list_tools_payload(&self) -> serde_json::Value {
        let mut tools = vec![
            serde_json::json!({ "name": "eidolon_recall_user", "description": "Recall User Profile", "inputSchema": { "type": "object", "properties": { "user_id": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_sense_intent", "description": "Sense intent", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "user_id": { "type": "string" } }, "required": ["query"] } }),
            serde_json::json!({ "name": "eidolon_check_pattern", "description": "Check safety guardrail", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" }, "mode": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_simulate_response", "description": "Simulate causal response", "inputSchema": { "type": "object", "properties": { "action": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_commit_pattern", "description": "Commit to memory", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_reason_chain", "description": "Deep reasoning chain", "inputSchema": { "type": "object", "properties": { "draft": { "type": "string" }, "context": { "type": "string" }, "mode": { "type": "string", "enum": ["auto", "fast", "deep"] }, "latency_budget_ms": { "type": "number" } } } }),
            serde_json::json!({ "name": "eidolon_recall_similar", "description": "Recall similar memories", "inputSchema": { "type": "object", "properties": { "context": { "type": "string" }, "k": { "type": "number" } } } }),
            serde_json::json!({ "name": "eidolon_memory_query", "description": "Query Vector Memory", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "route": { "type": "string", "enum": ["auto", "episodic", "semantic", "causal"] }, "k": { "type": "number" } } } }),
            serde_json::json!({ "name": "eidolon_compress_context", "description": "Compress Context", "inputSchema": { "type": "object", "properties": { "target_tokens": { "type": "number" }, "context": { "type": "string", "description": "Raw text to compress. If empty, compresses from memory store." }, "preserve_recent": { "type": "number" }, "dedupe_threshold": { "type": "number" }, "focus_terms": { "type": "array", "items": { "type": "string" } } } } }),
            serde_json::json!({ "name": "eidolon_record_outcome", "description": "Record outcome and learn", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" }, "mode": { "type": "string" }, "severity": { "type": "number" } } } }),
            serde_json::json!({ "name": "eidolon_update_user", "description": "Update User", "inputSchema": { "type": "object", "properties": { "user_id": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_dream_conversation", "description": "Dream conversation replay", "inputSchema": { "type": "object", "properties": { "episodes": { "type": "number" } } } }),
            serde_json::json!({ "name": "eidolon_orchestrate", "description": "Orchestrate mult-agents", "inputSchema": { "type": "object", "properties": { "agent_count": { "type": "number" }, "task": { "type": "string" }, "confidence": { "type": "number" }, "latency_budget_ms": { "type": "number" } } } }),
            serde_json::json!({ "name": "eidolon_tool_recommend", "description": "Recommend tool", "inputSchema": { "type": "object", "properties": { "task": { "type": "string" }, "available_tools": { "type": "array", "items": { "type": "string" } }, "recommender_model": { "type": "string", "enum": ["v1", "v2"] }, "shadow_mode": { "type": "boolean" } } } }),
            serde_json::json!({ "name": "eidolon_subbrain_auto", "description": "Sub-Brain Auto-Orchestration: Automatically classifies intent, recommends tools, and executes based on confidence", "inputSchema": { "type": "object", "properties": { "input": { "type": "string", "description": "User input to analyze" }, "user_id": { "type": "string" }, "auto_execute": { "type": "boolean", "default": true }, "force_execute": { "type": "boolean", "default": false }, "max_tools": { "type": "number", "default": 3 }, "include_raw_results": { "type": "boolean", "default": true } }, "required": ["input"] } }),
            serde_json::json!({ "name": "eidolon_route_action", "description": "Meta-cognitive routing policy returning AUTO, PROPOSE, or ASK_USER", "inputSchema": { "type": "object", "properties": { "suggested_tool": { "type": "string" }, "intent_confidence": { "type": "number" }, "context_type": { "type": "string" } }, "required": ["suggested_tool", "intent_confidence"] } }),
            serde_json::json!({ "name": "eidolon_generated_tool_decision", "description": "Generated tool governance decision", "inputSchema": { "type": "object", "properties": { "tool_name": { "type": "string" }, "action": { "type": "string", "enum": ["accept", "reject", "promote"] }, "need": { "type": "string" }, "reason": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_forge_tool", "description": "Forge a WASM tool", "inputSchema": { "type": "object", "properties": { "name": { "type": "string" }, "description": { "type": "string" }, "code": { "type": "string" } }, "required": ["name", "code"] } }),
            serde_json::json!({ "name": "eidolon_set_entropy", "description": "Force entropy state", "inputSchema": { "type": "object", "properties": { "target_entropy": { "type": "number" }, "duration_ms": { "type": "number" } }, "required": ["target_entropy", "duration_ms"] } }),
            // Legacy aliases
            serde_json::json!({ "name": "eidolon_oracle_sense", "description": "Legacy Oracle market sensing (compat mode only)", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_defi_quote", "description": "Legacy DeFi quote bridge (compat mode only)", "inputSchema": { "type": "object", "properties": { "token_in": { "type": "string" }, "token_out": { "type": "string" }, "amount": {} } } }),
            serde_json::json!({ "name": "eidolon_security_scan", "description": "Legacy contract security scan bridge (compat mode only)", "inputSchema": { "type": "object", "properties": { "contract": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_get_portfolio", "description": "Legacy portfolio snapshot bridge (compat mode only)", "inputSchema": { "type": "object", "properties": { "owner": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_execute_swap", "description": "Legacy execute swap bridge (compat mode only)", "inputSchema": { "type": "object", "properties": { "token_in": { "type": "string" }, "token_out": { "type": "string" }, "amount": {} } } }),
            serde_json::json!({ "name": "eidolon_panic_button", "description": "Legacy emergency mode bridge (compat mode only)", "inputSchema": { "type": "object", "properties": { "wallet": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_recall", "description": "Legacy user recall alias", "inputSchema": { "type": "object", "properties": { "user_id": { "type": "string" }, "wallet": { "type": "string" }, "address": { "type": "string" } } } }),
            serde_json::json!({ "name": "eidolon_intuition", "description": "Legacy intent sensing alias", "inputSchema": { "type": "object", "properties": {} } }),
            serde_json::json!({ "name": "eidolon_dream", "description": "Legacy dream replay alias", "inputSchema": { "type": "object", "properties": { "episodes": { "type": "number" }, "cycles": { "type": "number" } } } }),
        ];

        let dynamic_tools = self.dynamic_tools.lock().await;
        for (name, tool) in dynamic_tools.iter() {
            tools.push(serde_json::json!({
                "name": name,
                "description": format!("(Dynamic) {}", tool.description),
                "inputSchema": {
                    "type": "object",
                    "properties": { "input": { "type": "number" } }
                }
            }));
        }

        if !Self::legacy_defi_compat_enabled() {
            let legacy_defi_tools = [
                "eidolon_oracle_sense",
                "eidolon_defi_quote",
                "eidolon_security_scan",
                "eidolon_get_portfolio",
                "eidolon_execute_swap",
                "eidolon_panic_button",
            ];
            tools.retain(|tool| {
                let name = tool
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                !legacy_defi_tools.contains(&name)
            });
        }

        serde_json::json!({ "tools": tools })
    }

    pub(crate) fn normalize_legacy_tool_call(
        method: &str,
        mut params: serde_json::Value,
    ) -> (String, serde_json::Value) {
        match method {
            "eidolon_recall" => {
                if let Some(obj) = params.as_object_mut() {
                    if !obj.contains_key("user_id") {
                        if let Some(value) = obj
                            .get("wallet")
                            .cloned()
                            .or_else(|| obj.get("address").cloned())
                        {
                            obj.insert("user_id".to_string(), value);
                        }
                    }
                }
                ("eidolon_recall_user".to_string(), params)
            }
            "eidolon_intuition" => ("eidolon_sense_intent".to_string(), params),
            "eidolon_dream" => {
                if let Some(obj) = params.as_object_mut() {
                    if !obj.contains_key("episodes") {
                        if let Some(value) = obj.get("cycles").cloned() {
                            obj.insert("episodes".to_string(), value);
                        }
                    }
                }
                ("eidolon_dream_conversation".to_string(), params)
            }
            _ => (method.to_string(), params),
        }
    }
}
