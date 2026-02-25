use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub score: f32,
}

#[derive(Serialize, Deserialize)]
struct HyperMemoryExportV2 {
    version: u8,
    dimension: usize,
    ids: Vec<String>,
    flat_vectors: Vec<f32>,
}

#[wasm_bindgen]
pub fn hyper_memory_buffer() -> JsValue {
    wasm_bindgen::memory()
}

#[wasm_bindgen]
pub struct HyperMemory {
    // Structure of Arrays (SoA): better cache locality for vector math.
    ids: Vec<String>,
    flat_vectors: Vec<f32>,
    index_by_id: HashMap<String, usize>,
    dimension: usize,
    search_scores: Vec<(usize, f32)>,
    search_results: Vec<f32>,
}

#[wasm_bindgen]
impl HyperMemory {
    #[wasm_bindgen(constructor)]
    pub fn new(dimension: usize) -> HyperMemory {
        HyperMemory {
            ids: Vec::with_capacity(1000),
            flat_vectors: Vec::with_capacity(1000 * dimension.max(1)),
            index_by_id: HashMap::with_capacity(1000),
            dimension,
            search_scores: Vec::with_capacity(1000),
            search_results: Vec::with_capacity(100),
        }
    }

    pub fn insert(&mut self, id: String, vector: Vec<f32>) -> Result<(), JsValue> {
        if vector.len() != self.dimension {
            return Err(JsValue::from_str("Vector dimension mismatch"));
        }
        // Intentionally do not normalize on insert.
        // Search uses cosine similarity and computes per-vector norms on demand,
        // so callers may store raw feature vectors without mutating source scale.

        if let Some(&idx) = self.index_by_id.get(&id) {
            let start = idx * self.dimension;
            let end = start + self.dimension;
            self.flat_vectors[start..end].copy_from_slice(&vector);
            return Ok(());
        }

        let idx = self.ids.len();
        self.index_by_id.insert(id.clone(), idx);
        self.ids.push(id);
        self.flat_vectors.extend_from_slice(&vector);
        Ok(())
    }

    // ZERO-COPY SEARCH
    pub fn search(&mut self, query_vector: &[f32], k: usize) -> *const f32 {
        self.search_results.clear();

        if query_vector.len() != self.dimension || k == 0 || self.ids.is_empty() {
            return self.search_results.as_ptr();
        }

        let query_norm = l2_norm(query_vector);
        if query_norm == 0.0 {
            return self.search_results.as_ptr();
        }

        let num_vectors = self.ids.len();
        self.search_scores.clear();

        for idx in 0..num_vectors {
            let start = idx * self.dimension;
            let end = start + self.dimension;
            let target = &self.flat_vectors[start..end];
            let score = cosine_similarity_with_query_norm(query_vector, query_norm, target);
            self.search_scores.push((idx, score));
        }

        let take_k = k.min(self.search_scores.len());
        if take_k < self.search_scores.len() {
            self.search_scores
                .select_nth_unstable_by(take_k, |a, b| b.1.total_cmp(&a.1));
            self.search_scores.truncate(take_k);
        }
        self.search_scores
            .sort_unstable_by(|a, b| b.1.total_cmp(&a.1));

        for &(idx, score) in &self.search_scores {
            self.search_results.push(idx as f32);
            self.search_results.push(score);
        }

        self.search_results.as_ptr()
    }

    pub fn last_search_len(&self) -> usize {
        self.search_results.len() / 2
    }

    pub fn get_id(&self, index: usize) -> String {
        self.ids.get(index).cloned().unwrap_or_default()
    }

    pub fn count(&self) -> usize {
        self.ids.len()
    }

    // Serialization for persistence (V2 flat format).
    pub fn export_data(&self) -> Result<JsValue, JsValue> {
        let payload = HyperMemoryExportV2 {
            version: 2,
            dimension: self.dimension,
            ids: self.ids.clone(),
            flat_vectors: self.flat_vectors.clone(),
        };
        Ok(serde_wasm_bindgen::to_value(&payload)?)
    }

    pub fn import_data(&mut self, data: JsValue) -> Result<(), JsValue> {
        // V2 format.
        if let Ok(imported) = serde_wasm_bindgen::from_value::<HyperMemoryExportV2>(data.clone()) {
            if imported.dimension != self.dimension {
                return Err(JsValue::from_str("Imported dimension mismatch"));
            }
            if imported.ids.len() * self.dimension != imported.flat_vectors.len() {
                return Err(JsValue::from_str(
                    "Imported flat vector payload is corrupted",
                ));
            }
            self.ids = imported.ids;
            self.flat_vectors = imported.flat_vectors;
            self.rebuild_index();
            return Ok(());
        }

        // Legacy V1 format: Vec<(String, Vec<f32>)>.
        let imported_v1: Vec<(String, Vec<f32>)> = serde_wasm_bindgen::from_value(data)?;
        self.ids.clear();
        self.flat_vectors.clear();
        self.index_by_id.clear();
        self.ids.reserve(imported_v1.len());
        self.flat_vectors
            .reserve(imported_v1.len() * self.dimension);

        for (id, vec) in imported_v1 {
            if vec.len() != self.dimension {
                return Err(JsValue::from_str("Imported vector dimension mismatch"));
            }
            let idx = self.ids.len();
            self.index_by_id.insert(id.clone(), idx);
            self.ids.push(id);
            self.flat_vectors.extend_from_slice(&vec);
        }
        Ok(())
    }
}

fn l2_norm(v: &[f32]) -> f32 {
    let mut sum = 0.0;
    for value in v {
        sum += value * value;
    }
    sum.sqrt()
}

fn cosine_similarity_with_query_norm(query: &[f32], query_norm: f32, target: &[f32]) -> f32 {
    let mut dot_product = 0.0;
    let mut norm_b = 0.0;

    for i in 0..query.len() {
        dot_product += query[i] * target[i];
        norm_b += target[i] * target[i];
    }

    if query_norm == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot_product / (query_norm * norm_b.sqrt())
}

impl HyperMemory {
    fn rebuild_index(&mut self) {
        self.index_by_id.clear();
        self.index_by_id.reserve(self.ids.len());
        for (idx, id) in self.ids.iter().enumerate() {
            self.index_by_id.insert(id.clone(), idx);
        }
    }
}
