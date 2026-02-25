use async_trait::async_trait;
use axum::extract::State;
use axum::http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use eidolon_shared::auth::{authenticate_bearer, AuthConfig, AuthError};
use eidolon_shared::observability::RouteDecisionAudit;
use eidolon_shared::output_critic::OutputCritic;
use eidolon_shared::quota::TenantQuotaManager;
use eidolon_shared::rate_limit::TenantRateLimiter;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::wrappers::ReceiverStream;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatCompletionRequest {
    pub model: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub stream: Option<bool>,
    pub tenant_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct InferenceOutcome {
    pub content: String,
    pub model: String,
    pub provider: String,
    pub route_decision: String,
    pub fallback_used: bool,
    pub fallback_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderRequest {
    pub url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub timeout_secs: u64,
    pub messages: Vec<ChatMessage>,
}

#[async_trait]
pub trait ProviderInvoker: Send + Sync {
    async fn invoke(&self, request: ProviderRequest) -> Result<String, String>;
}

struct ReqwestProviderInvoker {
    client: reqwest::Client,
}

#[async_trait]
impl ProviderInvoker for ReqwestProviderInvoker {
    async fn invoke(&self, request: ProviderRequest) -> Result<String, String> {
        if request.url.trim().is_empty() {
            return Err("provider_url_empty".to_string());
        }

        let mut req = self
            .client
            .post(&request.url)
            .timeout(Duration::from_secs(request.timeout_secs))
            .json(&json!({
                "model": request.model,
                "messages": request.messages,
                "stream": false
            }));

        if let Some(key) = request.api_key {
            req = req.bearer_auth(key);
        }

        let response = req
            .send()
            .await
            .map_err(|e| format!("provider_http_error: {}", e))?;
        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "<body_unavailable>".to_string());
            return Err(format!("provider_status={} body={}", status, body));
        }

        let payload = response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("provider_json_error: {}", e))?;
        let content = payload
            .get("choices")
            .and_then(|v| v.get(0))
            .and_then(|v| v.get("message"))
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        if content.is_empty() {
            return Err("provider_empty_content".to_string());
        }
        Ok(content)
    }
}

#[async_trait]
pub trait InferenceRuntime: Send + Sync {
    async fn generate(
        &self,
        requested_model: Option<&str>,
        messages: &[ChatMessage],
        expect_json: bool,
    ) -> Result<InferenceOutcome, String>;
}

#[derive(Debug, Clone)]
pub struct GatewayInferenceConfig {
    pub external_enabled: bool,
    pub external_url: String,
    pub external_api_key: Option<String>,
    pub external_model: String,
    pub external_timeout_secs: u64,
    pub local_url: String,
    pub local_api_key: Option<String>,
    pub local_model: String,
    pub local_timeout_secs: u64,
}

impl GatewayInferenceConfig {
    pub fn from_env() -> Self {
        let external_enabled = std::env::var("EIDOLON_GATEWAY_EXTERNAL_ENABLED")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);
        let external_url = std::env::var("EIDOLON_GATEWAY_EXTERNAL_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1/chat/completions".to_string());
        let external_api_key = std::env::var("EIDOLON_GATEWAY_EXTERNAL_API_KEY")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let external_model = std::env::var("EIDOLON_GATEWAY_EXTERNAL_MODEL")
            .unwrap_or_else(|_| "gpt-4o-mini".to_string());
        let external_timeout_secs = std::env::var("EIDOLON_GATEWAY_EXTERNAL_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(20);

        let local_url = std::env::var("EIDOLON_GATEWAY_LOCAL_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:11434/v1/chat/completions".to_string());
        let local_api_key = std::env::var("EIDOLON_GATEWAY_LOCAL_API_KEY")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let local_model = std::env::var("EIDOLON_GATEWAY_LOCAL_MODEL")
            .unwrap_or_else(|_| "qwen2.5:7b-instruct".to_string());
        let local_timeout_secs = std::env::var("EIDOLON_GATEWAY_LOCAL_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(20);

        Self {
            external_enabled,
            external_url,
            external_api_key,
            external_model,
            external_timeout_secs,
            local_url,
            local_api_key,
            local_model,
            local_timeout_secs,
        }
    }
}

pub struct HttpInferenceRuntime {
    config: GatewayInferenceConfig,
    critic: OutputCritic,
    invoker: Arc<dyn ProviderInvoker>,
}

impl HttpInferenceRuntime {
    pub fn from_env() -> Self {
        Self::new(GatewayInferenceConfig::from_env(), OutputCritic::from_env())
    }

    pub fn new(config: GatewayInferenceConfig, critic: OutputCritic) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let invoker = Arc::new(ReqwestProviderInvoker { client });
        Self::new_with_invoker(config, critic, invoker)
    }

    pub fn new_with_invoker(
        config: GatewayInferenceConfig,
        critic: OutputCritic,
        invoker: Arc<dyn ProviderInvoker>,
    ) -> Self {
        Self {
            config,
            critic,
            invoker,
        }
    }

    async fn call_openai_compat(
        &self,
        url: &str,
        api_key: Option<&str>,
        model: &str,
        timeout_secs: u64,
        messages: &[ChatMessage],
    ) -> Result<String, String> {
        self.invoker
            .invoke(ProviderRequest {
                url: url.to_string(),
                api_key: api_key.map(|v| v.to_string()),
                model: model.to_string(),
                timeout_secs,
                messages: messages.to_vec(),
            })
            .await
    }

    fn compact_reason(raw: &str) -> String {
        let mut compact = raw.replace('\n', " ");
        if compact.len() > 180 {
            compact.truncate(180);
        }
        compact
    }
}

#[async_trait]
impl InferenceRuntime for HttpInferenceRuntime {
    async fn generate(
        &self,
        requested_model: Option<&str>,
        messages: &[ChatMessage],
        expect_json: bool,
    ) -> Result<InferenceOutcome, String> {
        let requested_model = requested_model
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(str::to_string);
        let external_model = requested_model
            .clone()
            .unwrap_or_else(|| self.config.external_model.clone());
        let local_model = requested_model.unwrap_or_else(|| self.config.local_model.clone());

        if self.config.external_enabled {
            match self
                .call_openai_compat(
                    &self.config.external_url,
                    self.config.external_api_key.as_deref(),
                    &external_model,
                    self.config.external_timeout_secs,
                    messages,
                )
                .await
            {
                Ok(external_text) => {
                    let verdict = self
                        .critic
                        .evaluate(&external_text, expect_json, "external");
                    if verdict.passed {
                        return Ok(InferenceOutcome {
                            content: external_text,
                            model: external_model,
                            provider: "external".to_string(),
                            route_decision: "external_direct".to_string(),
                            fallback_used: false,
                            fallback_reason: None,
                        });
                    }

                    let reason = format!(
                        "critic_reject:score={:.2},violations={}",
                        verdict.score,
                        verdict.violations.len()
                    );
                    let local_text = self
                        .call_openai_compat(
                            &self.config.local_url,
                            self.config.local_api_key.as_deref(),
                            &local_model,
                            self.config.local_timeout_secs,
                            messages,
                        )
                        .await
                        .map_err(|e| {
                            format!(
                                "critic_rejected_external_then_local_failed:{}",
                                Self::compact_reason(&e)
                            )
                        })?;
                    return Ok(InferenceOutcome {
                        content: local_text,
                        model: local_model,
                        provider: "local".to_string(),
                        route_decision: "external_with_local_fallback".to_string(),
                        fallback_used: true,
                        fallback_reason: Some(reason),
                    });
                }
                Err(external_err) => {
                    let local_text = self
                        .call_openai_compat(
                            &self.config.local_url,
                            self.config.local_api_key.as_deref(),
                            &local_model,
                            self.config.local_timeout_secs,
                            messages,
                        )
                        .await
                        .map_err(|e| {
                            format!(
                                "external_failed_then_local_failed: external={} local={}",
                                Self::compact_reason(&external_err),
                                Self::compact_reason(&e)
                            )
                        })?;
                    return Ok(InferenceOutcome {
                        content: local_text,
                        model: local_model,
                        provider: "local".to_string(),
                        route_decision: "external_error_local_fallback".to_string(),
                        fallback_used: true,
                        fallback_reason: Some(format!(
                            "external_error:{}",
                            Self::compact_reason(&external_err)
                        )),
                    });
                }
            }
        }

        let local_text = self
            .call_openai_compat(
                &self.config.local_url,
                self.config.local_api_key.as_deref(),
                &local_model,
                self.config.local_timeout_secs,
                messages,
            )
            .await
            .map_err(|e| format!("local_provider_failed:{}", Self::compact_reason(&e)))?;

        Ok(InferenceOutcome {
            content: local_text,
            model: local_model,
            provider: "local".to_string(),
            route_decision: "local_only".to_string(),
            fallback_used: false,
            fallback_reason: None,
        })
    }
}

#[derive(Clone)]
pub struct AppState {
    auth: Arc<AuthConfig>,
    rate_limiter: Arc<TenantRateLimiter>,
    quota_manager: Arc<TenantQuotaManager>,
    stream_channel_capacity: usize,
    stream_timeout_ms: u64,
    runtime: Arc<dyn InferenceRuntime>,
}

impl AppState {
    pub fn from_env() -> Self {
        let stream_channel_capacity = std::env::var("EIDOLON_GATEWAY_STREAM_CHANNEL_CAPACITY")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(32);
        let stream_timeout_ms = std::env::var("EIDOLON_GATEWAY_STREAM_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(30_000);

        Self::new(
            AuthConfig::from_env(),
            TenantRateLimiter::from_env(),
            TenantQuotaManager::from_env(),
            stream_channel_capacity,
            stream_timeout_ms,
            Arc::new(HttpInferenceRuntime::from_env()),
        )
    }

    pub fn new(
        auth: AuthConfig,
        rate_limiter: TenantRateLimiter,
        quota_manager: TenantQuotaManager,
        stream_channel_capacity: usize,
        stream_timeout_ms: u64,
        runtime: Arc<dyn InferenceRuntime>,
    ) -> Self {
        Self {
            auth: Arc::new(auth),
            rate_limiter: Arc::new(rate_limiter),
            quota_manager: Arc::new(quota_manager),
            stream_channel_capacity,
            stream_timeout_ms,
            runtime,
        }
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/chat/completions", post(chat_completions))
        .with_state(state)
}

pub async fn run_server(bind: &str, state: AppState) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|e| format!("bind_error: {}", e))?;
    eprintln!("[eidolon-gateway] listening on {}", bind);
    axum::serve(listener, build_router(state))
        .await
        .map_err(|e| format!("server_error: {}", e))
}

pub async fn run_from_env() -> Result<(), String> {
    let bind =
        std::env::var("EIDOLON_GATEWAY_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    run_server(&bind, AppState::from_env()).await
}

async fn healthz() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "service": "eidolon-gateway",
        "timestamp_ms": chrono::Utc::now().timestamp_millis()
    }))
}

async fn chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChatCompletionRequest>,
) -> Response {
    let started = std::time::Instant::now();
    let auth_context = match authenticate_bearer(
        headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok()),
        &state.auth,
    ) {
        Ok(ctx) => ctx,
        Err(err) => return auth_error_response(err),
    };

    let tenant_id = match req.tenant_id.as_deref() {
        Some(explicit) if explicit != auth_context.tenant_id => {
            return error_response(
                StatusCode::FORBIDDEN,
                "tenant_forbidden",
                "tenant_id does not match authenticated principal",
            );
        }
        Some(explicit) => explicit.to_string(),
        None => auth_context.tenant_id.clone(),
    };

    let quota = state.quota_manager.consume(&tenant_id);
    if !quota.allowed {
        return error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "quota_exceeded",
            "Daily tenant quota exceeded",
        );
    }

    let rl = state.rate_limiter.check_and_consume(&tenant_id, 1.0);
    if !rl.allowed {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error": {
                    "code": "rate_limited",
                    "message": "Tenant rate limit exceeded",
                    "retry_after_ms": rl.retry_after_ms
                }
            })),
        )
            .into_response();
    }

    let expect_json = request_expects_json(&req.messages);
    let outcome = match state
        .runtime
        .generate(req.model.as_deref(), &req.messages, expect_json)
        .await
    {
        Ok(outcome) => outcome,
        Err(err) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                "inference_failed",
                &format!("all providers failed: {}", err),
            );
        }
    };

    let stream = req.stream.unwrap_or(false);
    if stream {
        return stream_completion_response(
            &state,
            tenant_id,
            outcome,
            started,
            rl.remaining_tokens,
        );
    }

    let audit = RouteDecisionAudit::new(
        tenant_id,
        outcome.provider.clone(),
        outcome.route_decision.clone(),
        outcome.fallback_used,
        outcome.fallback_reason.clone(),
        started.elapsed().as_millis(),
        "ok",
    );
    eprintln!("[eidolon-gateway][audit] {}", audit.to_json());

    Json(json!({
        "id": format!("chatcmpl-{}", chrono::Utc::now().timestamp_millis()),
        "object": "chat.completion",
        "created": chrono::Utc::now().timestamp(),
        "model": outcome.model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": outcome.content
            },
            "finish_reason": "stop"
        }],
        "usage": {
            "prompt_tokens": req.messages.len() * 8,
            "completion_tokens": 32,
            "total_tokens": req.messages.len() * 8 + 32
        },
        "meta": {
            "principal": auth_context.principal,
            "provider": outcome.provider,
            "route_decision": outcome.route_decision,
            "fallback_used": outcome.fallback_used,
            "fallback_reason": outcome.fallback_reason,
            "rate_limit_remaining": rl.remaining_tokens,
            "quota_remaining": quota.remaining
        }
    }))
    .into_response()
}

fn stream_completion_response(
    state: &AppState,
    tenant_id: String,
    outcome: InferenceOutcome,
    started: std::time::Instant,
    remaining_tokens: f64,
) -> Response {
    let (tx, rx) =
        tokio::sync::mpsc::channel::<Result<Event, Infallible>>(state.stream_channel_capacity);
    let timeout_ms = state.stream_timeout_ms;

    tokio::spawn(async move {
        let stream_task = async {
            let words: Vec<&str> = outcome.content.split_whitespace().collect();
            for word in words {
                let chunk = json!({
                    "id": format!("chatcmpl-{}", chrono::Utc::now().timestamp_millis()),
                    "object": "chat.completion.chunk",
                    "created": chrono::Utc::now().timestamp(),
                    "model": outcome.model,
                    "choices": [{
                        "index": 0,
                        "delta": {
                            "role": "assistant",
                            "content": format!("{} ", word)
                        },
                        "finish_reason": serde_json::Value::Null
                    }]
                });
                if tx
                    .send(Ok(Event::default().data(chunk.to_string())))
                    .await
                    .is_err()
                {
                    return "cancelled";
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }

            let final_chunk = json!({
                "id": format!("chatcmpl-{}", chrono::Utc::now().timestamp_millis()),
                "object": "chat.completion.chunk",
                "created": chrono::Utc::now().timestamp(),
                "model": outcome.model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop"
                }],
                "meta": {
                    "provider": outcome.provider,
                    "route_decision": outcome.route_decision,
                    "fallback_used": outcome.fallback_used,
                    "fallback_reason": outcome.fallback_reason,
                    "rate_limit_remaining": remaining_tokens
                }
            });
            let _ = tx
                .send(Ok(Event::default().data(final_chunk.to_string())))
                .await;
            let _ = tx.send(Ok(Event::default().data("[DONE]"))).await;
            "ok"
        };

        let status =
            match tokio::time::timeout(Duration::from_millis(timeout_ms), stream_task).await {
                Ok(state) => state,
                Err(_) => {
                    let timeout_chunk = json!({
                        "error": {
                            "code": "stream_timeout",
                            "message": format!("stream exceeded timeout of {}ms", timeout_ms)
                        }
                    });
                    let _ = tx
                        .send(Ok(Event::default().data(timeout_chunk.to_string())))
                        .await;
                    let _ = tx.send(Ok(Event::default().data("[DONE]"))).await;
                    "timeout"
                }
            };

        let timeout_fallback = if status == "timeout" {
            Some(format!("stream_timeout:{}ms", timeout_ms))
        } else {
            outcome.fallback_reason
        };
        let audit = RouteDecisionAudit::new(
            tenant_id,
            outcome.provider,
            outcome.route_decision,
            outcome.fallback_used || status == "timeout",
            timeout_fallback,
            started.elapsed().as_millis(),
            status,
        );
        eprintln!("[eidolon-gateway][audit] {}", audit.to_json());
    });

    Sse::new(ReceiverStream::new(rx))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keep-alive"),
        )
        .into_response()
}

fn request_expects_json(messages: &[ChatMessage]) -> bool {
    messages.iter().any(|msg| {
        msg.content.to_ascii_lowercase().contains("json")
            || msg.content.contains("factual_consistency")
    })
}

fn auth_error_response(err: AuthError) -> Response {
    match err {
        AuthError::MissingAuthorization | AuthError::InvalidAuthorization => error_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Missing or invalid Authorization header",
        ),
        AuthError::Unauthorized => {
            error_response(StatusCode::FORBIDDEN, "forbidden", "Invalid API key or JWT")
        }
    }
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({
            "error": {
                "code": code,
                "message": message
            }
        })),
    )
        .into_response()
}
