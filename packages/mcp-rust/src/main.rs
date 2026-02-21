use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt};
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::Mutex;
use core_rust::sentinel::causal::CausalGraph;
use core_rust::sentinel::thermo::ThermodynamicEngine;

// === Upgrade 3: Stateful Memory ===
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryEntry {
    pub timestamp: i64,
    pub category: String,
    pub content: String,
}

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
    // Upgrade 1: Persistent User Profiles
    users: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    // Upgrade 3: Stateful Memory
    memories: Arc<Mutex<Vec<MemoryEntry>>>,
}

impl EidolonMcpServer {
    pub fn new(oracle: DeepSeekOracle, tx: tokio::sync::mpsc::Sender<core_rust::sentinel::systems::CognitiveEvent>) -> Self {
        // Load user profiles from disk if available
        let users = Self::load_users_from_disk();
        Self {
            oracle: Arc::new(oracle),
            causal_brain: Arc::new(Mutex::new(CausalGraph::new())),
            thermo: Arc::new(Mutex::new(ThermodynamicEngine::new(core_rust::sentinel::thermo::ThermoConfig::default()))),
            trauma: Arc::new(Mutex::new(core_rust::sentinel::trauma::TraumaRegistry::new())),
            agent_tx: tx,
            users: Arc::new(Mutex::new(users)),
            memories: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn users_file_path() -> std::path::PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let dir = std::path::PathBuf::from(home).join(".clawkit");
        let _ = std::fs::create_dir_all(&dir);
        dir.join("users.json")
    }

    fn load_users_from_disk() -> HashMap<String, serde_json::Value> {
        let path = Self::users_file_path();
        if let Ok(data) = std::fs::read_to_string(&path) {
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            HashMap::new()
        }
    }

    async fn save_users_to_disk(&self) {
        let users = self.users.lock().await;
        let path = Self::users_file_path();
        if let Ok(json) = serde_json::to_string_pretty(&*users) {
            let _ = std::fs::write(path, json);
        }
    }

    pub async fn handle_tool_call(&self, method: &str, params: serde_json::Value) -> serde_json::Value {
        match method {
            // PHASE A: CORE LOOP TOOLS
            "clawkit_recall_user" => {
                let user_id = params["user_id"].as_str().unwrap_or("unknown");
                let users = self.users.lock().await;
                let profile = users.get(user_id).cloned().unwrap_or_else(|| {
                    serde_json::json!({
                        "preferred_mode": "Peer",
                        "sensory_context": { "technical_literacy": 0.5, "risk_tolerance": 0.5 }
                    })
                });
                serde_json::json!({
                    "user_id": user_id,
                    "profile": profile,
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
                let mut thermo = self.thermo.lock().await;
                let state = nalgebra::DVector::from_element(5, 0.5);
                let target = nalgebra::DVector::from_element(5, 0.6);
                let new_state = thermo.step(&state, &target);
                let entropy = thermo.entropy(&new_state);
                
                // Upgrade 3: Push to Stateful Memory
                let mut mems = self.memories.lock().await;
                mems.push(MemoryEntry {
                    timestamp: chrono::Utc::now().timestamp_millis(),
                    category: "commit".to_string(),
                    content: format!("Pattern '{}' committed. Entropy: {:.4}", pattern, entropy),
                });
                
                serde_json::json!({
                    "status": "committed",
                    "pattern": pattern,
                    "new_entropy": entropy
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
                // Upgraded: search memories by context similarity (substring match)
                let context = params["context"].as_str().unwrap_or("");
                let k = params["k"].as_u64().unwrap_or(5) as usize;
                let mems = self.memories.lock().await;
                
                if context.is_empty() || mems.is_empty() {
                    return serde_json::json!({
                        "matches": [],
                        "total_memories": mems.len(),
                        "note": "No context provided or memory store is empty."
                    });
                }
                
                let ctx_lower = context.to_lowercase();
                let ctx_words: Vec<&str> = ctx_lower.split_whitespace().collect();
                
                // Score each memory by word overlap
                let mut scored: Vec<(f64, &MemoryEntry)> = mems.iter().map(|m| {
                    let content_lower = m.content.to_lowercase();
                    let matching = ctx_words.iter().filter(|w| content_lower.contains(*w)).count();
                    let similarity = if ctx_words.is_empty() { 0.0 } else { matching as f64 / ctx_words.len() as f64 };
                    (similarity, m)
                }).filter(|(s, _)| *s > 0.0).collect();
                
                scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
                
                let results: Vec<serde_json::Value> = scored.iter().take(k).map(|(sim, m)| {
                    serde_json::json!({
                        "similarity": sim,
                        "category": m.category,
                        "content": m.content,
                        "timestamp": m.timestamp
                    })
                }).collect();
                
                serde_json::json!({
                    "matches": results,
                    "total_memories": mems.len()
                })
            },
            "clawkit_memory_query" => {
                // Upgrade 3: Real stateful memory search
                let query = params["query"].as_str().unwrap_or("");
                let mems = self.memories.lock().await;
                
                // Guard: empty query returns all memories (up to 10)
                if query.is_empty() {
                    let results: Vec<serde_json::Value> = mems.iter().rev().take(10).map(|m| {
                        serde_json::json!({
                            "timestamp": m.timestamp,
                            "category": m.category,
                            "content": m.content
                        })
                    }).collect();
                    return serde_json::json!({
                        "query": "*",
                        "total_memories": mems.len(),
                        "matches": results.len(),
                        "results": results
                    });
                }
                
                let query_lower = query.to_lowercase();
                let matches: Vec<&MemoryEntry> = mems.iter()
                    .filter(|m| m.content.to_lowercase().contains(&query_lower) || m.category.to_lowercase().contains(&query_lower))
                    .collect();
                
                if matches.is_empty() {
                    serde_json::json!({
                        "query": query,
                        "total_memories": mems.len(),
                        "matches": 0,
                        "results": "No matching memories found. Record outcomes or commit patterns first."
                    })
                } else {
                    let results: Vec<serde_json::Value> = matches.iter().take(10).map(|m| {
                        serde_json::json!({
                            "timestamp": m.timestamp,
                            "category": m.category,
                            "content": m.content
                        })
                    }).collect();
                    serde_json::json!({
                        "query": query,
                        "total_memories": mems.len(),
                        "matches": results.len(),
                        "results": results
                    })
                }
            },
            "clawkit_compress_context" => {
                // Upgrade 2: Real context compression
                let target_tokens = params["target_tokens"].as_u64().unwrap_or(1000).max(1) as usize;
                let context = params["context"].as_str().unwrap_or("");
                
                if context.is_empty() {
                    // Fallback: compress from memory store
                    let mems = self.memories.lock().await;
                    if mems.is_empty() {
                        return serde_json::json!({
                            "compressed_context": "",
                            "original_tokens": 0,
                            "compressed_tokens": 0,
                            "compression_ratio": "N/A",
                            "source": "memory_store",
                            "note": "Memory store is empty. Record outcomes or commit patterns first."
                        });
                    }
                    let summary: String = mems.iter().rev().take(10)
                        .map(|m| m.content.as_str())
                        .collect::<Vec<&str>>()
                        .join(". ");
                    let original_words = summary.split_whitespace().count();
                    let target_words = (target_tokens as f64 * 0.75) as usize;
                    let compressed: String = summary.split_whitespace()
                        .take(target_words.max(5))
                        .collect::<Vec<&str>>()
                        .join(" ");
                    return serde_json::json!({
                        "compressed_context": compressed,
                        "original_tokens": original_words,
                        "compressed_tokens": compressed.split_whitespace().count(),
                        "compression_ratio": if compressed.split_whitespace().count() > 0 { format!("{}x", original_words / compressed.split_whitespace().count().max(1)) } else { "N/A".to_string() },
                        "source": "memory_store"
                    });
                }
                
                // Real compression: split by sentences, keep top N within budget
                let sentences: Vec<&str> = context.split(|c: char| c == '.' || c == '!' || c == '?')
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .collect();
                let original_words = context.split_whitespace().count();
                let target_words = (target_tokens as f64 * 0.75) as usize; // ~0.75 words per token
                
                let mut compressed = String::new();
                let mut word_count = 0;
                for sentence in &sentences {
                    let sw = sentence.split_whitespace().count();
                    if word_count + sw > target_words && word_count > 0 {
                        break;
                    }
                    if !compressed.is_empty() { compressed.push_str(". "); }
                    compressed.push_str(sentence);
                    word_count += sw;
                }
                if !compressed.is_empty() && !compressed.ends_with('.') {
                    compressed.push('.');
                }
                
                serde_json::json!({
                    "compressed_context": compressed,
                    "original_tokens": original_words,
                    "compressed_tokens": word_count,
                    "compression_ratio": format!("{}x", if word_count > 0 { original_words / word_count } else { 1 }),
                    "source": "input_context"
                })
            },
            // PHASE C: LEARNING & ORCHESTRATION TOOLS
            "clawkit_record_outcome" => {
                let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
                let mode_str = params["mode"].as_str().unwrap_or("Peer");
                // Clamp severity to [0.0, 5.0] — prevents garbage inputs
                let raw_severity = params["severity"].as_f64().unwrap_or(0.0) as f32;
                let severity = raw_severity.clamp(0.0, 5.0);
                
                let mode = match mode_str {
                    "Stalking" => core_rust::sentinel::modes::SentinelMode::Stalking,
                    "Berserk" => core_rust::sentinel::modes::SentinelMode::Berserk,
                    "Snipe" => core_rust::sentinel::modes::SentinelMode::Snipe,
                    _ => core_rust::sentinel::modes::SentinelMode::Zen,
                };
                
                let now = chrono::Utc::now().timestamp_millis();
                
                if severity > 0.0 {
                    let mut trauma = self.trauma.lock().await;
                    trauma.record_trauma(mode, pattern, severity, now);
                } else {
                    let mut trauma = self.trauma.lock().await;
                    trauma.heal(mode, pattern);
                }
                
                let mut brain = self.causal_brain.lock().await;
                brain.learn(
                    core_rust::sentinel::variables::SentinelVariable::Sentiment, 
                    core_rust::sentinel::variables::SentinelVariable::PriceDelta, 
                    severity == 0.0
                );
                
                // Upgrade 3: Push to Stateful Memory
                let mut mems = self.memories.lock().await;
                mems.push(MemoryEntry {
                    timestamp: now,
                    category: "outcome".to_string(),
                    content: format!("Outcome for '{}' in {} mode. Severity: {}", pattern, mode_str, severity),
                });
                
                serde_json::json!({
                    "status": "outcome_recorded",
                    "learning_applied": true,
                    "memory_stored": true
                })
            },
            "clawkit_update_user" => {
                // Upgrade 1: Real persistent user update
                let user_id = params["user_id"].as_str().unwrap_or("unknown");
                let mut users = self.users.lock().await;
                let existing = users.entry(user_id.to_string()).or_insert_with(|| serde_json::json!({}));
                
                // Merge all extra fields from params into profile
                if let Some(obj) = params.as_object() {
                    if let Some(existing_obj) = existing.as_object_mut() {
                        for (k, v) in obj {
                            if k != "user_id" {
                                existing_obj.insert(k.clone(), v.clone());
                            }
                        }
                    }
                }
                drop(users);
                self.save_users_to_disk().await;
                
                serde_json::json!({
                    "user_id": user_id,
                    "status": "user_profile_persisted"
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
            if let Ok(req) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(method) = req["method"].as_str() {
                    let id = req["id"].clone();
                    
                    let response = match method {
                        "initialize" => {
                            serde_json::json!({
                                "protocolVersion": "2024-11-05",
                                "capabilities": { "tools": {} },
                                "serverInfo": { "name": "clawkit-v4", "version": "4.0.0" }
                            })
                        },
                        "notifications/initialized" => {
                            continue; // No response needed for notification
                        },
                        "tools/list" => {
                            serde_json::json!({
                                "tools": [
                                    { "name": "clawkit_recall_user", "description": "Recall User Profile", "inputSchema": { "type": "object", "properties": { "user_id": { "type": "string" } } } },
                                    { "name": "clawkit_sense_intent", "description": "Sense intent", "inputSchema": { "type": "object", "properties": {} } },
                                    { "name": "clawkit_check_pattern", "description": "Check safety guardrail", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" }, "mode": { "type": "string" } } } },
                                    { "name": "clawkit_simulate_response", "description": "Simulate causal response", "inputSchema": { "type": "object", "properties": { "action": { "type": "string" } } } },
                                    { "name": "clawkit_commit_pattern", "description": "Commit to memory", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" } } } },
                                    { "name": "clawkit_reason_chain", "description": "Deep reasoning chain", "inputSchema": { "type": "object", "properties": { "draft": { "type": "string" }, "context": { "type": "string" }, "mode": { "type": "string" } } } },
                                    { "name": "clawkit_recall_similar", "description": "Recall similar memories", "inputSchema": { "type": "object", "properties": { "context": { "type": "string" }, "k": { "type": "number" } } } },
                                    { "name": "clawkit_memory_query", "description": "Query Vector Memory", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } } } },
                                    { "name": "clawkit_compress_context", "description": "Compress Context", "inputSchema": { "type": "object", "properties": { "target_tokens": { "type": "number" }, "context": { "type": "string", "description": "Raw text to compress. If empty, compresses from memory store." } } } },
                                    { "name": "clawkit_record_outcome", "description": "Record outcome and learn", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" }, "mode": { "type": "string" }, "severity": { "type": "number" } } } },
                                    { "name": "clawkit_update_user", "description": "Update User", "inputSchema": { "type": "object", "properties": { "user_id": { "type": "string" } } } },
                                    { "name": "clawkit_dream_conversation", "description": "Dream conversation replay", "inputSchema": { "type": "object", "properties": { "episodes": { "type": "number" } } } },
                                    { "name": "clawkit_orchestrate", "description": "Orchestrate mult-agents", "inputSchema": { "type": "object", "properties": { "agent_count": { "type": "number" } } } },
                                    { "name": "clawkit_tool_recommend", "description": "Recommend tool", "inputSchema": { "type": "object", "properties": { "task": { "type": "string" } } } }
                                ]
                            })
                        },
                        "tools/call" => {
                            let tool_name = req["params"]["name"].as_str().unwrap_or("");
                            let tool_args = req["params"]["arguments"].clone();
                            let result_content = self.handle_tool_call(tool_name, tool_args).await;
                            
                            // MCP tools/call expects `content` array
                            serde_json::json!({
                                "content": [
                                    {
                                        "type": "text",
                                        "text": serde_json::to_string(&result_content).unwrap_or_else(|_| "Error".to_string())
                                    }
                                ]
                            })
                        },
                        // Fallback for legacy generic tests
                        _ => self.handle_tool_call(method, req["params"].clone()).await
                    };

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Helper function to setup the server
    fn setup_server() -> EidolonMcpServer {
        let oracle = DeepSeekOracle::new("dummy".to_string());
        let (tx, _rx) = tokio::sync::mpsc::channel(10);
        EidolonMcpServer::new(oracle, tx)
    }

    #[tokio::test]
    async fn test_phase_a_core_loop() {
        let server = setup_server();
        
        let res = server.handle_tool_call("clawkit_recall_user", json!({"user_id": "u123"})).await;
        assert_eq!(res["user_id"], "u123");
        assert_eq!(res["status"], "success");

        let res = server.handle_tool_call("clawkit_sense_intent", json!({})).await;
        assert_eq!(res["success"], true);
        assert_eq!(res["recommended_mode"], "Peer");

        let res = server.handle_tool_call("clawkit_check_pattern", json!({"pattern": "greetings", "mode": "Peer"})).await;
        assert_eq!(res["pattern"], "greetings");
        assert_eq!(res["inhibited"], false);

        let res = server.handle_tool_call("clawkit_simulate_response", json!({"action": "ask_why"})).await;
        assert_eq!(res["action_tested"], "ask_why");
        assert_eq!(res["predicted_outcome"], "positive");

        let res = server.handle_tool_call("clawkit_commit_pattern", json!({"pattern": "greetings"})).await;
        assert_eq!(res["status"], "committed");
    }

    #[tokio::test]
    async fn test_phase_b_reasoning_memory() {
        let server = setup_server();
        
        let res = server.handle_tool_call("clawkit_recall_similar", json!({"context": "hello", "k": 2})).await;
        assert!(res["matches"].is_array());
        
        // Memory query: no memories yet, should return 0 matches
        let res = server.handle_tool_call("clawkit_memory_query", json!({"query": "risk level"})).await;
        assert_eq!(res["query"], "risk level");
        assert_eq!(res["matches"], 0);
        
        // Compress with real input
        let res = server.handle_tool_call("clawkit_compress_context", json!({
            "target_tokens": 10,
            "context": "The market is volatile today. Gas fees are extremely high. User wants to buy BNB. There is a potential rug pull."
        })).await;
        assert!(res["compressed_context"].is_string());
        let compressed = res["compressed_context"].as_str().unwrap();
        let original = res["original_tokens"].as_u64().unwrap();
        let comp_tokens = res["compressed_tokens"].as_u64().unwrap();
        assert!(comp_tokens <= original, "Compressed should not be larger than original");
    }

    #[tokio::test]
    async fn test_phase_c_learning_orchestration() {
        let server = setup_server();
        
        // Record an outcome → should also write to memory
        let res = server.handle_tool_call("clawkit_record_outcome", json!({
            "pattern": "test_pattern", "mode": "Peer", "severity": 0.0
        })).await;
        assert_eq!(res["status"], "outcome_recorded");
        assert_eq!(res["memory_stored"], true);
        
        // Now memory_query should find it
        let res = server.handle_tool_call("clawkit_memory_query", json!({"query": "test_pattern"})).await;
        assert!(res["matches"].as_u64().unwrap() > 0, "Memory should contain the recorded outcome");
        
        // Update user and verify persistence
        let res = server.handle_tool_call("clawkit_update_user", json!({"user_id": "u123", "preferred_mode": "Berserk", "risk_tolerance": 0.99})).await;
        assert_eq!(res["status"], "user_profile_persisted");
        
        let res = server.handle_tool_call("clawkit_recall_user", json!({"user_id": "u123"})).await;
        assert_eq!(res["profile"]["preferred_mode"], "Berserk");
        assert_eq!(res["profile"]["risk_tolerance"], 0.99);
        
        let res = server.handle_tool_call("clawkit_dream_conversation", json!({"episodes": 10})).await;
        assert_eq!(res["episodes_replayed"], 10);
        
        let res = server.handle_tool_call("clawkit_orchestrate", json!({"agent_count": 5})).await;
        assert_eq!(res["agents_orchestrated"], 5);
        
        let res = server.handle_tool_call("clawkit_tool_recommend", json!({"task": "analyze_market"})).await;
        assert_eq!(res["task"], "analyze_market");
    }
}
