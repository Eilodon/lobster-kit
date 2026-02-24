// oracle.rs — DeepSeek and Ollama LLM client abstractions
//
// Extracted from main.rs. DeepSeek is the primary oracle (cloud API),
// Ollama is the local fallback (for reason_chain).
// Note: There is a separate TypeScript DeepSeekOracle in packages/soul/src/ai/
// which implements IOracle. This Rust version is specifically for the MCP server's
// direct HTTP communication with LLM APIs.

use std::time::Duration;

// DeepSeekOracle abstraction with reqwest
#[derive(Clone)]
pub struct DeepSeekOracle {
    pub api_key: String,
    pub client: reqwest::Client,
}

impl DeepSeekOracle {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
    }

    pub async fn analyze(&self, context: &str) -> String {
        // Actual HTTP request to DeepSeek API
        let payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [
                { "role": "system", "content": "You are Eidolon-V Oracle." },
                { "role": "user", "content": context }
            ],
            "temperature": 0.1
        });

        match self
            .client
            .post("https://api.deepseek.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
        {
            Ok(res) => {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    json["choices"][0]["message"]["content"]
                        .as_str()
                        .unwrap_or("Failed to parse")
                        .to_string()
                } else {
                    "Failed to parse JSON".to_string()
                }
            }
            Err(e) => format!("API Error: {}", e),
        }
    }
}

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
}

#[derive(serde::Deserialize)]
pub struct OllamaResponse {
    pub response: String,
}

pub async fn query_local_llm(prompt: &str) -> String {
    let req = OllamaRequest {
        model: std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "deepseek-coder-v2:16b".to_string()),
        prompt: prompt.to_string(),
        stream: false,
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
