use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use axum::http::Request;
use eidolon_gateway::{
    build_router, AppState, GatewayInferenceConfig, HttpInferenceRuntime, ProviderInvoker,
    ProviderRequest,
};
use eidolon_shared::auth::AuthConfig;
use eidolon_shared::output_critic::OutputCritic;
use eidolon_shared::quota::{QuotaConfig, TenantQuotaManager};
use eidolon_shared::rate_limit::{RateLimitConfig, TenantRateLimiter};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

#[derive(Default)]
struct MockProviderInvoker {
    calls: Mutex<Vec<String>>,
}

#[async_trait]
impl ProviderInvoker for MockProviderInvoker {
    async fn invoke(&self, request: ProviderRequest) -> Result<String, String> {
        self.calls
            .lock()
            .expect("calls lock")
            .push(format!("{}|{}", request.url, request.model));
        if request.url.contains("external") {
            return Ok("NaN output from external".to_string());
        }
        if request.url.contains("local") {
            return Ok("safe local fallback response".to_string());
        }
        Err("unknown_provider_url".to_string())
    }

    async fn invoke_stream(
        &self,
        request: ProviderRequest,
    ) -> Result<tokio::sync::mpsc::Receiver<Result<String, String>>, String> {
        self.calls
            .lock()
            .expect("calls lock")
            .push(format!("{}#stream|{}", request.url, request.model));
        let (tx, rx) = tokio::sync::mpsc::channel(8);
        if request.url.contains("local") {
            let _ = tx.send(Ok("safe ".to_string())).await;
            let _ = tx.send(Ok("local ".to_string())).await;
            let _ = tx.send(Ok("fallback response".to_string())).await;
            return Ok(rx);
        }
        let _ = tx
            .send(Err("mock external stream unsupported".to_string()))
            .await;
        Ok(rx)
    }
}

#[tokio::test]
async fn test_http_critic_reject_triggers_local_fallback() {
    let mut auth = AuthConfig::default();
    auth.api_keys
        .insert("test-key".to_string(), "tenant-a".to_string());
    let rate_limit = TenantRateLimiter::new(RateLimitConfig {
        capacity: 100.0,
        refill_per_sec: 100.0,
    });
    let quota = TenantQuotaManager::new(QuotaConfig {
        max_requests_per_day: 1000,
    });
    let mock_invoker = Arc::new(MockProviderInvoker::default());

    let runtime = HttpInferenceRuntime::new_with_invoker(
        GatewayInferenceConfig {
            external_enabled: true,
            external_url: "mock://external".to_string(),
            external_api_key: None,
            external_model: "external-test".to_string(),
            external_timeout_secs: 5,
            external_circuit_failure_threshold: 3,
            external_circuit_open_secs: 30,
            local_url: "mock://local".to_string(),
            local_api_key: None,
            local_model: "local-test".to_string(),
            local_timeout_secs: 5,
        },
        OutputCritic::new(true, true, 0.3),
        mock_invoker.clone(),
    );
    let state = AppState::new(auth, rate_limit, quota, 16, 10_000, Arc::new(runtime));
    let app = build_router(state);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "model": "test-model",
                "messages": [
                    {"role": "user", "content": "hello gateway"}
                ]
            })
            .to_string(),
        ))
        .expect("request");

    let response = app.oneshot(req).await.expect("gateway response");
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("json payload");

    assert_eq!(
        payload["choices"][0]["message"]["content"],
        "safe local fallback response"
    );
    assert_eq!(payload["meta"]["provider"], "local");
    assert_eq!(payload["meta"]["fallback_used"], true);
    assert!(
        payload["meta"]["fallback_reason"]
            .as_str()
            .unwrap_or_default()
            .contains("critic_reject"),
        "fallback reason should mention critic rejection"
    );
    assert_eq!(
        payload["meta"]["route_decision"],
        "external_with_local_fallback"
    );

    let calls = mock_invoker.calls.lock().expect("calls lock");
    assert_eq!(calls.len(), 2, "external then local should be invoked");
    assert!(calls[0].contains("external"));
    assert!(calls[1].contains("local"));
    assert!(
        calls[0].contains("|test-model"),
        "external should honor requested model"
    );
    assert!(
        calls[1].contains("|local-test"),
        "local fallback must stay on configured local model"
    );
}

#[tokio::test]
async fn test_http_stream_critic_reject_triggers_local_stream_fallback() {
    let mut auth = AuthConfig::default();
    auth.api_keys
        .insert("test-key".to_string(), "tenant-a".to_string());
    let rate_limit = TenantRateLimiter::new(RateLimitConfig {
        capacity: 100.0,
        refill_per_sec: 100.0,
    });
    let quota = TenantQuotaManager::new(QuotaConfig {
        max_requests_per_day: 1000,
    });
    let mock_invoker = Arc::new(MockProviderInvoker::default());

    let runtime = HttpInferenceRuntime::new_with_invoker(
        GatewayInferenceConfig {
            external_enabled: true,
            external_url: "mock://external".to_string(),
            external_api_key: None,
            external_model: "external-test".to_string(),
            external_timeout_secs: 5,
            external_circuit_failure_threshold: 3,
            external_circuit_open_secs: 30,
            local_url: "mock://local".to_string(),
            local_api_key: None,
            local_model: "local-test".to_string(),
            local_timeout_secs: 5,
        },
        OutputCritic::new(true, true, 0.3),
        mock_invoker.clone(),
    );
    let state = AppState::new(auth, rate_limit, quota, 16, 10_000, Arc::new(runtime));
    let app = build_router(state);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "model": "test-model",
                "stream": true,
                "messages": [
                    {"role": "user", "content": "hello gateway"}
                ]
            })
            .to_string(),
        ))
        .expect("request");

    let response = app.oneshot(req).await.expect("gateway response");
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body");
    let stream_text = String::from_utf8(body.to_vec()).expect("utf8 stream");

    assert!(stream_text.contains("\"content\":\"safe \""));
    assert!(stream_text.contains("\"content\":\"local \""));
    assert!(stream_text.contains("\"content\":\"fallback response\""));
    assert!(stream_text.contains("\"route_decision\":\"external_with_local_fallback\""));
    assert!(stream_text.contains("\"provider\":\"local\""));
    assert!(stream_text.contains("\"fallback_used\":true"));
    assert!(stream_text.contains("[DONE]"));

    let calls = mock_invoker.calls.lock().expect("calls lock");
    assert_eq!(
        calls.len(),
        2,
        "stream fallback path should call external once then local stream"
    );
    assert!(calls[0].contains("mock://external|test-model"));
    assert!(calls[1].contains("mock://local#stream|local-test"));
}

#[derive(Default)]
struct MockExternalErrorInvoker {
    calls: Mutex<Vec<String>>,
}

#[async_trait]
impl ProviderInvoker for MockExternalErrorInvoker {
    async fn invoke(&self, request: ProviderRequest) -> Result<String, String> {
        self.calls
            .lock()
            .expect("calls lock")
            .push(format!("{}|{}", request.url, request.model));
        if request.url.contains("external") {
            return Err("simulated_external_down".to_string());
        }
        if request.url.contains("local") {
            return Ok("safe local after external failure".to_string());
        }
        Err("unknown_provider_url".to_string())
    }

    async fn invoke_stream(
        &self,
        request: ProviderRequest,
    ) -> Result<tokio::sync::mpsc::Receiver<Result<String, String>>, String> {
        self.calls
            .lock()
            .expect("calls lock")
            .push(format!("{}#stream|{}", request.url, request.model));
        let (tx, rx) = tokio::sync::mpsc::channel(4);
        if request.url.contains("local") {
            let _ = tx.send(Ok("local stream".to_string())).await;
            return Ok(rx);
        }
        let _ = tx
            .send(Err("external stream unavailable".to_string()))
            .await;
        Ok(rx)
    }
}

#[tokio::test]
async fn test_http_external_circuit_opens_and_skips_second_external_call() {
    let mut auth = AuthConfig::default();
    auth.api_keys
        .insert("test-key".to_string(), "tenant-a".to_string());
    let rate_limit = TenantRateLimiter::new(RateLimitConfig {
        capacity: 100.0,
        refill_per_sec: 100.0,
    });
    let quota = TenantQuotaManager::new(QuotaConfig {
        max_requests_per_day: 1000,
    });
    let mock_invoker = Arc::new(MockExternalErrorInvoker::default());

    let runtime = HttpInferenceRuntime::new_with_invoker(
        GatewayInferenceConfig {
            external_enabled: true,
            external_url: "mock://external".to_string(),
            external_api_key: None,
            external_model: "external-test".to_string(),
            external_timeout_secs: 5,
            external_circuit_failure_threshold: 1,
            external_circuit_open_secs: 60,
            local_url: "mock://local".to_string(),
            local_api_key: None,
            local_model: "local-test".to_string(),
            local_timeout_secs: 5,
        },
        OutputCritic::new(true, true, 0.3),
        mock_invoker.clone(),
    );
    let state = AppState::new(auth, rate_limit, quota, 16, 10_000, Arc::new(runtime));
    let app = build_router(state);

    let first = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "model": "test-model",
                "messages": [{"role": "user", "content": "first"}]
            })
            .to_string(),
        ))
        .expect("request");
    let first_response = app.clone().oneshot(first).await.expect("first response");
    assert_eq!(first_response.status(), axum::http::StatusCode::OK);
    let first_body = to_bytes(first_response.into_body(), 1024 * 1024)
        .await
        .expect("first body");
    let first_payload: serde_json::Value =
        serde_json::from_slice(&first_body).expect("first json payload");
    assert_eq!(
        first_payload["meta"]["route_decision"],
        "external_error_local_fallback"
    );

    let second = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "model": "test-model",
                "messages": [{"role": "user", "content": "second"}]
            })
            .to_string(),
        ))
        .expect("request");
    let second_response = app.oneshot(second).await.expect("second response");
    assert_eq!(second_response.status(), axum::http::StatusCode::OK);
    let second_body = to_bytes(second_response.into_body(), 1024 * 1024)
        .await
        .expect("second body");
    let second_payload: serde_json::Value =
        serde_json::from_slice(&second_body).expect("second json payload");
    assert_eq!(
        second_payload["meta"]["route_decision"],
        "external_circuit_open_local_fallback"
    );
    assert!(
        second_payload["meta"]["fallback_reason"]
            .as_str()
            .unwrap_or_default()
            .contains("external_circuit_open"),
        "fallback reason should expose open-circuit state"
    );

    let calls = mock_invoker.calls.lock().expect("calls lock");
    assert_eq!(
        calls
            .iter()
            .filter(|line| line.contains("mock://external"))
            .count(),
        1,
        "second request should not call external while circuit is open"
    );
    assert_eq!(
        calls
            .iter()
            .filter(|line| line.contains("mock://local"))
            .count(),
        2,
        "both requests should be served by local"
    );
}
