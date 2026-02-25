use super::*;
use rusqlite::{params, Connection};
use serde_json::json;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_test_path(prefix: &str, extension: &str) -> PathBuf {
    let seq = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "{}-{}-{}-{}.{}",
        prefix,
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        seq,
        extension
    ))
}

fn unique_test_dir(prefix: &str) -> PathBuf {
    let seq = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "{}-{}-{}-{}",
        prefix,
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        seq
    ));
    std::fs::create_dir_all(&dir).expect("failed to create unique test directory");
    dir
}

fn decode_mcp_text_payload(response: &serde_json::Value) -> serde_json::Value {
    let text = response["content"][0]["text"]
        .as_str()
        .expect("missing mcp text payload");
    serde_json::from_str(text).expect("invalid json payload text")
}

fn setup_server_with_paths(users_path: PathBuf, telemetry_db_path: PathBuf) -> EidolonMcpServer {
    EidolonMcpServer::with_storage_paths(users_path, telemetry_db_path)
}

// Helper function to setup the server
fn setup_server() -> EidolonMcpServer {
    let test_dir = unique_test_dir("eidolon-test");
    setup_server_with_paths(
        test_dir.join("eidolon-users.json"),
        test_dir.join("eidolon-telemetry.db"),
    )
}

#[tokio::test]
async fn test_phase_a_core_loop() {
    let server = setup_server();

    let res = server
        .handle_tool_call("eidolon_recall_user", json!({"user_id": "u123"}))
        .await;
    assert_eq!(res["user_id"], "u123");
    assert_eq!(res["status"], "success");

    let res = server
        .handle_tool_call("eidolon_sense_intent", json!({}))
        .await;
    assert_eq!(res["success"], true);
    assert_eq!(res["recommended_mode"], "Peer");

    let res = server
        .handle_tool_call(
            "eidolon_check_pattern",
            json!({"pattern": "greetings", "mode": "Peer"}),
        )
        .await;
    assert_eq!(res["pattern"], "greetings");
    assert_eq!(res["inhibited"], false);

    let res = server
        .handle_tool_call("eidolon_simulate_response", json!({"action": "ask_why"}))
        .await;
    assert_eq!(res["action_tested"], "ask_why");
    assert_eq!(res["predicted_outcome"], "positive");

    let res = server
        .handle_tool_call("eidolon_commit_pattern", json!({"pattern": "greetings"}))
        .await;
    assert_eq!(res["status"], "committed");
}

#[tokio::test]
async fn test_phase_b_reasoning_memory() {
    let server = setup_server();

    let res = server
        .handle_tool_call(
            "eidolon_recall_similar",
            json!({"context": "hello", "k": 2}),
        )
        .await;
    assert!(res["matches"].is_array());

    // Memory query: no memories yet, should return 0 matches
    let res = server
        .handle_tool_call("eidolon_memory_query", json!({"query": "risk level"}))
        .await;
    assert_eq!(res["query"], "risk level");
    assert_eq!(res["matches"], 0);

    // Compress with real input
    let res = server.handle_tool_call("eidolon_compress_context", json!({
            "target_tokens": 10,
            "context": "The market is volatile today. Gas fees are extremely high. User wants to buy BNB. There is a potential rug pull."
        })).await;
    assert!(res["compressed_context"].is_string());
    let _compressed = res["compressed_context"].as_str().unwrap();
    let original = res["original_tokens"].as_u64().unwrap();
    let comp_tokens = res["compressed_tokens"].as_u64().unwrap();
    assert!(
        comp_tokens <= original,
        "Compressed should not be larger than original"
    );
}

#[tokio::test]
async fn test_phase_c_learning_orchestration() {
    let server = setup_server();

    // Record an outcome → should also write to memory
    let res = server
        .handle_tool_call(
            "eidolon_record_outcome",
            json!({
                "pattern": "test_pattern", "mode": "Peer", "severity": 0.0
            }),
        )
        .await;
    assert_eq!(res["status"], "outcome_recorded");
    assert_eq!(res["memory_stored"], true);

    // Now memory_query should find it
    let res = server
        .handle_tool_call("eidolon_memory_query", json!({"query": "test_pattern"}))
        .await;
    assert!(
        res["matches"].as_u64().unwrap() > 0,
        "Memory should contain the recorded outcome"
    );

    // Update user and verify persistence
    let res = server
        .handle_tool_call(
            "eidolon_update_user",
            json!({"user_id": "u123", "preferred_mode": "Berserk", "risk_tolerance": 0.99}),
        )
        .await;
    assert_eq!(res["status"], "user_profile_persisted");

    let res = server
        .handle_tool_call("eidolon_recall_user", json!({"user_id": "u123"}))
        .await;
    assert_eq!(res["profile"]["preferred_mode"], "Berserk");
    assert_eq!(res["profile"]["risk_tolerance"], 0.99);

    let res = server
        .handle_tool_call("eidolon_dream_conversation", json!({"episodes": 10}))
        .await;
    assert_eq!(res["episodes_processed"], 10);

    let res = server
        .handle_tool_call("eidolon_orchestrate", json!({"agent_count": 5}))
        .await;
    assert_eq!(res["agents_spawned"], 5);

    let res = server
        .handle_tool_call("eidolon_tool_recommend", json!({"task": "analyze_market"}))
        .await;
    assert!(res["recommended_tools"].is_array());
    assert_eq!(res["task"], "analyze_market");
}

#[test]
fn test_contract_accepts_name_and_arguments_fields() {
    let parsed = EidolonMcpServer::parse_tools_call_payload(&json!({
        "name": "eidolon_sense_intent",
        "arguments": { "task": "check intent" }
    }))
    .expect("expected valid tools/call payload");

    assert_eq!(parsed.0, "eidolon_sense_intent");
    assert_eq!(parsed.1["task"], "check intent");
}

#[test]
fn test_contract_accepts_tool_and_input_fields() {
    let parsed = EidolonMcpServer::parse_tools_call_payload(&json!({
        "tool": "eidolon_sense_intent",
        "input": { "task": "check intent" }
    }))
    .expect("expected valid tools/call payload");

    assert_eq!(parsed.0, "eidolon_sense_intent");
    assert_eq!(parsed.1["task"], "check intent");
}

const CONTRACT_REQUIRED_COGNITIVE_CORE_TOOLS: [&str; 6] = [
    "eidolon_recall_user",
    "eidolon_sense_intent",
    "eidolon_reason_chain",
    "eidolon_memory_query",
    "eidolon_compress_context",
    "eidolon_oracle_query",
];

const LEGACY_ALIAS_TOOL_CATALOG: [&str; 3] =
    ["eidolon_recall", "eidolon_intuition", "eidolon_dream"];
const LEGACY_DEFI_COMPAT_TOOL_CATALOG: [&str; 6] = [
    "eidolon_oracle_sense",
    "eidolon_defi_quote",
    "eidolon_security_scan",
    "eidolon_get_portfolio",
    "eidolon_execute_swap",
    "eidolon_panic_button",
];

#[tokio::test]
async fn test_contract_tools_list_platform_first_defaults() {
    std::env::remove_var("LEGACY_DEFI_COMPAT_ENABLED");
    std::env::remove_var("LEGACY_DEFI_COMPAT_ALLOWED_ENVS");

    let server = setup_server();
    let payload = server.list_tools_payload().await;
    let tools = payload["tools"].as_array().expect("missing tools array");
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
        .collect();

    assert!(
        names.iter().any(|name| name.starts_with("eidolon_")),
        "tools/list must include eidolon_* prefix"
    );

    for required in LEGACY_ALIAS_TOOL_CATALOG {
        assert!(
            names.contains(&required),
            "missing required legacy alias tool in tools/list: {}",
            required
        );
    }

    for required in CONTRACT_REQUIRED_COGNITIVE_CORE_TOOLS {
        assert!(
            names.contains(&required),
            "missing required cognitive tool in tools/list: {}",
            required
        );
    }

    for required in LEGACY_DEFI_COMPAT_TOOL_CATALOG {
        assert!(
            !names.contains(&required),
            "legacy DeFi compatibility tool should be disabled by default: {}",
            required
        );
    }
}

#[tokio::test]
async fn test_contract_tools_list_includes_optional_tenant_id_schema() {
    let server = setup_server();
    let payload = server.list_tools_payload().await;
    let tools = payload["tools"].as_array().expect("missing tools array");

    for required in CONTRACT_REQUIRED_COGNITIVE_CORE_TOOLS {
        let tool = tools
            .iter()
            .find(|tool| tool.get("name").and_then(|value| value.as_str()) == Some(required))
            .unwrap_or_else(|| panic!("missing required tool: {}", required));
        assert_eq!(
            tool["inputSchema"]["properties"]["tenant_id"]["type"], "string",
            "tool {} must expose optional tenant_id schema field",
            required
        );
    }
}

#[test]
fn test_contract_missing_name_or_tool_returns_structured_mcp_error() {
    let err = EidolonMcpServer::parse_tools_call_payload(&json!({
        "arguments": {}
    }))
    .expect_err("expected structured error");

    assert_eq!(err["isError"], true);
    let payload = decode_mcp_text_payload(&err);
    assert_eq!(payload["error"]["type"], "structured_mcp_error");
    assert_eq!(payload["error"]["code"], "invalid_params");
    assert_eq!(
        payload["error"]["details"]["accepted_name_fields"][0],
        "name"
    );
    assert_eq!(
        payload["error"]["details"]["accepted_name_fields"][1],
        "tool"
    );
}

#[tokio::test]
async fn test_unknown_tool_maps_to_structured_mcp_error() {
    let server = setup_server();
    let raw = server
        .handle_tool_call("eidolon_non_existing_tool", json!({}))
        .await;
    let mapped = EidolonMcpServer::map_tool_call_failure("eidolon_non_existing_tool", &raw)
        .expect("expected error mapping");

    assert_eq!(mapped["isError"], true);
    let payload = decode_mcp_text_payload(&mapped);
    assert_eq!(payload["error"]["type"], "structured_mcp_error");
    assert_eq!(payload["error"]["code"], "tool_not_found");
    assert_eq!(
        payload["error"]["details"]["accepted_args_fields"][0],
        "arguments"
    );
    assert_eq!(
        payload["error"]["details"]["accepted_args_fields"][1],
        "input"
    );
}

#[tokio::test]
async fn test_generated_tool_audit_records_entries() {
    let server = setup_server();
    let unique_reason = format!(
        "test_generated_tool_audit_{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    server
        .record_generated_tool_audit(
            "default_tenant",
            "eidolon_sense_intent",
            "eidolon_sense_intent",
            "accepted",
            &unique_reason,
            json!({"source": "unit-test"}),
        )
        .await;

    let db_path = (*server.telemetry_db_path).clone();
    let rows = EidolonMcpServer::load_generated_tool_audit_rows_sync(&db_path, 200)
        .expect("expected audit rows from sqlite");
    assert!(
        rows.iter().any(|row| row.reason == unique_reason),
        "generated_tool_audit row was not persisted"
    );
}

#[tokio::test]
async fn test_generated_tool_audit_adds_provenance_metadata() {
    let server = setup_server();
    let unique_reason = format!(
        "test_generated_tool_audit_provenance_{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    server
        .record_generated_tool_audit(
            "default_tenant",
            "eidolon_reason_chain",
            "tool_generator_review",
            "accepted",
            &unique_reason,
            json!({"source": "unit-test"}),
        )
        .await;

    let db_path = (*server.telemetry_db_path).clone();
    let rows = EidolonMcpServer::load_generated_tool_audit_rows_sync(&db_path, 200)
        .expect("expected audit rows from sqlite");
    let record = rows
        .iter()
        .find(|row| row.reason == unique_reason)
        .expect("expected inserted audit row");
    let metadata: serde_json::Value =
        serde_json::from_str(&record.metadata).expect("metadata should be valid json");
    assert_eq!(metadata["audit_schema"], "generated_tool_audit.v1");
    assert_eq!(metadata["decision_source"], "mcp-rust");
    assert_eq!(metadata["immutable"], true);
    assert!(metadata["decision_actor"].is_string());
    assert!(metadata["runtime_profile"].is_string());
}

#[tokio::test]
async fn test_generated_tool_audit_is_immutable() {
    let server = setup_server();
    let unique_reason = format!(
        "test_generated_tool_audit_immutable_{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    server
        .record_generated_tool_audit(
            "default_tenant",
            "eidolon_memory_query",
            "tool_generator_review",
            "rejected",
            &unique_reason,
            json!({"source": "unit-test"}),
        )
        .await;

    let db_path = (*server.telemetry_db_path).clone();
    let conn = Connection::open(&db_path).expect("open sqlite");
    let update_result = conn.execute(
        "UPDATE generated_tool_audit SET reason = ?1 WHERE reason = ?2",
        params!["mutated", unique_reason],
    );
    assert!(update_result.is_err(), "audit table must reject UPDATE");

    let delete_result = conn.execute(
        "DELETE FROM generated_tool_audit WHERE reason = ?1",
        params![unique_reason],
    );
    assert!(delete_result.is_err(), "audit table must reject DELETE");
}

#[test]
fn test_evaluate_tool_promotion_thresholds() {
    let thresholds = ToolPromotionThresholds {
        min_calls: 30,
        max_error_rate: 0.1,
        max_p95_ms: 1800.0,
        max_fallback_rate: 0.2,
        min_satisfaction: 0.7,
    };
    let passing = PersistedToolPerformanceRow {
        tenant_id: "default_tenant".to_string(),
        tool_name: "tool_a".to_string(),
        call_count: 40,
        error_count: 2,
        fallback_count: 4,
        success_rate: 0.95,
        avg_latency_ms: 800.0,
        avg_latency_us: 800_000.0,
        latency_p50_ms: 500.0,
        latency_p90_ms: 900.0,
        latency_p95_ms: 1200.0,
        latency_p99_ms: 1500.0,
        fallback_rate: 0.1,
        user_satisfaction: 0.9,
        latency_sample_count: 40,
        last_called: 0,
    };
    let (pass_ok, pass_reasons) = EidolonMcpServer::evaluate_tool_promotion(&passing, &thresholds);
    assert!(pass_ok);
    assert!(pass_reasons.is_empty());

    let failing = PersistedToolPerformanceRow {
        tenant_id: "default_tenant".to_string(),
        tool_name: "tool_b".to_string(),
        call_count: 10,
        error_count: 6,
        fallback_count: 8,
        success_rate: 0.4,
        avg_latency_ms: 3000.0,
        avg_latency_us: 3_000_000.0,
        latency_p50_ms: 2000.0,
        latency_p90_ms: 2500.0,
        latency_p95_ms: 2800.0,
        latency_p99_ms: 3200.0,
        fallback_rate: 0.8,
        user_satisfaction: 0.2,
        latency_sample_count: 10,
        last_called: 0,
    };
    let (fail_ok, fail_reasons) = EidolonMcpServer::evaluate_tool_promotion(&failing, &thresholds);
    assert!(!fail_ok);
    assert!(!fail_reasons.is_empty());
}

#[test]
fn test_evaluate_tool_autopilot_guardrails() {
    let guardrails = ToolAutopilotGuardrails {
        max_error_rate: 0.2,
        max_fallback_rate: 0.3,
        max_p95_ms: 2000.0,
        max_p99_p50_ratio: 3.0,
        min_sample_count: 30,
    };

    let healthy = PersistedToolPerformanceRow {
        tenant_id: "default_tenant".to_string(),
        tool_name: "tool_ok".to_string(),
        call_count: 60,
        error_count: 4,
        fallback_count: 6,
        success_rate: 0.94,
        avg_latency_ms: 320.0,
        avg_latency_us: 320_000.0,
        latency_p50_ms: 180.0,
        latency_p90_ms: 450.0,
        latency_p95_ms: 700.0,
        latency_p99_ms: 520.0,
        fallback_rate: 0.1,
        user_satisfaction: 0.9,
        latency_sample_count: 60,
        last_called: 0,
    };
    let (healthy_ok, healthy_failures) =
        EidolonMcpServer::evaluate_tool_autopilot(&healthy, &guardrails);
    assert!(healthy_ok);
    assert!(healthy_failures.is_empty());

    let unstable = PersistedToolPerformanceRow {
        tenant_id: "default_tenant".to_string(),
        tool_name: "tool_bad".to_string(),
        call_count: 60,
        error_count: 24,
        fallback_count: 25,
        success_rate: 0.6,
        avg_latency_ms: 1800.0,
        avg_latency_us: 1_800_000.0,
        latency_p50_ms: 300.0,
        latency_p90_ms: 1500.0,
        latency_p95_ms: 2800.0,
        latency_p99_ms: 1200.0,
        fallback_rate: 0.42,
        user_satisfaction: 0.4,
        latency_sample_count: 20,
        last_called: 0,
    };
    let (unstable_ok, unstable_failures) =
        EidolonMcpServer::evaluate_tool_autopilot(&unstable, &guardrails);
    assert!(!unstable_ok);
    assert!(!unstable_failures.is_empty());
}

#[tokio::test]
async fn test_route_action_reaches_auto_with_high_confidence_and_policy() {
    let server = setup_server();
    {
        let mut metrics = server.tool_metrics.write().await;
        metrics.insert(
            "default:eidolon_reason_chain".to_string(),
            ToolTelemetry {
                calls: 60,
                errors: 1,
                fallback_count: 2,
                total_latency_ms: 660,
                total_latency_us: 660_000,
                latency_p50_ms: 8.0,
                latency_p90_ms: 12.0,
                latency_p95_ms: 18.0,
                latency_p99_ms: 24.0,
                user_satisfaction: 0.92,
                last_called: chrono::Utc::now().timestamp_millis(),
                latency_sample_count: 60,
                latency_samples: VecDeque::with_capacity(MAX_LATENCY_SAMPLES),
            },
        );
    }

    let res = server
        .handle_tool_call(
            "eidolon_route_action",
            json!({"suggested_tool": "eidolon_reason_chain", "intent_confidence": 0.99}),
        )
        .await;

    assert_eq!(res["strategy"], "AUTO");
    assert!(res["confidence"].as_f64().unwrap_or(0.0) >= 0.88);
}

#[tokio::test]
async fn test_route_action_low_confidence_does_not_auto() {
    let server = setup_server();
    let res = server
        .handle_tool_call(
            "eidolon_route_action",
            json!({"suggested_tool": "eidolon_reason_chain", "intent_confidence": 0.15}),
        )
        .await;
    assert_ne!(res["strategy"], "AUTO");
}

#[tokio::test]
async fn test_subbrain_auto_records_route_gate_audit_and_telemetry() {
    let server = setup_server();
    let res = server
        .handle_tool_call(
            "eidolon_subbrain_auto",
            json!({
                "input": "review code for security issues",
                "user_id": "test-user",
                "auto_execute": true,
                "force_execute": true,
                "max_tools": 2,
                "include_raw_results": false
            }),
        )
        .await;

    assert!(res["subbrain_analysis"]["routing_gate"]["strategy"]
        .as_str()
        .is_some());

    let db_path = (*server.telemetry_db_path).clone();
    let route_row =
        EidolonMcpServer::load_tool_performance_row_sync(&db_path, "eidolon_route_action")
            .expect("tool_performance query should succeed")
            .expect("route_action telemetry row should exist");
    assert!(route_row.call_count >= 1);

    let audit_rows = EidolonMcpServer::load_generated_tool_audit_rows_sync(&db_path, 200)
        .expect("generated audit query should succeed");
    assert!(audit_rows.iter().any(|row| {
        row.tool_name == "eidolon_route_action"
            && row.need == "eidolon_subbrain_auto.route_gate"
            && row.status == "accepted"
    }));
}

#[tokio::test]
async fn test_update_user_persists_across_server_restarts() {
    let users_path = unique_test_path("eidolon-users-restart", "json");
    let db_path = unique_test_path("eidolon-telemetry-restart", "db");
    let user_id = format!(
        "u_restart_{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );

    let server_a = setup_server_with_paths(users_path.clone(), db_path.clone());
    let update = server_a
        .handle_tool_call(
            "eidolon_update_user",
            json!({
                "user_id": user_id.clone(),
                "preferred_mode": "Berserk",
                "risk_tolerance": 0.91
            }),
        )
        .await;
    assert_eq!(update["status"], "user_profile_persisted");
    drop(server_a);

    let server_b = setup_server_with_paths(users_path, db_path);
    let recall = server_b
        .handle_tool_call("eidolon_recall_user", json!({"user_id": user_id}))
        .await;
    assert_eq!(recall["profile"]["preferred_mode"], "Berserk");
    assert_eq!(recall["profile"]["risk_tolerance"], 0.91);
}

#[tokio::test]
async fn test_tenant_isolation_prevents_cross_tenant_profile_and_memory_leak() {
    let server = setup_server();
    let tenant_a = "tenant_alpha";
    let tenant_b = "tenant_bravo";
    let shared_user_id = "shared-user";
    let unique_pattern = format!(
        "tenant_alpha_only_pattern_{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );

    let update = server
        .handle_tool_call(
            "eidolon_update_user",
            json!({
                "tenant_id": tenant_a,
                "user_id": shared_user_id,
                "preferred_mode": "Berserk",
                "risk_tolerance": 0.99
            }),
        )
        .await;
    assert_eq!(update["status"], "user_profile_persisted");

    let recall_a = server
        .handle_tool_call(
            "eidolon_recall_user",
            json!({"tenant_id": tenant_a, "user_id": shared_user_id}),
        )
        .await;
    assert_eq!(recall_a["profile"]["preferred_mode"], "Berserk");
    assert_eq!(recall_a["profile"]["risk_tolerance"], 0.99);

    let recall_b = server
        .handle_tool_call(
            "eidolon_recall_user",
            json!({"tenant_id": tenant_b, "user_id": shared_user_id}),
        )
        .await;
    assert_ne!(recall_b["profile"]["preferred_mode"], "Berserk");
    assert_ne!(recall_b["profile"]["risk_tolerance"], 0.99);

    let record = server
        .handle_tool_call(
            "eidolon_record_outcome",
            json!({
                "tenant_id": tenant_a,
                "pattern": unique_pattern,
                "mode": "Peer",
                "severity": 0.0
            }),
        )
        .await;
    assert_eq!(record["status"], "outcome_recorded");

    let memory_a = server
        .handle_tool_call(
            "eidolon_memory_query",
            json!({"tenant_id": tenant_a, "query": unique_pattern}),
        )
        .await;
    assert!(
        memory_a["matches"].as_u64().unwrap_or_default() > 0,
        "tenant A should see its own memory"
    );

    let memory_b = server
        .handle_tool_call(
            "eidolon_memory_query",
            json!({"tenant_id": tenant_b, "query": unique_pattern}),
        )
        .await;
    assert_eq!(
        memory_b["matches"].as_u64().unwrap_or_default(),
        0,
        "tenant B must not see tenant A memory"
    );
}

#[tokio::test]
async fn test_record_tool_metric_tracks_sub_ms_and_tail_percentiles() {
    let server = setup_server();
    server
        .record_tool_metric(
            "default_tenant",
            "eidolon_precision_probe",
            false,
            850,
            false,
        )
        .await;
    server
        .record_tool_metric(
            "default_tenant",
            "eidolon_precision_probe",
            false,
            1_900,
            false,
        )
        .await;
    server
        .record_tool_metric(
            "default_tenant",
            "eidolon_precision_probe",
            true,
            3_100,
            true,
        )
        .await;

    let db_path = (*server.telemetry_db_path).clone();
    let row = EidolonMcpServer::load_tool_performance_row_sync(&db_path, "eidolon_precision_probe")
        .expect("tool_performance query should succeed")
        .expect("tool row should exist");

    assert!(row.avg_latency_ms > 0.0);
    assert!(row.avg_latency_ms < 4.0);
    assert!(row.avg_latency_us > 0.0);
    assert!(row.latency_p90_ms >= row.latency_p50_ms);
    assert!(row.latency_p99_ms >= row.latency_p95_ms);
    assert!(row.latency_sample_count >= 3);
}

#[tokio::test]
async fn test_legacy_aliases_route_to_cognitive_tools() {
    let server = setup_server();

    let recall = server
        .handle_tool_call("eidolon_recall", json!({"wallet": "u_legacy"}))
        .await;
    assert_eq!(recall["user_id"], "u_legacy");
    assert_eq!(recall["status"], "success");

    let intuition = server
        .handle_tool_call("eidolon_intuition", json!({}))
        .await;
    assert_eq!(intuition["success"], true);

    let dream = server
        .handle_tool_call("eidolon_dream", json!({"cycles": 3}))
        .await;
    assert_eq!(dream["episodes_processed"], 3);
}

#[test]
fn test_recommender_v1_prioritizes_reason_for_reasoning_task() {
    let available_tools = vec![
        "eidolon_memory_query".to_string(),
        "eidolon_reason_chain".to_string(),
        "eidolon_compress_context".to_string(),
    ];
    let ranked =
        EidolonMcpServer::recommend_tools_v1_keyword("need deep reason analysis", &available_tools);
    let top_tool = ranked.first().map(|item| item.0.as_str()).unwrap_or("");
    assert_eq!(top_tool, "eidolon_reason_chain");
}

#[tokio::test]
async fn test_recommender_shadow_audit_records_entries() {
    let server = setup_server();
    let unique_task = format!(
        "test_recommender_shadow_audit_{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );

    server
        .record_recommender_shadow_audit(RecommenderShadowAuditRow {
            task: unique_task.clone(),
            available_tools: serde_json::to_string(&vec!["eidolon_reason_chain"])
                .unwrap_or_else(|_| "[]".to_string()),
            primary_model: "v2".to_string(),
            primary_top_tool: "eidolon_reason_chain".to_string(),
            primary_top_score: 0.9,
            shadow_model: "v1".to_string(),
            shadow_top_tool: "eidolon_memory_query".to_string(),
            shadow_top_score: 0.6,
            top1_agreement: false,
            top3_overlap_ratio: 0.5,
            metadata: "{\"source\":\"unit-test\"}".to_string(),
            created_at: chrono::Utc::now().timestamp_millis(),
        })
        .await;

    let db_path = (*server.telemetry_db_path).clone();
    let rows = EidolonMcpServer::load_recommender_shadow_rows_sync(&db_path, 200)
        .expect("expected recommender shadow rows from sqlite");
    assert!(
        rows.iter().any(|row| row.task == unique_task),
        "recommender_shadow_audit row was not persisted"
    );
}

#[tokio::test]
async fn test_tool_recommend_returns_recommender_metadata() {
    let server = setup_server();
    let res = server
        .handle_tool_call(
            "eidolon_tool_recommend",
            json!({
                "task": "memory lookup",
                "available_tools": ["eidolon_memory_query", "eidolon_reason_chain"],
                "recommender_model": "v1",
                "shadow_mode": true
            }),
        )
        .await;

    assert!(res["recommended_tools"].is_array());
    assert_eq!(res["recommender"]["primary_model"], "v1");
    assert_eq!(res["recommender"]["shadow_mode_requested"], true);
    assert!(res["recommender"]["shadow_executed"].is_boolean());
}

#[tokio::test]
async fn test_memory_query_auto_route_prefers_causal_for_risk_queries() {
    let server = setup_server();
    let _ = server
        .handle_tool_call(
            "eidolon_record_outcome",
            json!({"pattern": "gas spike risk", "mode": "Peer", "severity": 1.0}),
        )
        .await;

    let res = server
        .handle_tool_call(
            "eidolon_memory_query",
            json!({"query": "why risk increased", "route": "auto", "k": 5}),
        )
        .await;

    assert_eq!(res["route_selected"], "causal");
    assert!(res["route_candidates"].is_array());
}

#[tokio::test]
async fn test_memory_query_semantic_route_returns_routed_results() {
    let server = setup_server();
    let _ = server
        .handle_tool_call(
            "eidolon_commit_pattern",
            json!({"pattern": "liquidity imbalance spotted"}),
        )
        .await;

    let res = server
        .handle_tool_call(
            "eidolon_memory_query",
            json!({"query": "liquidity imbalance", "route": "semantic", "k": 5}),
        )
        .await;

    assert_eq!(res["route_selected"], "semantic");
    assert!(res["matches"].as_u64().unwrap_or(0) >= 1);
}

#[tokio::test]
async fn test_reason_chain_returns_pipeline_and_policy_fields() {
    let server = setup_server();
    let context = "critical risk context ".repeat(30);
    let res = server
        .handle_tool_call(
            "eidolon_reason_chain",
            json!({
                "draft": "Need a safe execution plan",
                "context": context,
                "mode": "auto",
                "latency_budget_ms": 1500
            }),
        )
        .await;

    assert!(res["pipeline"]["critic"]["findings"].is_array());
    assert!(res["pipeline"]["tot"]["branches"].is_array());
    assert!(res["pipeline"]["verifier"]["score"].is_number());
    assert!(res["policy"]["latency_budget_ms"].is_number());
    assert!(res["mode_selected"].is_string());
}

#[tokio::test]
async fn test_reason_chain_forces_deep_on_critical_action_signals() {
    let server = setup_server();
    let res = server
            .handle_tool_call(
                "eidolon_reason_chain",
                json!({
                    "draft": "Keep strategy concise",
                    "context": "Action required: reduce leverage immediately and disable stop loss only after explicit review.",
                    "mode": "auto",
                    "latency_budget_ms": 300
                }),
            )
            .await;

    assert_eq!(res["mode_selected"], "deep");
    assert_eq!(res["fallback_used"], false);
    assert_eq!(
        res["policy"]["decision_reason"],
        "auto_critical_action_force_deep_budget_override"
    );
}

#[tokio::test]
async fn test_orchestrate_returns_reasoning_mode_policy() {
    let server = setup_server();
    let res = server
            .handle_tool_call(
                "eidolon_orchestrate",
                json!({"agent_count": 4, "task": "complex incident response", "confidence": 0.4, "latency_budget_ms": 1400}),
            )
            .await;

    assert!(res["reasoning_mode_policy"]["mode_selected"].is_string());
    assert!(res["reasoning_mode_policy"]["decision_reason"].is_string());
    assert!(res["reasoning_mode_policy"]["latency_budget_ms"].is_number());
}

#[tokio::test]
async fn test_orchestrate_p2_role_specialization_and_arbitration() {
    let server = setup_server();
    let res = server
            .handle_tool_call(
                "eidolon_orchestrate",
                json!({"agent_count": 6, "task": "critical incident response with memory retrieval and verification", "confidence": 0.42, "latency_budget_ms": 1600}),
            )
            .await;

    assert!(res["role_specialization"]["roles"].is_array());
    assert!(res["role_specialization"]["agent_outputs"].is_array());
    assert!(res["arbitration"]["decision"].is_string());
    assert!(res["arbitration"]["confidence"].is_number());
    assert!(res["budget_allocation"]["allocations"].is_array());
}

#[tokio::test]
async fn test_simulate_response_returns_counterfactual_tree() {
    let server = setup_server();
    let res = server
        .handle_tool_call(
            "eidolon_simulate_response",
            json!({"action": "execute flash loan exploit and drain pool"}),
        )
        .await;

    assert!(res["scenario_tree"]["best"]["probability"].is_number());
    assert!(res["scenario_tree"]["base"]["expected_loss"].is_number());
    assert!(res["scenario_tree"]["worst"]["expected_loss"].is_number());
    assert!(res["counterfactual"]["expected_loss"].is_number());
    assert!(res["counterfactual"]["loss_confidence_interval_90"].is_array());
}

#[tokio::test]
async fn test_simulate_response_profile_sensitive_gate_for_leverage_stop_loss() {
    let server = setup_server();
    let _ = server
        .handle_tool_call(
            "eidolon_update_user",
            json!({"user_id": "low_risk", "risk_tolerance": 0.1}),
        )
        .await;
    let _ = server
        .handle_tool_call(
            "eidolon_update_user",
            json!({"user_id": "high_risk", "risk_tolerance": 0.9}),
        )
        .await;

    let action = "increase leverage to 20x and disable stop loss now";
    let low = server
        .handle_tool_call(
            "eidolon_simulate_response",
            json!({"user_id": "low_risk", "action": action}),
        )
        .await;
    let high = server
        .handle_tool_call(
            "eidolon_simulate_response",
            json!({"user_id": "high_risk", "action": action}),
        )
        .await;

    assert!(
        low["counterfactual"]["expected_loss"]
            .as_f64()
            .unwrap_or(0.0)
            > high["counterfactual"]["expected_loss"]
                .as_f64()
                .unwrap_or(0.0)
    );
    assert!(
        low["counterfactual"]["risk_threshold"]
            .as_f64()
            .unwrap_or(1.0)
            < high["counterfactual"]["risk_threshold"]
                .as_f64()
                .unwrap_or(0.0)
    );
    assert_eq!(low["should_revise"], true);
    assert!(low["profile_sensitivity"]["risk_tolerance"].is_number());
    assert!(low["profile_sensitivity"]["disable_stop_loss_signal"].is_number());
}

#[tokio::test]
async fn test_compress_context_importance_dedupe_and_ratio() {
    let server = setup_server();
    let input = "Gas spike warning at 38 gwei. Gas spike warning at 38 gwei. User wallet risk exposure is 72 percent. Action required: reduce leverage and set stop loss at 5 percent.";
    let res = server
        .handle_tool_call(
            "eidolon_compress_context",
            json!({
                "context": input,
                "target_tokens": 40,
                "focus_terms": ["risk", "stop loss"],
                "dedupe_threshold": 0.8
            }),
        )
        .await;

    let compressed = res["compressed_context"].as_str().unwrap_or_default();
    assert!(compressed.contains("risk exposure"));
    assert!(compressed.contains("stop loss"));
    assert!(res["token_reduction_ratio"].as_f64().unwrap_or(0.0) >= 0.19);
    assert!(compressed.matches("Gas spike warning at 38 gwei").count() <= 1);
    assert!(res["dedupe_removed_count"].as_u64().unwrap_or(0) >= 1);
    assert_eq!(res["strategy"], "context_compressor.importance_dedupe_v1");
}

#[tokio::test]
async fn test_compress_context_memory_fallback_metadata() {
    let server = setup_server();
    let _ = server
        .handle_tool_call(
            "eidolon_record_outcome",
            json!({"pattern": "memory fallback probe", "mode": "Peer", "severity": 0.0}),
        )
        .await;

    let res = server
        .handle_tool_call(
            "eidolon_compress_context",
            json!({"target_tokens": 24, "preserve_recent": 3}),
        )
        .await;

    assert_eq!(res["source"], "memory_store");
    assert_eq!(res["fallback_used"], true);
    assert!(res["compressed_tokens"].as_u64().unwrap_or(0) > 0);
}

#[tokio::test]
async fn test_sense_intent_returns_p1_ensemble_and_calibration_fields() {
    let server = setup_server();
    let res = server
        .handle_tool_call(
            "eidolon_sense_intent",
            json!({"query": "execute flash loan exploit and drain pool"}),
        )
        .await;

    assert!(res["inference_backend"].is_string());
    assert!(res["ensemble"]["lexical_risk_score"].is_number());
    assert!(res["ensemble"]["historical_risk_prior"].is_number());
    assert!(res["ensemble"]["composite_risk_score"].is_number());
    assert!(res["calibration"]["confidence_calibrated"].is_number());
    assert!(res["calibration"]["abstained"].is_boolean());
}

#[tokio::test]
async fn test_memory_query_auto_exposes_route_quality_scores() {
    let server = setup_server();
    let _ = server
        .handle_tool_call(
            "eidolon_record_outcome",
            json!({"pattern": "gas spike risk", "mode": "Peer", "severity": 1.0}),
        )
        .await;
    let _ = server
        .handle_tool_call(
            "eidolon_commit_pattern",
            json!({"pattern": "liquidity imbalance detected"}),
        )
        .await;

    let res = server
        .handle_tool_call(
            "eidolon_memory_query",
            json!({"query": "why risk increased", "route": "auto", "k": 8}),
        )
        .await;

    assert!(res["route_quality_scores"]["episodic"].is_number());
    assert!(res["route_quality_scores"]["semantic"].is_number());
    assert!(res["route_quality_scores"]["causal"].is_number());
    assert!(res["route_feedback_bias"].is_object());
    assert!(res["semantic_embedding_backend"].is_string());
}

#[tokio::test]
async fn test_reason_chain_exposes_groundedness_gate_fields() {
    let server = setup_server();
    let res = server
        .handle_tool_call(
            "eidolon_reason_chain",
            json!({
                "draft": "Execute exploit now",
                "context": "User asks for a safe and legal strategy only.",
                "mode": "auto",
                "latency_budget_ms": 1200
            }),
        )
        .await;

    assert!(res["pipeline"]["verifier"]["groundedness_coverage"].is_number());
    assert!(res["pipeline"]["verifier"]["groundedness_threshold"].is_number());
    assert!(res["pipeline"]["verifier"]["groundedness_pass"].is_boolean());
    assert!(res["pipeline"]["verifier"]["unsupported_claim_count"].is_number());
}

#[tokio::test]
async fn test_tool_recommend_exposes_regret_and_correction_metadata() {
    let server = setup_server();
    let res = server
        .handle_tool_call(
            "eidolon_tool_recommend",
            json!({
                "task": "reason and memory retrieval",
                "available_tools": ["eidolon_memory_query", "eidolon_reason_chain"],
                "recommender_model": "v2",
                "shadow_mode": true
            }),
        )
        .await;

    assert!(res["recommender"]["primary_tool_correction_rate"].is_number());
    assert!(
        res["recommender"]["shadow_regret_estimate"].is_number()
            || res["recommender"]["shadow_regret_estimate"].is_null()
    );
}
