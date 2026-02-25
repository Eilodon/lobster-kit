// providers.rs — LLM Provider Adapter Abstraction (Phase 3)
//
// Trait chung + 3 concrete adapters: TensorOracle, Ollama (local HTTP), External (OpenAI-compat).
// Caller không cần biết provider nào đang được dùng — tất cả qua `LlmProvider::generate()`.

use crate::routing::Provider;

/// Kết quả inference từ một provider.
#[derive(Debug)]
pub enum InferenceResult {
    /// Thành công với string output.
    Ok(String),
    /// Request vượt timeout.
    Timeout,
    /// Lỗi (HTTP, IO, parse, v.v.) với message.
    Error(String),
}

/// Trait chung cho tất cả LLM providers.
/// Mỗi adapter implement trait này → caller hoàn toàn độc lập với provider cụ thể.
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    async fn generate(
        &self,
        prompt: &str,
        entropy: f32,
        trauma_severity: f32,
        is_action: bool,
    ) -> InferenceResult;

    #[allow(dead_code)]
    fn provider_name(&self) -> &'static str;
}

// ============================================
// Adapter 1: TensorOracle (Candle local inference)
// ============================================

/// Wrap `TensorOracle` thành `LlmProvider`.
#[allow(dead_code)]
pub struct TensorOracleAdapter {
    oracle: std::sync::Arc<crate::tensor_oracle::TensorOracle>,
}

#[allow(dead_code)]
impl TensorOracleAdapter {
    pub fn new(oracle: std::sync::Arc<crate::tensor_oracle::TensorOracle>) -> Self {
        Self { oracle }
    }
}

#[async_trait::async_trait]
impl LlmProvider for TensorOracleAdapter {
    async fn generate(
        &self,
        prompt: &str,
        entropy: f32,
        trauma_severity: f32,
        is_action: bool,
    ) -> InferenceResult {
        match self
            .oracle
            .generate_with_thermodynamics(prompt, entropy, trauma_severity, is_action)
            .await
        {
            Ok(text) => InferenceResult::Ok(text),
            Err(e) => InferenceResult::Error(e),
        }
    }

    fn provider_name(&self) -> &'static str {
        "tensor_oracle"
    }
}

// ============================================
// Adapter 2: Ollama (local HTTP, localhost:11434)
// ============================================

/// Wrap Ollama HTTP client thành `LlmProvider`.
pub struct OllamaAdapter {
    base_url: String,
    model: String,
}

impl OllamaAdapter {
    pub fn from_env() -> Self {
        Self {
            base_url: std::env::var("OLLAMA_URL")
                .unwrap_or_else(|_| "http://localhost:11434/api/generate".to_string()),
            model: std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "qwen3:1.7b".to_string()),
        }
    }
}

#[async_trait::async_trait]
impl LlmProvider for OllamaAdapter {
    async fn generate(
        &self,
        prompt: &str,
        _entropy: f32,
        _trauma_severity: f32,
        _is_action: bool,
    ) -> InferenceResult {
        // Dùng lại REQWEST_CLIENT từ oracle.rs
        let req = serde_json::json!({
            "model": self.model,
            "prompt": prompt,
            "stream": false
        });

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            crate::oracle::REQWEST_CLIENT
                .post(&self.base_url)
                .json(&req)
                .send(),
        )
        .await;

        match result {
            Err(_elapsed) => InferenceResult::Timeout,
            Ok(Err(e)) => InferenceResult::Error(format!("ollama_request_error: {}", e)),
            Ok(Ok(response)) => match response.json::<serde_json::Value>().await {
                Ok(json) => {
                    let text = json
                        .get("response")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    InferenceResult::Ok(text)
                }
                Err(e) => InferenceResult::Error(format!("ollama_parse_error: {}", e)),
            },
        }
    }

    fn provider_name(&self) -> &'static str {
        "ollama"
    }
}

// ============================================
// Adapter 3: External LLM (OpenAI-compatible)
// ============================================

/// Adapter cho External API theo format OpenAI `/v1/chat/completions`.
/// Hỗ trợ bất kỳ provider nào expose cùng format (Groq, Mistral, Azure OpenAI, etc.)
pub struct ExternalLlmAdapter {
    url: String,
    api_key: Option<String>,
    model: String,
    timeout_secs: u64,
}

impl ExternalLlmAdapter {
    pub fn new(url: String, api_key: Option<String>, model: String, timeout_secs: u64) -> Self {
        Self {
            url,
            api_key,
            model,
            timeout_secs,
        }
    }
}

#[async_trait::async_trait]
impl LlmProvider for ExternalLlmAdapter {
    async fn generate(
        &self,
        prompt: &str,
        entropy: f32,
        _trauma_severity: f32,
        _is_action: bool,
    ) -> InferenceResult {
        // Map entropy sang temperature (0.0–1.0)
        let temperature = (entropy as f64).clamp(0.01, 1.0);

        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "user", "content": prompt }
            ],
            "temperature": temperature
        });

        let mut request_builder = crate::oracle::REQWEST_CLIENT
            .post(&self.url)
            .header("Content-Type", "application/json");

        if let Some(api_key) = &self.api_key {
            request_builder =
                request_builder.header("Authorization", format!("Bearer {}", api_key));
        }

        let send_future = request_builder.json(&body).send();
        let timeout_duration = std::time::Duration::from_secs(self.timeout_secs);

        match tokio::time::timeout(timeout_duration, send_future).await {
            Err(_elapsed) => {
                eprintln!(
                    "[Eidolon Router] External provider TIMEOUT ({}s)",
                    self.timeout_secs
                );
                InferenceResult::Timeout
            }
            Ok(Err(e)) => {
                eprintln!("[Eidolon Router] External provider request error: {}", e);
                InferenceResult::Error(format!("external_request_error: {}", e))
            }
            Ok(Ok(response)) => {
                let status = response.status();
                // HTTP 429 = Rate Limited → caller sẽ record_failure để trip circuit
                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    eprintln!("[Eidolon Router] External provider rate limited (429)");
                    return InferenceResult::Error("external_rate_limited_429".to_string());
                }
                if !status.is_success() {
                    eprintln!("[Eidolon Router] External provider HTTP error: {}", status);
                    return InferenceResult::Error(format!(
                        "external_http_error_{}",
                        status.as_u16()
                    ));
                }
                match response.json::<serde_json::Value>().await {
                    Err(e) => {
                        eprintln!("[Eidolon Router] External provider parse error: {}", e);
                        InferenceResult::Error(format!("external_parse_error: {}", e))
                    }
                    Ok(json) => {
                        // OpenAI-compatible: choices[0].message.content
                        let content = json
                            .get("choices")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("message"))
                            .and_then(|m| m.get("content"))
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();
                        InferenceResult::Ok(content)
                    }
                }
            }
        }
    }

    fn provider_name(&self) -> &'static str {
        "external"
    }
}

// ============================================
// Provider Factory
// ============================================

/// Build provider instance từ routing decision.
/// Không clone model — dùng Arc ref từ server.
pub fn provider_name_from_decision(decision: &crate::routing::RoutingDecision) -> &'static str {
    match decision {
        crate::routing::RoutingDecision::LocalTensorOracle => "tensor_oracle",
        crate::routing::RoutingDecision::LocalOllama => "ollama",
        crate::routing::RoutingDecision::External { .. } => "external",
        crate::routing::RoutingDecision::Unavailable { .. } => "unavailable",
    }
}

/// Map InferenceResult sang Provider để record circuit breaker state.
#[allow(dead_code)]
pub fn routing_provider_from_decision(
    decision: &crate::routing::RoutingDecision,
) -> Option<Provider> {
    match decision {
        crate::routing::RoutingDecision::LocalTensorOracle => Some(Provider::TensorOracle),
        crate::routing::RoutingDecision::LocalOllama => Some(Provider::Ollama),
        crate::routing::RoutingDecision::External { .. } => Some(Provider::External),
        crate::routing::RoutingDecision::Unavailable { .. } => None,
    }
}
