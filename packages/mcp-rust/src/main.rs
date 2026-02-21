use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt};
use std::sync::Arc;
use tokio::sync::Mutex;
use core_rust::sentinel::causal::CausalGraph;
use core_rust::sentinel::thermo::ThermodynamicEngine;

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

        match self.client.post("https://api.deepseek.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await 
        {
            Ok(res) => {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    json["choices"][0]["message"]["content"].as_str().unwrap_or("Failed to parse").to_string()
                } else {
                    "Failed to parse JSON".to_string()
                }
            }
            Err(e) => format!("API Error: {}", e),
        }
    }
}

pub struct EidolonMcpServer {
    oracle: Arc<DeepSeekOracle>,
    causal_brain: Arc<Mutex<CausalGraph>>,
    thermo: Arc<Mutex<ThermodynamicEngine>>,
    agent_tx: tokio::sync::mpsc::Sender<core_rust::sentinel::systems::CognitiveEvent>,
}

impl EidolonMcpServer {
    pub fn new(oracle: DeepSeekOracle, tx: tokio::sync::mpsc::Sender<core_rust::sentinel::systems::CognitiveEvent>) -> Self {
        Self {
            oracle: Arc::new(oracle),
            causal_brain: Arc::new(Mutex::new(CausalGraph::new())),
            thermo: Arc::new(Mutex::new(ThermodynamicEngine::new(core_rust::sentinel::thermo::ThermoConfig::default()))),
            agent_tx: tx,
        }
    }

    pub async fn handle_tool_call(&self, method: &str, params: serde_json::Value) -> serde_json::Value {
        match method {
            "clawkit_sense_intent" => {
                let _brain = self.causal_brain.lock().await;
                // Dispatch event to Actor
                let _ = self.agent_tx.send(core_rust::sentinel::systems::CognitiveEvent::Evaluate).await;
                
                serde_json::json!({
                    "success": true,
                    "confidence": 0.95,
                    "mode": "Peer"
                })
            },
            "clawkit_oracle_query" => {
                let query = params["query"].as_str().unwrap_or("analyze");
                let insight = self.oracle.analyze(query).await;
                serde_json::json!({ "insight": insight })
            }
            _ => serde_json::json!({ "error": "Unknown tool" })
        }
    }

    pub async fn run_stdio(&self) {
        let stdin = io::stdin();
        let mut stdout = io::stdout();
        let mut reader = io::BufReader::new(stdin).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            // Very naive JSON-RPC loop
            if let Ok(req) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(method) = req["method"].as_str() {
                    let id = req["id"].clone();
                    let response = self.handle_tool_call(method, req["params"].clone()).await;
                    let result = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": response
                    });
                    if let Ok(res_str) = serde_json::to_string(&result) {
                        let _ = stdout.write_all(format!("{}\n", res_str).as_bytes()).await;
                        let _ = stdout.flush().await;
                    }
                }
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let oracle = DeepSeekOracle::new(std::env::var("DEEPSEEK_API_KEY").unwrap_or_else(|_| "dummy_key".to_string()));
    
    // Spawn the SentinelActor
    let (tx, rx) = tokio::sync::mpsc::channel(100);
    let critic = core_rust::sentinel::systems::SentinelActor::new(rx);
    tokio::spawn(async move { critic.run().await });
    
    let server = EidolonMcpServer::new(oracle, tx);
    
    server.run_stdio().await;
}
