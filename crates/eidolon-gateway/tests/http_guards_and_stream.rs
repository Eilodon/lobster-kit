use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use eidolon_gateway::{
    build_router, AppState, InferenceOutcome, InferenceRuntime, InferenceStreamOutcome,
};
use eidolon_shared::auth::AuthConfig;
use eidolon_shared::quota::{QuotaConfig, TenantQuotaManager};
use eidolon_shared::rate_limit::{RateLimitConfig, TenantRateLimiter};
use serde_json::json;
use std::sync::Arc;
use tower::ServiceExt;

struct StaticRuntime;

#[async_trait]
impl InferenceRuntime for StaticRuntime {
    async fn generate(
        &self,
        _requested_model: Option<&str>,
        _messages: &[eidolon_gateway::ChatMessage],
        _expect_json: bool,
    ) -> Result<InferenceOutcome, String> {
        Ok(InferenceOutcome {
            content: "static response".to_string(),
            model: "local-test".to_string(),
            provider: "local".to_string(),
            route_decision: "local_only".to_string(),
            fallback_used: false,
            fallback_reason: None,
        })
    }

    async fn generate_stream(
        &self,
        _requested_model: Option<&str>,
        _messages: &[eidolon_gateway::ChatMessage],
        _expect_json: bool,
        stream_channel_capacity: usize,
    ) -> Result<InferenceStreamOutcome, String> {
        let (tx, rx) = tokio::sync::mpsc::channel(stream_channel_capacity.max(1));
        tokio::spawn(async move {
            let _ = tx.send(Ok("chunk-1".to_string())).await;
            let _ = tx.send(Ok("chunk-2".to_string())).await;
        });

        Ok(InferenceStreamOutcome {
            chunks: rx,
            model: "local-test".to_string(),
            provider: "local".to_string(),
            route_decision: "local_only".to_string(),
            fallback_used: false,
            fallback_reason: None,
        })
    }
}

fn build_state(
    auth: AuthConfig,
    rate_limit: RateLimitConfig,
    quota: QuotaConfig,
    stream_timeout_ms: u64,
) -> AppState {
    AppState::new(
        auth,
        TenantRateLimiter::new(rate_limit),
        TenantQuotaManager::new(quota),
        16,
        stream_timeout_ms,
        Arc::new(StaticRuntime),
    )
}

fn request_payload(stream: bool, tenant_id: Option<&str>) -> String {
    let mut payload = json!({
        "model": "gpt-4o-mini",
        "stream": stream,
        "messages": [{"role": "user", "content": "hello"}]
    });
    if let Some(tenant) = tenant_id {
        payload["tenant_id"] = json!(tenant);
    }
    payload.to_string()
}

#[tokio::test]
async fn test_http_missing_auth_rejected() {
    let mut auth = AuthConfig::default();
    auth.api_keys
        .insert("test-key".to_string(), "tenant-a".to_string());
    let app = build_router(build_state(
        auth,
        RateLimitConfig {
            capacity: 100.0,
            refill_per_sec: 100.0,
        },
        QuotaConfig {
            max_requests_per_day: 100,
        },
        10_000,
    ));

    let req = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("content-type", "application/json")
        .body(Body::from(request_payload(false, None)))
        .expect("request");

    let response = app.oneshot(req).await.expect("response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("json payload");
    assert_eq!(payload["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn test_http_tenant_mismatch_rejected() {
    let mut auth = AuthConfig::default();
    auth.api_keys
        .insert("test-key".to_string(), "tenant-a".to_string());
    let app = build_router(build_state(
        auth,
        RateLimitConfig {
            capacity: 100.0,
            refill_per_sec: 100.0,
        },
        QuotaConfig {
            max_requests_per_day: 100,
        },
        10_000,
    ));

    let req = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(request_payload(false, Some("tenant-b"))))
        .expect("request");

    let response = app.oneshot(req).await.expect("response");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("json payload");
    assert_eq!(payload["error"]["code"], "tenant_forbidden");
}

#[tokio::test]
async fn test_http_quota_exceeded_rejected() {
    let mut auth = AuthConfig::default();
    auth.api_keys
        .insert("test-key".to_string(), "tenant-a".to_string());
    let app = build_router(build_state(
        auth,
        RateLimitConfig {
            capacity: 100.0,
            refill_per_sec: 100.0,
        },
        QuotaConfig {
            max_requests_per_day: 1,
        },
        10_000,
    ));

    let first = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(request_payload(false, None)))
        .expect("request");
    let first_res = app.clone().oneshot(first).await.expect("first response");
    assert_eq!(first_res.status(), StatusCode::OK);

    let second = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(request_payload(false, None)))
        .expect("request");
    let second_res = app.oneshot(second).await.expect("second response");
    assert_eq!(second_res.status(), StatusCode::TOO_MANY_REQUESTS);

    let body = to_bytes(second_res.into_body(), 1024 * 1024)
        .await
        .expect("response body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("json payload");
    assert_eq!(payload["error"]["code"], "quota_exceeded");
}

#[tokio::test]
async fn test_http_rate_limited_rejected() {
    let mut auth = AuthConfig::default();
    auth.api_keys
        .insert("test-key".to_string(), "tenant-a".to_string());
    let app = build_router(build_state(
        auth,
        RateLimitConfig {
            capacity: 1.0,
            refill_per_sec: 0.1,
        },
        QuotaConfig {
            max_requests_per_day: 100,
        },
        10_000,
    ));

    let first = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(request_payload(false, None)))
        .expect("request");
    let first_res = app.clone().oneshot(first).await.expect("first response");
    assert_eq!(first_res.status(), StatusCode::OK);

    let second = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(request_payload(false, None)))
        .expect("request");
    let second_res = app.oneshot(second).await.expect("second response");
    assert_eq!(second_res.status(), StatusCode::TOO_MANY_REQUESTS);

    let body = to_bytes(second_res.into_body(), 1024 * 1024)
        .await
        .expect("response body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("json payload");
    assert_eq!(payload["error"]["code"], "rate_limited");
    assert!(payload["error"]["retry_after_ms"].as_u64().unwrap_or(0) > 0);
}

#[tokio::test]
async fn test_http_stream_passthrough_from_runtime_chunks() {
    let mut auth = AuthConfig::default();
    auth.api_keys
        .insert("test-key".to_string(), "tenant-a".to_string());
    let app = build_router(build_state(
        auth,
        RateLimitConfig {
            capacity: 100.0,
            refill_per_sec: 100.0,
        },
        QuotaConfig {
            max_requests_per_day: 100,
        },
        10_000,
    ));

    let req = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header("authorization", "Bearer test-key")
        .header("content-type", "application/json")
        .body(Body::from(request_payload(true, None)))
        .expect("request");

    let response = app.oneshot(req).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body");
    let text = String::from_utf8(body.to_vec()).expect("utf8 body");

    assert!(text.contains("\"content\":\"chunk-1\""));
    assert!(text.contains("\"content\":\"chunk-2\""));
    assert!(text.contains("\"route_decision\":\"local_only\""));
    assert!(text.contains("[DONE]"));
}
