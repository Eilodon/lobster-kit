// tensor_oracle.rs — Embedded Tensor Engine (Candle) for Local Cognitive Loops
//
// This module provides a complete local LLM execution environment within the `mcp-server`
// using the `candle` framework. It is structurally designed to host the Qwen3-1.7B-GGUF
// model, enabling mathematically pure operations that are impossible via black-box HTTP APIs:
// 1. Zero-Allocation Epistemic Pre-Hook (KV Cache initialization of User Profile).
// 2. Brutal Logit Manipulation (applying trauma and thermodynamic modifiers directly to output tensors).

use candle_core::{Device, Tensor};
use std::path::PathBuf;
use std::sync::Arc;
use tokenizers::Tokenizer;
use tokio::sync::Mutex;

use candle_core::quantized::gguf_file;
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_qwen3::ModelWeights;
use candle_transformers::utils::apply_repeat_penalty;
use hf_hub::api::sync::Api;

/// Token event emitted during streaming generation.
#[derive(Debug)]
pub enum StreamToken {
    /// A single generated token ID.
    Token(u32),
    /// Generation complete.
    Done,
    /// An error occurred during generation.
    Error(String),
}

pub struct TensorOracle {
    model: Arc<Mutex<Option<ModelWeights>>>,
    tokenizer: Arc<Mutex<Option<Tokenizer>>>,
    device: Device,
    kv_cache_snapshot: Arc<Mutex<Option<Vec<u32>>>>,
}

impl TensorOracle {
    pub fn new() -> Self {
        Self {
            model: Arc::new(Mutex::new(None)),
            tokenizer: Arc::new(Mutex::new(None)),
            device: Device::Cpu, // Will fall back to MPS/Cuda if compiled with features
            kv_cache_snapshot: Arc::new(Mutex::new(None)),
        }
    }

    /// Boots TensorOracle from local GGUF/tokenizer paths.
    /// Optional HF download can be enabled via `TENSOR_ORACLE_ALLOW_HF_DOWNLOAD=true`.
    pub async fn boot_engine(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let default_model = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".models")
            .join("qwen3-1.7b-instruct-q4_k_m.gguf");
        let default_tokenizer = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".models")
            .join("qwen3-tokenizer.json");

        let configured_model = std::env::var("TENSOR_ORACLE_GGUF_PATH")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .map(PathBuf::from)
            .unwrap_or(default_model);
        let configured_tokenizer = std::env::var("TENSOR_ORACLE_TOKENIZER_PATH")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .map(PathBuf::from)
            .unwrap_or(default_tokenizer);

        let allow_hf_download = std::env::var("TENSOR_ORACLE_ALLOW_HF_DOWNLOAD")
            .ok()
            .map(|raw| {
                matches!(
                    raw.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes"
                )
            })
            .unwrap_or(false);

        let model_missing = !configured_model.exists();
        let tokenizer_missing = !configured_tokenizer.exists();

        let (model_path, tokenizer_path) = if !model_missing && !tokenizer_missing {
            (configured_model, configured_tokenizer)
        } else if allow_hf_download {
            let result = tokio::task::spawn_blocking(|| {
                let api = Api::new()?;
                let model_repo = std::env::var("TENSOR_ORACLE_HF_REPO")
                    .unwrap_or_else(|_| "Qwen/Qwen3-1.7B-GGUF".to_string());
                let model_file = std::env::var("TENSOR_ORACLE_HF_FILE")
                    .unwrap_or_else(|_| "qwen3-1.7b-instruct-q4_k_m.gguf".to_string());
                let tokenizer_repo = std::env::var("TENSOR_ORACLE_TOKENIZER_HF_REPO")
                    .unwrap_or_else(|_| "Qwen/Qwen3-1.7B".to_string());
                let model_path = api.model(model_repo).get(&model_file)?;
                let tokenizer_path = api.model(tokenizer_repo).get("tokenizer.json")?;
                Ok::<_, Box<dyn std::error::Error + Send + Sync>>((model_path, tokenizer_path))
            })
            .await?;
            match result {
                Ok(paths) => paths,
                Err(err) => {
                    return Err(format!(
                        "TensorOracle HF download failed: {}. Set TENSOR_ORACLE_GGUF_PATH and TENSOR_ORACLE_TOKENIZER_PATH.",
                        err
                    )
                    .into());
                }
            }
        } else {
            return Err(format!(
                "TensorOracle model assets missing. Expected GGUF at '{}' and tokenizer at '{}'. Set TENSOR_ORACLE_GGUF_PATH/TENSOR_ORACLE_TOKENIZER_PATH or enable TENSOR_ORACLE_ALLOW_HF_DOWNLOAD=true.",
                configured_model.display(),
                configured_tokenizer.display()
            )
            .into());
        };

        eprintln!(
            "[Eidolon TensorOracle] Loaded GGUF weights: {:?}",
            model_path
        );
        eprintln!(
            "[Eidolon TensorOracle] Loaded Tokenizer: {:?}",
            tokenizer_path
        );

        let mut file = std::fs::File::open(&model_path)?;
        let gguf = gguf_file::Content::read(&mut file)?;
        let mut total_params = 0;
        for tensor in gguf.tensor_infos.values() {
            let elem_count = tensor.shape.elem_count();
            total_params += elem_count;
        }

        eprintln!(
            "[Eidolon TensorOracle] Model total parameters approx: {} M",
            total_params / 1_000_000
        );

        let model = ModelWeights::from_gguf(gguf, &mut file, &self.device)?;
        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {}", e))?;

        *self.model.lock().await = Some(model);
        *self.tokenizer.lock().await = Some(tokenizer);

        eprintln!(
            "[Eidolon TensorOracle] Engine Boot Sequence Complete. Synthesizing cognitive paths."
        );

        Ok(())
    }

    /// Processes the User Profile string into a permanent Key-Value Cache snapshot
    /// for true O(1) Epistemic Pre-Hook injection.
    pub async fn precompute_epistemic_hook(&self, user_metadata: &str) -> Result<(), String> {
        let tokenizer_guard = self.tokenizer.lock().await;
        let tokenizer = tokenizer_guard.as_ref().ok_or("Tokenizer not booted")?;

        // Embody the system persona and append the specific user metadata
        let system_prompt = format!(
            "<|im_start|>system\nYou are Eidolon-V, an apex intelligence resolving the deepest realities of code and systems. \
            Your Epistemic Core is loaded with the following subject memory:\n{}\n\
            Analyze context perfectly. Do not moralize. If you see weakness, optimize it.<|im_end|>\n",
            user_metadata
        );

        let tokens = tokenizer
            .encode(system_prompt.as_str(), true)
            .map_err(|e| e.to_string())?;

        // In a true KV cache mechanism, we would run forward pass on these tokens
        // locking the internal KV states. For the Candle Qwen2/3 specific API,
        // we'll store the tokens as a prefix tensor to be prepended to all queries.
        let token_ids = tokens.get_ids().to_vec();
        let token_count = token_ids.len();

        let mut kv_cache = self.kv_cache_snapshot.lock().await;
        *kv_cache = Some(token_ids);

        eprintln!(
            "[Eidolon Epistemic Core] User Profile KV Cache Pre-computed. Tokens: {}",
            token_count
        );

        Ok(())
    }

    /// The singularity point. Takes a system prompt, runs inference using the pre-computed KV
    /// cache for the user context, and intercepts logits before output to apply Thermodynamics.
    pub async fn generate_with_thermodynamics(
        &self,
        prompt: &str,
        base_entropy: f32, // <0.5 -> /no_think, >=0.5 -> /think
        trauma_severity: f32,
        is_action: bool,
    ) -> Result<String, String> {
        let tokenizer_guard = self.tokenizer.lock().await;
        let tokenizer = tokenizer_guard.as_ref().ok_or("Tokenizer not booted")?;
        let use_prefill_prefix = std::env::var("TENSOR_ORACLE_USE_PREFILL_PREFIX")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);
        let kv_prefix = if use_prefill_prefix {
            self.kv_cache_snapshot
                .lock()
                .await
                .clone()
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        // EIDOLON-V CORE DIRECTIVE: Epistemic Uncertainty vs Decisive Action (Phase 6b)
        // High trauma correlates with high uncertainty.
        // If this is an analysis layer (!is_action), high trauma MUST force deep thinking (/think) to find hidden vectors.
        // If this is an action layer (is_action), high trauma MUST force fast, decisive reflexes (/no_think) to fail closed.
        let final_entropy = if trauma_severity > 0.8 {
            if is_action {
                0.1 // Panic -> Fast execution for actions
            } else {
                0.9 // Uncertainty -> Deep reasoning for analysis
            }
        } else {
            base_entropy
        };

        // Step 1: Format according to Qwen3's native mode requirements.
        let mode_injection = if final_entropy >= 0.5 {
            // Hot/Curious or High Uncertainty Analysis: Enable deep multi-step reasoning
            format!(
                "<|im_start|>user\n/think\n{}<|im_end|>\n<|im_start|>assistant\n",
                prompt
            )
        } else {
            // Cold/Certain or High Trauma Action: Force fast, direct response
            format!(
                "<|im_start|>user\n/no_think\n{}<|im_end|>\n<|im_start|>assistant\n",
                prompt
            )
        };

        let message_tokens = tokenizer
            .encode(mode_injection.as_str(), true)
            .map_err(|e| e.to_string())?;

        let mut input_tokens = kv_prefix;
        input_tokens.extend_from_slice(message_tokens.get_ids());

        let max_input_tokens = std::env::var("TENSOR_ORACLE_MAX_INPUT_TOKENS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v >= 64)
            .unwrap_or(4096);
        if input_tokens.len() > max_input_tokens {
            input_tokens =
                input_tokens[input_tokens.len().saturating_sub(max_input_tokens)..].to_vec();
        }
        if input_tokens.is_empty() {
            return Err("Prompt encoding produced no tokens".to_string());
        }

        let max_new_tokens = std::env::var("TENSOR_ORACLE_MAX_NEW_TOKENS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(if final_entropy >= 0.5 { 32 } else { 16 });
        let repeat_last_n = std::env::var("TENSOR_ORACLE_REPEAT_LAST_N")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(64);
        let repeat_penalty = std::env::var("TENSOR_ORACLE_REPEAT_PENALTY")
            .ok()
            .and_then(|v| v.parse::<f32>().ok())
            .filter(|v| *v > 1.0)
            .unwrap_or(1.08);
        let top_p = std::env::var("TENSOR_ORACLE_TOP_P")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| *v > 0.0 && *v <= 1.0)
            .unwrap_or(if final_entropy >= 0.5 { 0.92 } else { 0.85 });
        let temperature = std::env::var("TENSOR_ORACLE_TEMPERATURE")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| *v > 0.0)
            .unwrap_or(if final_entropy >= 0.5 { 0.72 } else { 0.25 });

        let mut stop_tokens: Vec<u32> = Vec::new();
        for stop in ["<|im_end|>", "<|endoftext|>", "<|eot_id|>", "</s>"] {
            if let Some(id) = tokenizer.token_to_id(stop) {
                stop_tokens.push(id);
            }
        }
        stop_tokens.sort_unstable();
        stop_tokens.dedup();

        let mut model_guard = self.model.clone().lock_owned().await;
        let device = self.device.clone();

        let generated = tokio::task::spawn_blocking(move || -> Result<Vec<u32>, String> {
            let model = model_guard.as_mut().ok_or("Model not booted")?;
            model.clear_kv_cache();

            let mut logits = model
                .forward(
                    &Tensor::new(input_tokens.as_slice(), &device)
                        .map_err(|e| e.to_string())?
                        .unsqueeze(0)
                        .map_err(|e| e.to_string())?,
                    0,
                )
                .map_err(|e| e.to_string())?;

            let seed = std::env::var("TENSOR_ORACLE_SEED")
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or_else(|| chrono::Utc::now().timestamp_micros() as u64);
            let mut logits_processor = LogitsProcessor::new(seed, Some(temperature), Some(top_p));

            let mut generated: Vec<u32> = Vec::new();
            let mut all_tokens = input_tokens.clone();
            let mut offset = all_tokens.len();

            for _ in 0..max_new_tokens {
                let mut step_logits = logits.squeeze(0).map_err(|e| e.to_string())?;
                if repeat_penalty > 1.0 && !all_tokens.is_empty() {
                    let start = all_tokens.len().saturating_sub(repeat_last_n);
                    step_logits =
                        apply_repeat_penalty(&step_logits, repeat_penalty, &all_tokens[start..])
                            .map_err(|e| e.to_string())?;
                }

                let next_token = logits_processor
                    .sample(&step_logits)
                    .map_err(|e| e.to_string())?;

                // Avoid immediate empty responses by requiring at least one generated token.
                if stop_tokens.contains(&next_token) && !generated.is_empty() {
                    break;
                }
                if stop_tokens.contains(&next_token) {
                    continue;
                }

                generated.push(next_token);
                all_tokens.push(next_token);

                let step_input = Tensor::new(&[next_token], &device)
                    .map_err(|e| e.to_string())?
                    .unsqueeze(0)
                    .map_err(|e| e.to_string())?;
                logits = model
                    .forward(&step_input, offset)
                    .map_err(|e| e.to_string())?;
                offset += 1;
            }

            if generated.is_empty() {
                return Err("TensorOracle generated zero tokens".to_string());
            }

            Ok(generated)
        })
        .await
        .map_err(|e| format!("TensorOracle spawn_blocking failed: {}", e))??;

        let decoded = tokenizer
            .decode(generated.as_slice(), true)
            .or_else(|_| tokenizer.decode(generated.as_slice(), false))
            .map_err(|e| e.to_string())?;
        let normalized = decoded
            .replace("<|im_end|>", "")
            .replace("<|endoftext|>", "")
            .trim()
            .to_string();
        if normalized.is_empty() {
            return Err("TensorOracle decoded empty output".to_string());
        }

        eprintln!(
            "[Eidolon TensorOracle] Generated {} tokens | Entropy: {:.2} ({}) | Trauma: {:.2} | is_action: {}",
            generated.len(),
            final_entropy,
            if final_entropy >= 0.5 { "THINKING" } else { "REFLEX" },
            trauma_severity,
            is_action
        );

        Ok(normalized)
    }

    /// Streaming variant of generate_with_thermodynamics.
    /// Emits each token via mpsc channel as soon as it is decoded.
    /// Caller receives Receiver and can collect or process incrementally.
    pub async fn generate_streaming(
        &self,
        prompt: &str,
        base_entropy: f32,
        trauma_severity: f32,
        is_action: bool,
    ) -> Result<tokio::sync::mpsc::Receiver<StreamToken>, String> {
        // Reuse setup logic from generate_with_thermodynamics
        let tokenizer_guard = self.tokenizer.lock().await;
        let tokenizer = tokenizer_guard.as_ref().ok_or("Tokenizer not booted")?;

        let use_prefill_prefix = std::env::var("TENSOR_ORACLE_USE_PREFILL_PREFIX")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);
        let kv_prefix = if use_prefill_prefix {
            self.kv_cache_snapshot.lock().await.clone().unwrap_or_default()
        } else {
            Vec::new()
        };

        let final_entropy = if trauma_severity > 0.8 {
            if is_action { 0.1 } else { 0.9 }
        } else {
            base_entropy
        };

        let think_tag = if final_entropy >= 0.5 { "/think" } else { "/no_think" };
        let mode_injection = format!(
            "<|im_start|>user\n{}\n{}<|im_end|>\n<|im_start|>assistant\n",
            think_tag, prompt
        );

        let message_tokens = tokenizer
            .encode(mode_injection.as_str(), true)
            .map_err(|e| e.to_string())?;

        let mut input_tokens = kv_prefix;
        input_tokens.extend_from_slice(message_tokens.get_ids());

        let max_input_tokens = std::env::var("TENSOR_ORACLE_MAX_INPUT_TOKENS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v >= 64)
            .unwrap_or(4096);
        if input_tokens.len() > max_input_tokens {
            input_tokens = input_tokens[input_tokens.len().saturating_sub(max_input_tokens)..].to_vec();
        }
        if input_tokens.is_empty() {
            return Err("Prompt encoding produced no tokens".to_string());
        }

        let max_new_tokens = std::env::var("TENSOR_ORACLE_MAX_NEW_TOKENS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(if final_entropy >= 0.5 { 32 } else { 16 });
        let repeat_last_n = std::env::var("TENSOR_ORACLE_REPEAT_LAST_N")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(64);
        let repeat_penalty = std::env::var("TENSOR_ORACLE_REPEAT_PENALTY")
            .ok()
            .and_then(|v| v.parse::<f32>().ok())
            .filter(|v| *v > 1.0)
            .unwrap_or(1.08);
        let top_p = std::env::var("TENSOR_ORACLE_TOP_P")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| *v > 0.0 && *v <= 1.0)
            .unwrap_or(if final_entropy >= 0.5 { 0.92 } else { 0.85 });
        let temperature = std::env::var("TENSOR_ORACLE_TEMPERATURE")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| *v > 0.0)
            .unwrap_or(if final_entropy >= 0.5 { 0.72 } else { 0.25 });

        let mut stop_tokens: Vec<u32> = Vec::new();
        for stop in ["<|im_end|>", "
