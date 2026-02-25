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
            .push(request.url.clone());
        if request.url.contains("external") {
            return Ok("NaN output from external".to_string());
        }
        if request.url.contains("local") {
            return Ok("safe local fallback response".to_string());
        }
        Err("unknown_provider_url".to_string())
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
}
