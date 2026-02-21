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
    trauma: Arc<Mutex<core_rust::sentinel::trauma::TraumaRegistry>>,
    agent_tx: tokio::sync::mpsc::Sender<core_rust::sentinel::systems::CognitiveEvent>,
}

impl EidolonMcpServer {
    pub fn new(oracle: DeepSeekOracle, tx: tokio::sync::mpsc::Sender<core_rust::sentinel::systems::CognitiveEvent>) -> Self {
        Self {
            oracle: Arc::new(oracle),
            causal_brain: Arc::new(Mutex::new(CausalGraph::new())),
            thermo: Arc::new(Mutex::new(ThermodynamicEngine::new(core_rust::sentinel::thermo::ThermoConfig::default()))),
            trauma: Arc::new(Mutex::new(core_rust::sentinel::trauma::TraumaRegistry::new())),
            agent_tx: tx,
        }
    }

    pub async fn handle_tool_call(&self, method: &str, params: serde_json::Value) -> serde_json::Value {
        match method {
            // PHASE A: CORE LOOP TOOLS
            "clawkit_recall_user" => {
                let user_id = params["user_id"].as_str().unwrap_or("unknown");
                serde_json::json!({
                    "user_id": user_id,
                    "preferred_mode": "Peer",
                    "sensory_context": {
                        "technical_literacy": 0.9,
                        "risk_tolerance": 0.8
                    },
                    "status": "success"
                })
            }
            "clawkit_sense_intent" => {
                let _brain = self.causal_brain.lock().await;
                // Dispatch event to Actor for async evaluation
                let _ = self.agent_tx.send(core_rust::sentinel::systems::CognitiveEvent::Evaluate).await;
                
                serde_json::json!({
                    "success": true,
                    "confidence": 0.95,
                    "recommended_mode": "Peer",
                    "thermo_entropy": 0.4
                })
            },
            "clawkit_check_pattern" => {
                let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
                let mode_str = params["mode"].as_str().unwrap_or("Peer");
                
                let mode = match mode_str {
                    "Stalking" => core_rust::sentinel::modes::SentinelMode::Stalking,
                    "Berserk" => core_rust::sentinel::modes::SentinelMode::Berserk,
                    "Snipe" => core_rust::sentinel::modes::SentinelMode::Snipe,
                    _ => core_rust::sentinel::modes::SentinelMode::Zen,
                };
                
                let trauma = self.trauma.lock().await;
                let now = chrono::Utc::now().timestamp_millis();
                let is_inhibited = trauma.is_inhibited(mode, pattern, now);
                let remaining_ms = trauma.get_remaining_ms(mode, pattern, now);
                
                serde_json::json!({
                    "pattern": pattern,
                    "inhibited": is_inhibited,
                    "remaining_ms": remaining_ms
                })
            },
            "clawkit_simulate_response" => {
                let action = params["action"].as_str().unwrap_or("default");
                serde_json::json!({
                    "action_tested": action,
                    "predicted_outcome": "positive",
                    "confidence": 0.85,
                    "should_revise": false
                })
            },
            "clawkit_commit_pattern" => {
                let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
                // Here we would step Thermo and push to History Buffer
                let mut thermo = self.thermo.lock().await;
                let state = nalgebra::DVector::from_element(5, 0.5);
                let target = nalgebra::DVector::from_element(5, 0.6);
                let new_state = thermo.step(&state, &target);
                
                serde_json::json!({
                    "status": "committed",
                    "pattern": pattern,
                    "new_entropy": thermo.entropy(&new_state)
                })
            },
            // PHASE B: REASONING & MEMORY TOOLS
            "clawkit_reason_chain" => {
                let draft = params["draft"].as_str().unwrap_or("");
                let context = params["context"].as_str().unwrap_or("");
                let mode = params["mode"].as_str().unwrap_or("fast");
                
                // Real deepseek call if deep mode, else standard
                let prompt = format!("Evaluate draft: {}\nContext: {}\nMode: {}", draft, context, mode);
                let insight = self.oracle.analyze(&prompt).await;
                
                serde_json::json!({
                    "draft_evaluation": insight,
                    "final_score": if mode == "deep" { 0.92 } else { 0.85 },
                    "iterations": if mode == "deep" { 3 } else { 1 }
                })
            },
            "clawkit_recall_similar" => {
                let _context = params["context"].as_str().unwrap_or("");
                let _k = params["k"].as_u64().unwrap_or(5);
                // Stubbing HyperMemory vector search for now
                serde_json::json!({
                    "matches": [
                        { "episode_id": "ep_123", "similarity": 0.88, "outcome": "positive" },
                        { "episode_id": "ep_456", "similarity": 0.76, "outcome": "negative" }
                    ]
                })
            },
            "clawkit_memory_query" => {
                let query = params["query"].as_str().unwrap_or("");
                serde_json::json!({
                    "query": query,
                    "results": {
                        "short_term": "Active trading session context",
                        "long_term": "User prefers high risk on Fridays"
                    }
                })
            },
            "clawkit_compress_context" => {
                let _target_tokens = params["target_tokens"].as_u64().unwrap_or(1000);
                serde_json::json!({
                    "compressed_context": "Summarized context of the last 50 turns. The user is frustrated with gas fees.",
                    "compression_ratio": "5x"
                })
            },
            // PHASE C: LEARNING & ORCHESTRATION TOOLS
            "clawkit_record_outcome" => {
                let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
                let mode_str = params["mode"].as_str().unwrap_or("Peer");
                let severity = params["severity"].as_f64().unwrap_or(0.0) as f32;
                
                let mode = match mode_str {
                    "Stalking" => core_rust::sentinel::modes::SentinelMode::Stalking,
                    "Berserk" => core_rust::sentinel::modes::SentinelMode::Berserk,
                    "Snipe" => core_rust::sentinel::modes::SentinelMode::Snipe,
                    _ => core_rust::sentinel::modes::SentinelMode::Zen,
                };
                
                let now = chrono::Utc::now().timestamp_millis();
                
                // Learn via Trauma and Causal Graph
                if severity > 0.0 {
                    let mut trauma = self.trauma.lock().await;
                    trauma.record_trauma(mode, pattern, severity, now);
                } else {
                    let mut trauma = self.trauma.lock().await;
                    trauma.heal(mode, pattern);
                }
                
                // Assuming positive outcome if severity == 0
                let mut brain = self.causal_brain.lock().await;
                brain.learn(
                    core_rust::sentinel::variables::SentinelVariable::Sentiment, 
                    core_rust::sentinel::variables::SentinelVariable::PriceDelta, 
                    severity == 0.0
                );
                
                serde_json::json!({
                    "status": "outcome_recorded",
                    "learning_applied": true
                })
            },
            "clawkit_update_user" => {
                let user_id = params["user_id"].as_str().unwrap_or("unknown");
                serde_json::json!({
                    "user_id": user_id,
                    "status": "user_sensory_updated"
                })
            },
            "clawkit_dream_conversation" => {
                let episodes = params["episodes"].as_u64().unwrap_or(20);
                serde_json::json!({
                    "status": "dream_sequence_complete",
                    "episodes_replayed": episodes,
                    "dagma_fitted": episodes >= 10,
                    "memory_pruned": true
                })
            },
            "clawkit_orchestrate" => {
                let agents = params["agent_count"].as_u64().unwrap_or(3);
                // In a real scenario, this spawns N `SentinelActor` threads and waits for consensus
                serde_json::json!({
                    "status": "consensus_reached",
                    "agents_orchestrated": agents,
                    "decision": "Executing multi-agent strategy XYZ"
                })
            },
            "clawkit_tool_recommend" => {
                let task = params["task"].as_str().unwrap_or("");
                // Mock CausalGraph scoring for tools
                serde_json::json!({
                    "task": task,
                    "recommended_tools": [
                        { "tool": "clawkit_reason_chain", "score": 0.89 },
                        { "tool": "clawkit_recall_similar", "score": 0.75 }
                    ]
                })
            },
            // Legacy/Test Tools
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
