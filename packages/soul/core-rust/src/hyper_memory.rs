use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub score: f32,
}

#[wasm_bindgen]
pub struct HyperMemory {
    vectors: Vec<(String, Vec<f32>)>,
    dimension: usize,
}

#[wasm_bindgen]
impl HyperMemory {
    #[wasm_bindgen(constructor)]
    pub fn new(dimension: usize) -> HyperMemory {
        HyperMemory {
            vectors: Vec::new(),
            dimension,
        }
    }

    pub fn insert(&mut self, id: String, vector: Vec<f32>) -> Result<(), JsValue> {
        if vector.len() != self.dimension {
            return Err(JsValue::from_str("Vector dimension mismatch"));
        }
        // Remove existing if any (simple implementation)
        if let Some(pos) = self.vectors.iter().position(|(i, _)| i == &id) {
            self.vectors.remove(pos);
        }
        
        self.vectors.push((id, vector));
        Ok(())
    }

    pub fn search(&self, query_vector: Vec<f32>, k: usize) -> Result<JsValue, JsValue> {
        if query_vector.len() != self.dimension {
            return Err(JsValue::from_str("Query vector dimension mismatch"));
        }

        let mut scores: Vec<(String, f32)> = self.vectors
            .iter()
            .map(|(id, vec)| {
                let score = cosine_similarity(&query_vector, vec);
                (id.clone(), score)
            })
            .collect();

        // Sort by score descending
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // Take top k
        let results: Vec<SearchResult> = scores.into_iter()
            .take(k)
            .map(|(id, score)| SearchResult { id, score })
            .collect();

        Ok(serde_wasm_bindgen::to_value(&results)?)
    }

    pub fn count(&self) -> usize {
        self.vectors.len()
    }
    
    // Serialization for persistence
    pub fn export_data(&self) -> Result<JsValue, JsValue> {
        Ok(serde_wasm_bindgen::to_value(&self.vectors)?)
    }
    
    pub fn import_data(&mut self, data: JsValue) -> Result<(), JsValue> {
        let imported: Vec<(String, Vec<f32>)> = serde_wasm_bindgen::from_value(data)?;
        // Validate dimensions
        for (_, vec) in &imported {
            if vec.len() != self.dimension {
                 return Err(JsValue::from_str("Imported vector dimension mismatch"));
            }
        }
        self.vectors = imported;
        Ok(())
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot_product = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for i in 0..a.len() {
        dot_product += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot_product / (norm_a.sqrt() * norm_b.sqrt())
}
