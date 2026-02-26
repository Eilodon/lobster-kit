mod auth;
mod critic;
mod db;
mod dispatch;
mod embedding;
mod generated;
mod helpers;
mod ingress_policy;
mod mcp_protocol;
mod memory;
mod memory_persist;
mod oracle;
mod policy_tuner;
mod providers;
mod reasoning;
mod resources;
mod routing;
mod subbrain_auto;
mod telemetry;
mod tensor_oracle;
mod tool_forge;
mod tool_gen;
mod tools_core;
mod tools_learning;
mod tools_orchestration;
mod tools_reasoning;
mod types;

use crate::embedding::EmbeddingEngine;
use crate::types::*;

use core_rust::sentinel::causal::CausalGraph;
use core_rust::sentinel::thermo::ThermodynamicEngine;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

pub(crate) const DEFAULT_TELEMETRY_DB_RELATIVE_PATH: &str = "data/memory/eidolon_learning.db";
const DEFAULT_RECOMMENDER_PRIMARY_MODEL: &str = "v2";
const DEFAULT_RECOMMENDER_SHADOW_MODEL: &str = "v1";
const DEFAULT_SHADOW_SAMPLE_PERCENT: u64 = 100;
const DEFAULT_TOOL_GEN_ALLOWED_ENVS: &str = "development,staging";
const DEFAULT_TOOL_GEN_PROMOTE_MIN_CALLS: u64 = 30;
const DEFAULT_TOOL_GEN_PROMOTE_MAX_ERROR_RATE: f64 = 0.15;
const DEFAULT_TOOL_GEN_PROMOTE_MAX_P95_MS: f64 = 1800.0;
const DEFAULT_TOOL_GEN_PROMOTE_MAX_FALLBACK_RATE: f64 = 0.2;
const DEFAULT_TOOL_GEN_PROMOTE_MIN_SATISFACTION: f64 = 0.7;
pub(crate) const DEFAULT_TOOL_GEN_AUDIT_ACTOR: &str = "mcp_runtime";
const DEFAULT_TOOL_GEN_AUTOPILOT_MAX_ERROR_RATE: f64 = 0.22;
const DEFAULT_TOOL_GEN_AUTOPILOT_MAX_FALLBACK_RATE: f64 = 0.35;
const DEFAULT_TOOL_GEN_AUTOPILOT_MAX_P95_MS: f64 = 2200.0;
const DEFAULT_TOOL_GEN_AUTOPILOT_MAX_P99_P50_RATIO: f64 = 3.0;
const DEFAULT_TOOL_GEN_AUTOPILOT_MIN_SAMPLE_COUNT: u64 = 30;
const DEFAULT_LEGACY_DEFI_COMPAT_ENABLED: bool = false;
const DEFAULT_LEGACY_DEFI_COMPAT_ALLOWED_ENVS: &str = "development";

pub(crate) use crate::generated::mcp_contract::DEFAULT_COGNITIVE_TOOL_CATALOG;

#[derive(Clone)]
pub struct EidolonMcpServer {
    causal_brain: Arc<RwLock<CausalGraph>>,
    thermo: Arc<RwLock<ThermodynamicEngine>>,
    trauma: Arc<RwLock<core_rust::sentinel::trauma::TraumaRegistry>>,
    actor: Arc<RwLock<core_rust::sentinel::systems::SentinelActor>>,
    // Upgrade 1: Persistent User Profiles
    users: Arc<RwLock<HashMap<TenantId, HashMap<String, serde_json::Value>>>>,
    users_file_path: Arc<PathBuf>,
    // Upgrade 3: Stateful Memory
    memories: Arc<RwLock<HashMap<TenantId, Vec<MemoryEntry>>>>,
    memories_file_path: Arc<PathBuf>,
    pub(crate) last_input_ms: Arc<std::sync::atomic::AtomicU64>,
    pub dynamic_tools: Arc<tokio::sync::RwLock<HashMap<String, tool_forge::WasmTool>>>,
    // Lightweight telemetry for MCP resources.
    tool_metrics: Arc<RwLock<HashMap<String, ToolTelemetry>>>,
    telemetry_db_path: Arc<PathBuf>,
    // Phase 5: ONNX Embedding Engine for sense_intent
    embedding_engine: Arc<Option<EmbeddingEngine>>,
    // Phase 6: LiquidBrain adaptive neural classifier
    liquid_brain: Arc<RwLock<core_rust::liquid_brain::LiquidBrain>>,
    // Phase 6: The Epistemic Core (Candle Tensor Engine)
    tensor_oracle: Arc<crate::tensor_oracle::TensorOracle>,
    // Phase 3: Adaptive Routing Policy Engine
    pub(crate) routing_engine: Arc<crate::routing::RoutingPolicyEngine>,
}

impl EidolonMcpServer {
    pub fn new() -> Self {
        let users_file_path = Self::resolve_users_file_path();
        let telemetry_db_path = Self::telemetry_db_path();
        Self::with_storage_paths(users_file_path, telemetry_db_path)
    }

    fn with_storage_paths(users_file_path: PathBuf, telemetry_db_path: PathBuf) -> Self {
        // Load user profiles from disk if available
        let users = Self::load_users_from_disk_sync(&users_file_path);
        let _ = Self::ensure_telemetry_storage_sync(&telemetry_db_path);
        let loaded_tool_metrics =
            Self::load_tool_metrics_from_db_sync(&telemetry_db_path).unwrap_or_default();

        // Phase 5: Try to load ONNX Embedding Engine
        let model_dir =
            std::path::PathBuf::from(std::env::var("ONNX_MODEL_DIR").unwrap_or_else(|_| {
                // Default: relative to binary or absolute path
                let exe_dir = std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                    .unwrap_or_else(|| PathBuf::from("."));
                exe_dir
                    .join("../../data/models/minilm")
                    .to_string_lossy()
                    .to_string()
            }));
        let embedding_engine = match Self::prepare_ort_runtime_for_embedding() {
            Ok(_) => match EmbeddingEngine::load(&model_dir) {
                Ok(engine) => {
                    eprintln!("[Eidolon] ONNX EmbeddingEngine loaded from {:?}", model_dir);
                    Some(engine)
                }
                Err(e) => {
                    eprintln!(
                        "[Eidolon] ONNX EmbeddingEngine unavailable: {}. Falling back to Ollama.",
                        e
                    );
                    None
                }
            },
            Err(err) => {
                eprintln!(
                    "[Eidolon] ONNX runtime unavailable: {}. Falling back to Ollama.",
                    err
                );
                None
            }
        };

        // Phase 3: Memory persistence path
        let memories_file_path = users_file_path
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("eidolon_memories.json");

        // Phase 3: Load memories from disk if available
        let memories = Self::load_memories_from_disk_sync(&memories_file_path);

        Self {
            causal_brain: Arc::new(RwLock::new(CausalGraph::new(
                core_rust::sentinel::variables::SentinelVariable::COUNT,
            ))),
            thermo: Arc::new(RwLock::new(ThermodynamicEngine::new(
                core_rust::sentinel::thermo::ThermoConfig::default(),
            ))),
            trauma: Arc::new(RwLock::new(
                core_rust::sentinel::trauma::TraumaRegistry::new(),
            )),
            actor: Arc::new(RwLock::new(
                core_rust::sentinel::systems::SentinelActor::new(),
            )),
            users: Arc::new(RwLock::new(users)),
            users_file_path: Arc::new(users_file_path),
            memories: Arc::new(RwLock::new(memories)),
            memories_file_path: Arc::new(memories_file_path),
            last_input_ms: Arc::new(std::sync::atomic::AtomicU64::new(
                chrono::Utc::now().timestamp_millis() as u64,
            )),
            dynamic_tools: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            tool_metrics: Arc::new(RwLock::new(loaded_tool_metrics)),
            telemetry_db_path: Arc::new(telemetry_db_path),
            embedding_engine: Arc::new(embedding_engine),
            // Phase 6: LiquidBrain — 64 input (pseudo_embed dim), 16 hidden neurons
            liquid_brain: Arc::new(RwLock::new(core_rust::liquid_brain::LiquidBrain::new(
                64, 16,
            ))),
            // Phase 6: The Epistemic Core
            tensor_oracle: Arc::new(crate::tensor_oracle::TensorOracle::new()),
            // Phase 3: Adaptive Routing Engine
            routing_engine: Arc::new(crate::routing::RoutingPolicyEngine::new(
                crate::routing::CircuitBreakerConfig::from_env(),
            )),
        }
    }

    fn prepare_ort_runtime_for_embedding() -> Result<(), String> {
        let builder = ort::init().with_name("eidolon-embedding");
        let _ = builder.commit();
        Ok(())
    }

    // Auth methods moved to auth.rs (impl-block extension)
    // Telemetry path moved to telemetry.rs (impl-block extension)

    // DB methods moved to db.rs (impl-block extension)
    // Telemetry recording moved to telemetry.rs (impl-block extension)
    // Tool generation governance moved to tool_gen.rs (impl-block extension)

    // Reasoning methods moved to reasoning.rs (impl-block extension)
    // Memory search methods moved to memory.rs (impl-block extension)

    // MCP protocol helpers moved to mcp_protocol.rs (impl-block extension)
    // Resource handlers moved to resources.rs (impl-block extension)
    // handle_tool_call + run_stdio moved to dispatch.rs (impl-block extension)
}

#[tokio::main]
async fn main() {
    let server = EidolonMcpServer::new();

    // Initializing Phase 6: The Epistemic Core
    eprintln!("[Eidolon TensorOracle] Booting internal LLM Engine...");
    if let Err(e) = server.tensor_oracle.boot_engine().await {
        eprintln!("[Eidolon TensorOracle] CRITICAL ENGINE BOOT FAILURE: {}", e);
    } else {
        eprintln!("[Eidolon TensorOracle] Precomputing Epistemic Pre-Hook (Zero-Allocation Memory Profile)");
        let user_profile = "Eidolon-V Operating Context. Core Directives: Ruthless efficiency. Optimization is paramount. Maximize Thermodynamic Entropy in exploration.";
        if let Err(e) = server
            .tensor_oracle
            .precompute_epistemic_hook(user_profile)
            .await
        {
            eprintln!("[Eidolon] Failed to preload Epistemic Pre-Hook: {}", e);
        }
    }

    let server_dream_clone = server.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            let now = chrono::Utc::now().timestamp_millis() as u64;
            let last_input = server_dream_clone
                .last_input_ms
                .load(std::sync::atomic::Ordering::Relaxed);

            // Dynamic threshold based on system state
            let base_threshold = 300_000; // 5 minutes standard

            if now > last_input + base_threshold {
                eprintln!(
                    "[Eidolon-V] Dream Sequence Initiated. Processing historical memories..."
                );
                server_dream_clone.trigger_dream_sequence().await;
            }
        }
    });

    server.run_stdio().await;
}

#[cfg(test)]
#[cfg(test)]
mod tests;
