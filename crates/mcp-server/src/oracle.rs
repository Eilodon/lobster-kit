// oracle.rs — Local LLM fallback helpers.
//
// The Rust MCP runtime is local-first (TensorOracle via Candle). This module only
// provides optional HTTP fallback for environments that still expose an Ollama endpoint.

use std::time::Duration;

lazy_static::lazy_static! {
    pub static ref REQWEST_CLIENT: reqwest::Client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();
}

#[derive(serde::Serialize)]
pub struct OllamaRequest {
    pub model: String,
    pub prompt: String,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<serde_json::Value>,
}

#[derive(serde::Deserialize)]
pub struct OllamaResponse {
    pub response: String,
}

pub async fn query_local_llm(prompt: &str) -> String {
    query_local_llm_with_temp(prompt, None).await
}

pub async fn query_local_llm_with_temp(prompt: &str, temp_override: Option<f64>) -> String {
    let options = temp_override.map(|t| serde_json::json!({ "temperature": t }));

    let req = OllamaRequest {
        model: std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "qwen3:1.7b".to_string()),
        prompt: prompt.to_string(),
        stream: false,
        options,
    };

    let url = std::env::var("OLLAMA_URL")
        .unwrap_or_else(|_| "http://localhost:11434/api/generate".to_string());

    match REQWEST_CLIENT.post(&url).json(&req).send().await {
        Ok(res) => {
            if let Ok(json) = res.json::<OllamaResponse>().await {
                json.response
            } else {
                "".to_string()
            }
        }
        Err(_) => "".to_string(),
    }
}
