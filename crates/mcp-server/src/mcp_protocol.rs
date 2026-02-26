// mcp_protocol.rs — MCP JSON-RPC protocol helpers and tool definitions.
//
// Stateless helpers for MCP wire protocol: error formatting, tool list,
// payload parsing, and legacy tool normalization.
// Implements as associated functions on EidolonMcpServer (impl-block extension).

use crate::generated::mcp_contract::{
    list_tools_static_catalog, ACCEPTED_ARGS_FIELDS, ACCEPTED_NAME_FIELDS,
    LEGACY_DEFI_COMPAT_TOOL_CATALOG,
};
use crate::EidolonMcpServer;

impl EidolonMcpServer {
    fn accepted_name_fields_json() -> serde_json::Value {
        serde_json::Value::Array(
            ACCEPTED_NAME_FIELDS
                .iter()
                .map(|field| serde_json::Value::String((*field).to_string()))
                .collect(),
        )
    }

    fn accepted_args_fields_json() -> serde_json::Value {
        serde_json::Value::Array(
            ACCEPTED_ARGS_FIELDS
                .iter()
                .map(|field| serde_json::Value::String((*field).to_string()))
                .collect(),
        )
    }

    fn tenant_id_schema_property() -> serde_json::Value {
        serde_json::json!({
            "type": "string",
            "description": "Optional tenant namespace. Defaults to 'default' when omitted."
        })
    }

    fn inject_optional_tenant_id(tool: &mut serde_json::Value) {
        let Some(input_schema) = tool.get_mut("inputSchema") else {
            return;
        };
        let Some(input_schema_obj) = input_schema.as_object_mut() else {
            return;
        };
        if input_schema_obj
            .get("type")
            .and_then(|value| value.as_str())
            != Some("object")
        {
            return;
        }

        let properties = input_schema_obj
            .entry("properties")
            .or_insert_with(|| serde_json::json!({}));
        let Some(properties_obj) = properties.as_object_mut() else {
            return;
        };

        properties_obj
            .entry("tenant_id".to_string())
            .or_insert_with(Self::tenant_id_schema_property);
    }

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
                    "accepted_name_fields": Self::accepted_name_fields_json(),
                    "accepted_args_fields": Self::accepted_args_fields_json()
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
                    "accepted_name_fields": Self::accepted_name_fields_json(),
                    "accepted_args_fields": Self::accepted_args_fields_json()
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
        let mut tools = list_tools_static_catalog();

        let dynamic_tools = self.dynamic_tools.write().await;
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

        for tool in tools.iter_mut() {
            Self::inject_optional_tenant_id(tool);
        }

        if !Self::legacy_defi_compat_enabled() {
            tools.retain(|tool| {
                let name = tool
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                !LEGACY_DEFI_COMPAT_TOOL_CATALOG.contains(&name)
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
