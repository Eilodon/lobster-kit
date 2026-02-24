use std::path::Path;
use std::sync::Mutex;
use tokenizers::Tokenizer;

/// Lightweight ONNX-powered Embedding Engine for sentence classification.
/// Uses `all-MiniLM-L6-v2` to produce 384-dim vectors in ~2-5ms.
pub struct EmbeddingEngine {
    session: Mutex<ort::session::Session>,
    tokenizer: Tokenizer,
}

impl EmbeddingEngine {
    /// Load ONNX model + HuggingFace tokenizer from disk.
    pub fn load(model_dir: &Path) -> Result<Self, String> {
        let model_path = model_dir.join("model.onnx");
        let tokenizer_path = model_dir.join("tokenizer.json");

        if !model_path.exists() {
            return Err(format!("ONNX model not found: {:?}", model_path));
        }
        if !tokenizer_path.exists() {
            return Err(format!("Tokenizer not found: {:?}", tokenizer_path));
        }

        let session = ort::session::Session::builder()
            .map_err(|e| format!("ORT session builder error: {}", e))?
            .with_intra_threads(1)
            .map_err(|e| format!("ORT thread config error: {}", e))?
            .commit_from_file(&model_path)
            .map_err(|e| format!("ORT model load error: {}", e))?;

        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Tokenizer load error: {}", e))?;

        Ok(Self {
            session: Mutex::new(session),
            tokenizer,
        })
    }

    /// Embed a single sentence → 384-dim f32 vector (L2-normalized).
    pub fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| format!("Tokenize error: {}", e))?;

        let ids = encoding.get_ids();
        let attention = encoding.get_attention_mask();
        let type_ids = encoding.get_type_ids();
        let seq_len = ids.len();

        // Build input tensors using (shape, data) tuple API which ort v2 accepts
        let ids_vec: Vec<i64> = ids.iter().map(|&x| x as i64).collect();
        let attn_vec: Vec<i64> = attention.iter().map(|&x| x as i64).collect();
        let type_vec: Vec<i64> = type_ids.iter().map(|&x| x as i64).collect();

        let shape = vec![1usize, seq_len];

        let input_ids = ort::value::Value::from_array((shape.clone(), ids_vec.into_boxed_slice()))
            .map_err(|e| format!("ORT input_ids: {}", e))?;

        let attention_mask =
            ort::value::Value::from_array((shape.clone(), attn_vec.into_boxed_slice()))
                .map_err(|e| format!("ORT attention_mask: {}", e))?;

        let token_type_ids = ort::value::Value::from_array((shape, type_vec.into_boxed_slice()))
            .map_err(|e| format!("ORT token_type_ids: {}", e))?;

        let inputs: Vec<(std::borrow::Cow<str>, ort::session::SessionInputValue)> = vec![
            ("input_ids".into(), input_ids.into()),
            ("attention_mask".into(), attention_mask.into()),
            ("token_type_ids".into(), token_type_ids.into()),
        ];

        let mut session = self
            .session
            .lock()
            .map_err(|_| "ORT session lock poisoned".to_string())?;
        let outputs = session
            .run(inputs)
            .map_err(|e| format!("ORT run error: {}", e))?;

        // Extract tensor [1, seq_len, 384]
        let (_output_shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("ORT extract error: {}", e))?;

        let hidden_size = if seq_len > 0 { data.len() / seq_len } else { 0 };
        if hidden_size == 0 {
            return Err("ORT output has invalid hidden size".to_string());
        }

        // Mean pooling: average across dim=1 (tokens), masked by attention
        let mut pooled = vec![0.0f32; hidden_size];
        let mut count = 0.0f32;

        for t in 0..seq_len {
            let mask = attention[t] as f32;
            if mask > 0.0 {
                let offset = t * hidden_size;
                if offset + hidden_size > data.len() {
                    return Err("ORT output has unexpected tensor length".to_string());
                }
                for h in 0..hidden_size {
                    pooled[h] += data[offset + h] * mask;
                }
                count += mask;
            }
        }

        if count > 0.0 {
            for h in 0..hidden_size {
                pooled[h] /= count;
            }
        }

        // L2 normalize
        let norm: f32 = pooled.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 1e-12 {
            for h in 0..hidden_size {
                pooled[h] /= norm;
            }
        }

        Ok(pooled)
    }

    /// Cosine similarity between two L2-normalized vectors (dot product).
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }
        a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
    }
}
