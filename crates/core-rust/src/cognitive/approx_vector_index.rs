use wasm_bindgen::prelude::*;
use js_sys::Float32Array;

#[wasm_bindgen]
pub struct SearchResultWasm {
    pub id: u32,
    pub score: f32,
}



// Zero-allocation cosine similarity taking flat f32 slices
#[inline(always)]
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || a.len() != b.len() { return 0.0; }
    let mut dot = 0.0;
    let mut an = 0.0;
    let mut bn = 0.0;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        an += a[i] * a[i];
        bn += b[i] * b[i];
    }
    if an == 0.0 || bn == 0.0 { return 0.0; }
    dot / (an.sqrt() * bn.sqrt())
}

#[wasm_bindgen]
pub struct WasmApproxVectorIndex {
    hyperplanes: u32,
    probes: u32,
    dimension: usize,
    planes: Vec<f32>,
    bucket_keys: Vec<u32>,
    bucket_offsets: Vec<u32>,
    bucket_ids: Vec<u32>,
    items_flat: Vec<f32>,
}

#[wasm_bindgen]
impl WasmApproxVectorIndex {
    #[wasm_bindgen(constructor)]
    pub fn new(hyperplanes_opt: Option<u32>, probes_opt: Option<u32>) -> Self {
        let hyperplanes = hyperplanes_opt.unwrap_or(18).clamp(4, 30);
        let probes = probes_opt.unwrap_or(6).clamp(0, 16);
        Self {
            hyperplanes,
            probes,
            dimension: 0,
            planes: Vec::new(),
            bucket_keys: Vec::new(),
            bucket_offsets: Vec::new(),
            bucket_ids: Vec::new(),
            items_flat: Vec::new(),
        }
    }

    #[wasm_bindgen]
    pub fn rebuild(&mut self, flat_vectors: Float32Array, dimension: u32) {
        let dim = dimension as usize;
        self.dimension = dim;
        self.items_flat.clear();
        self.bucket_keys.clear();
        self.bucket_offsets.clear();
        self.bucket_ids.clear();
        
        if dim == 0 || flat_vectors.length() == 0 { return; }
        
        // Convert Float32Array (JS) -> Vec<f32> (Rust) once and keep contiguous layout.
        let mut raw_data = flat_vectors.to_vec();
        let usable_len = (raw_data.len() / dim) * dim;
        raw_data.truncate(usable_len);
        let num_items = usable_len / dim;
        if num_items == 0 {
            return;
        }
        self.items_flat = raw_data;
        
        // Build flattened planes once: [plane0..., plane1..., ...].
        self.planes = Self::build_deterministic_planes(dim, self.hyperplanes);
        
        // Build (signature, id) list first, then compress to CSR-like arrays.
        let mut signature_pairs = Vec::with_capacity(num_items);
        for i in 0..num_items {
            let start = i * dim;
            let end = start + dim;
            let vec_slice = &self.items_flat[start..end];
            let sig = self.signature(vec_slice);
            signature_pairs.push((sig, i as u32));
        }

        signature_pairs.sort_unstable_by_key(|(sig, _)| *sig);

        self.bucket_ids.reserve(num_items);
        self.bucket_offsets.reserve(num_items + 1);
        self.bucket_keys.reserve(num_items);

        let mut current_key: Option<u32> = None;
        self.bucket_offsets.push(0);
        for (sig, id) in signature_pairs {
            if current_key != Some(sig) {
                if current_key.is_some() {
                    self.bucket_offsets.push(self.bucket_ids.len() as u32);
                }
                self.bucket_keys.push(sig);
                current_key = Some(sig);
            }
            self.bucket_ids.push(id);
        }
        if !self.bucket_keys.is_empty() {
            self.bucket_offsets.push(self.bucket_ids.len() as u32);
        }
    }

    #[wasm_bindgen]
    pub fn size(&self) -> u32 {
        self.item_count() as u32
    }

    #[wasm_bindgen]
    pub fn search(&self, query_js: Float32Array, k: u32, candidate_multiplier_opt: Option<u32>) -> Vec<SearchResultWasm> {
        let candidate_multiplier = candidate_multiplier_opt.unwrap_or(12);
        let query = query_js.to_vec();
        let item_count = self.item_count();
        
        if k == 0 || item_count == 0 || query.len() != self.dimension {
            return Vec::new();
        }

        let target_count = std::cmp::max(k * candidate_multiplier, 48) as usize;
        let candidates = self.collect_candidates(&query, target_count);

        let mut scored = Vec::with_capacity(candidates.len());
        for id in candidates {
            let vec = self.item_slice(id as usize);
            let score = cosine_similarity(&query, vec);
            scored.push(SearchResultWasm { id, score });
        }
        
        // Sort descending
        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        
        let take = std::cmp::min(k as usize, scored.len());
        scored.truncate(take);
        scored
    }

    fn collect_candidates(&self, query: &[f32], target_count: usize) -> Vec<u32> {
        let n = self.item_count();
        let target = std::cmp::min(target_count, n);
        if target == 0 {
            return Vec::new();
        }

        let mut seen = vec![false; n];
        let mut collected = Vec::with_capacity(target);
        let signature = self.signature(query);
        
        self.add_bucket(signature, &mut seen, &mut collected, target);
        
        if collected.len() < target {
            let max_probe = std::cmp::min(self.probes, self.hyperplanes);
            for bit in 0..max_probe {
                let neighbor = signature ^ (1 << bit);
                self.add_bucket(neighbor, &mut seen, &mut collected, target);
                if collected.len() >= target { break; }
            }
        }
        
        if collected.len() < target {
            let mut stride = n / std::cmp::max(1, target_count);
            if stride == 0 { stride = 1; }
            
            let start = signature as usize % stride;
            let mut idx = start;
            while idx < n && collected.len() < target {
                if !seen[idx] {
                    seen[idx] = true;
                    collected.push(idx as u32);
                }
                idx += stride;
            }
        }
        
        if collected.len() < target && n <= 256 {
            let mut i = 0;
            while (i < n) && (collected.len() < target) {
                if !seen[i] {
                    seen[i] = true;
                    collected.push(i as u32);
                }
                i += 1;
            }
        }
        
        collected
    }

    fn add_bucket(
        &self,
        signature: u32,
        seen: &mut [bool],
        collected: &mut Vec<u32>,
        target_count: usize,
    ) {
        if let Some((start, end)) = self.bucket_range(signature) {
            for idx in start..end {
                let id = self.bucket_ids[idx] as usize;
                if id < seen.len() && !seen[id] {
                    seen[id] = true;
                    collected.push(id as u32);
                }
                if collected.len() >= target_count {
                    return;
                }
            }
        }
    }

    fn signature(&self, vector: &[f32]) -> u32 {
        let mut signature: u32 = 0;
        let bits = std::cmp::min(self.hyperplanes, 30);
        for bit in 0..bits {
            let mut projection = 0.0;
            let plane_start = bit as usize * self.dimension;
            for i in 0..self.dimension {
                projection += vector[i] * self.planes[plane_start + i];
            }
            if projection >= 0.0 {
                signature |= 1 << bit;
            }
        }
        signature
    }

    fn build_deterministic_planes(dimension: usize, count: u32) -> Vec<f32> {
        let plane_count = count as usize;
        let mut planes = Vec::with_capacity(plane_count * dimension);
        let mut seed: u32 = (dimension as u32).wrapping_mul(2654435761) ^ count.wrapping_mul(2246822519);
        
        let mut next = || -> f32 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed as f64 / 0xffffffffu32 as f64) as f32
        };

        for _ in 0..count {
            for _ in 0..dimension {
                let r = next();
                planes.push(r * 2.0 - 1.0);
            }
        }
        planes
    }

    fn bucket_range(&self, signature: u32) -> Option<(usize, usize)> {
        let pos = self.bucket_keys.binary_search(&signature).ok()?;
        let start = *self.bucket_offsets.get(pos)? as usize;
        let end = *self.bucket_offsets.get(pos + 1)? as usize;
        Some((start, end))
    }

    fn item_count(&self) -> usize {
        if self.dimension == 0 {
            0
        } else {
            self.items_flat.len() / self.dimension
        }
    }

    fn item_slice(&self, id: usize) -> &[f32] {
        let start = id * self.dimension;
        let end = start + self.dimension;
        &self.items_flat[start..end]
    }
}
