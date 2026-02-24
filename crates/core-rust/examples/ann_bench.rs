use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0;
    let mut an = 0.0;
    let mut bn = 0.0;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        an += a[i] * a[i];
        bn += b[i] * b[i];
    }
    if an == 0.0 || bn == 0.0 {
        return 0.0;
    }
    dot / (an.sqrt() * bn.sqrt())
}

trait AnnIndex {
    fn rebuild(&mut self, flat_vectors: &[f32], dimension: usize);
    fn search(&self, query: &[f32], k: u32, candidate_multiplier: u32) -> Vec<(u32, f32)>;
}

#[derive(Default)]
struct BaselineIndex {
    hyperplanes: u32,
    probes: u32,
    dimension: usize,
    planes: Vec<Vec<f32>>,
    buckets: HashMap<u32, Vec<u32>>,
    items: Vec<Vec<f32>>,
}

impl BaselineIndex {
    fn new(hyperplanes: u32, probes: u32) -> Self {
        Self {
            hyperplanes: hyperplanes.clamp(4, 30),
            probes: probes.clamp(0, 16),
            ..Self::default()
        }
    }

    fn signature(&self, vector: &[f32]) -> u32 {
        let mut signature = 0u32;
        let bits = self.hyperplanes.min(30);
        for bit in 0..bits {
            let mut projection = 0.0;
            let plane = &self.planes[bit as usize];
            for i in 0..self.dimension {
                projection += vector[i] * plane[i];
            }
            if projection >= 0.0 {
                signature |= 1 << bit;
            }
        }
        signature
    }

    fn collect_candidates(&self, query: &[f32], target_count: usize) -> HashSet<u32> {
        let mut collected = HashSet::new();
        let signature = self.signature(query);

        self.add_bucket(signature, &mut collected, target_count);

        if collected.len() < target_count {
            let max_probe = self.probes.min(self.hyperplanes);
            for bit in 0..max_probe {
                let neighbor = signature ^ (1 << bit);
                self.add_bucket(neighbor, &mut collected, target_count);
                if collected.len() >= target_count {
                    break;
                }
            }
        }

        if collected.len() < target_count {
            let n = self.items.len();
            let mut stride = n / std::cmp::max(1, target_count);
            if stride == 0 {
                stride = 1;
            }

            let start = signature as usize % stride;
            let mut idx = start;
            while idx < n && collected.len() < target_count {
                collected.insert(idx as u32);
                idx += stride;
            }
        }

        if collected.len() < std::cmp::min(target_count, self.items.len()) && self.items.len() <= 256 {
            let mut i = 0;
            while i < self.items.len() && collected.len() < target_count {
                collected.insert(i as u32);
                i += 1;
            }
        }

        collected
    }

    fn add_bucket(&self, signature: u32, collected: &mut HashSet<u32>, target_count: usize) {
        if let Some(bucket) = self.buckets.get(&signature) {
            for &id in bucket {
                collected.insert(id);
                if collected.len() >= target_count {
                    return;
                }
            }
        }
    }
}

impl AnnIndex for BaselineIndex {
    fn rebuild(&mut self, flat_vectors: &[f32], dimension: usize) {
        self.dimension = dimension;
        self.items.clear();
        self.buckets.clear();

        if dimension == 0 || flat_vectors.is_empty() {
            return;
        }

        self.planes = build_deterministic_planes_nested(dimension, self.hyperplanes);

        let num_items = flat_vectors.len() / dimension;
        for i in 0..num_items {
            let start = i * dimension;
            let end = start + dimension;
            let vec_slice = &flat_vectors[start..end];
            let sig = self.signature(vec_slice);
            self.items.push(vec_slice.to_vec());
            self.buckets.entry(sig).or_default().push(i as u32);
        }
    }

    fn search(&self, query: &[f32], k: u32, candidate_multiplier: u32) -> Vec<(u32, f32)> {
        if k == 0 || self.items.is_empty() || query.len() != self.dimension {
            return Vec::new();
        }

        let target_count = std::cmp::max(k * candidate_multiplier, 48) as usize;
        let candidates = self.collect_candidates(query, target_count);

        let mut scored: Vec<(u32, f32)> = candidates
            .into_iter()
            .map(|id| {
                let score = cosine_similarity(query, &self.items[id as usize]);
                (id, score)
            })
            .collect();

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        scored.truncate(std::cmp::min(k as usize, scored.len()));
        scored
    }
}

#[derive(Default)]
struct OptimizedIndex {
    hyperplanes: u32,
    probes: u32,
    dimension: usize,
    planes: Vec<f32>,
    bucket_keys: Vec<u32>,
    bucket_offsets: Vec<u32>,
    bucket_ids: Vec<u32>,
    items_flat: Vec<f32>,
}

impl OptimizedIndex {
    fn new(hyperplanes: u32, probes: u32) -> Self {
        Self {
            hyperplanes: hyperplanes.clamp(4, 30),
            probes: probes.clamp(0, 16),
            ..Self::default()
        }
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

    fn bucket_range(&self, signature: u32) -> Option<(usize, usize)> {
        let pos = self.bucket_keys.binary_search(&signature).ok()?;
        let start = *self.bucket_offsets.get(pos)? as usize;
        let end = *self.bucket_offsets.get(pos + 1)? as usize;
        Some((start, end))
    }

    fn signature(&self, vector: &[f32]) -> u32 {
        let mut signature = 0u32;
        let bits = self.hyperplanes.min(30);
        for bit in 0..bits {
            let plane_start = bit as usize * self.dimension;
            let mut projection = 0.0;
            for i in 0..self.dimension {
                projection += vector[i] * self.planes[plane_start + i];
            }
            if projection >= 0.0 {
                signature |= 1 << bit;
            }
        }
        signature
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
            let max_probe = self.probes.min(self.hyperplanes);
            for bit in 0..max_probe {
                let neighbor = signature ^ (1 << bit);
                self.add_bucket(neighbor, &mut seen, &mut collected, target);
                if collected.len() >= target {
                    break;
                }
            }
        }

        if collected.len() < target {
            let mut stride = n / std::cmp::max(1, target_count);
            if stride == 0 {
                stride = 1;
            }

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
            while i < n && collected.len() < target {
                if !seen[i] {
                    seen[i] = true;
                    collected.push(i as u32);
                }
                i += 1;
            }
        }

        collected
    }

    fn add_bucket(&self, signature: u32, seen: &mut [bool], collected: &mut Vec<u32>, target_count: usize) {
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
}

impl AnnIndex for OptimizedIndex {
    fn rebuild(&mut self, flat_vectors: &[f32], dimension: usize) {
        self.dimension = dimension;
        self.items_flat.clear();
        self.bucket_keys.clear();
        self.bucket_offsets.clear();
        self.bucket_ids.clear();

        if dimension == 0 || flat_vectors.is_empty() {
            return;
        }

        let usable_len = (flat_vectors.len() / dimension) * dimension;
        let num_items = usable_len / dimension;
        if num_items == 0 {
            return;
        }

        self.items_flat.extend_from_slice(&flat_vectors[..usable_len]);
        self.planes = build_deterministic_planes_flat(dimension, self.hyperplanes);

        let mut signature_pairs = Vec::with_capacity(num_items);
        for i in 0..num_items {
            let start = i * dimension;
            let end = start + dimension;
            let sig = self.signature(&self.items_flat[start..end]);
            signature_pairs.push((sig, i as u32));
        }

        signature_pairs.sort_unstable_by_key(|(sig, _)| *sig);

        self.bucket_ids.reserve(num_items);
        self.bucket_offsets.reserve(num_items + 1);
        self.bucket_keys.reserve(num_items);

        self.bucket_offsets.push(0);
        let mut current_key = None;
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

    fn search(&self, query: &[f32], k: u32, candidate_multiplier: u32) -> Vec<(u32, f32)> {
        let n = self.item_count();
        if k == 0 || n == 0 || query.len() != self.dimension {
            return Vec::new();
        }

        let target_count = std::cmp::max(k * candidate_multiplier, 48) as usize;
        let candidates = self.collect_candidates(query, target_count);
        let mut scored = Vec::with_capacity(candidates.len());
        for id in candidates {
            let score = cosine_similarity(query, self.item_slice(id as usize));
            scored.push((id, score));
        }

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        scored.truncate(std::cmp::min(k as usize, scored.len()));
        scored
    }
}

fn build_deterministic_planes_nested(dimension: usize, count: u32) -> Vec<Vec<f32>> {
    let mut planes: Vec<Vec<f32>> = Vec::with_capacity(count as usize);
    let mut seed: u32 = (dimension as u32).wrapping_mul(2654435761) ^ count.wrapping_mul(2246822519);

    let mut next = || -> f32 {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        (seed as f64 / 0xffff_ffffu32 as f64) as f32
    };

    for _ in 0..count {
        let mut plane = Vec::with_capacity(dimension);
        for _ in 0..dimension {
            let r = next();
            plane.push(r * 2.0 - 1.0);
        }
        planes.push(plane);
    }
    planes
}

fn build_deterministic_planes_flat(dimension: usize, count: u32) -> Vec<f32> {
    let mut planes = Vec::with_capacity(dimension * count as usize);
    let mut seed: u32 = (dimension as u32).wrapping_mul(2654435761) ^ count.wrapping_mul(2246822519);

    let mut next = || -> f32 {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        (seed as f64 / 0xffff_ffffu32 as f64) as f32
    };

    for _ in 0..count {
        for _ in 0..dimension {
            let r = next();
            planes.push(r * 2.0 - 1.0);
        }
    }
    planes
}

fn generate_vectors(n: usize, dimension: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(n * dimension);
    let mut seed = 0x1234ABCDu32;
    for _ in 0..(n * dimension) {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let x = (seed as f64 / 0xffff_ffffu32 as f64) as f32;
        out.push(x * 2.0 - 1.0);
    }
    out
}

fn generate_queries(data: &[f32], n: usize, dimension: usize, count: usize) -> Vec<Vec<f32>> {
    let mut queries = Vec::with_capacity(count);
    let mut seed = 0xBADC0DEu32;
    for _ in 0..count {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let idx = (seed as usize % n) * dimension;
        let mut q = data[idx..idx + dimension].to_vec();
        for v in &mut q {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed as f64 / 0xffff_ffffu32 as f64) as f32 - 0.5) * 0.02;
            *v += noise;
        }
        queries.push(q);
    }
    queries
}

#[derive(Clone, Copy)]
struct BenchResult {
    rebuild: Duration,
    search_total: Duration,
    checksum: f64,
}

fn run_bench<T: AnnIndex>(mut index: T, data: &[f32], dim: usize, queries: &[Vec<f32>], k: u32, cm: u32) -> BenchResult {
    let t0 = Instant::now();
    index.rebuild(data, dim);
    let rebuild = t0.elapsed();

    for q in queries.iter().take(10) {
        let _ = index.search(q, k, cm);
    }

    let t1 = Instant::now();
    let mut checksum = 0.0f64;
    for q in queries {
        let out = index.search(q, k, cm);
        if let Some((id, score)) = out.first() {
            checksum += *score as f64 + (*id as f64 * 1e-9);
        }
    }
    let search_total = t1.elapsed();

    BenchResult {
        rebuild,
        search_total,
        checksum,
    }
}

fn format_ms(d: Duration) -> String {
    format!("{:.3}", d.as_secs_f64() * 1000.0)
}

fn main() {
    let dimension = 64usize;
    let hyperplanes = 18u32;
    let probes = 6u32;
    let k = 20u32;
    let candidate_multiplier = 12u32;
    let queries_per_case = 200usize;
    let sizes = [1_000usize, 10_000usize, 100_000usize];

    println!("ANN benchmark (baseline vs optimized)");
    println!("dim={}, hyperplanes={}, probes={}, k={}, candidate_multiplier={}, queries={}", dimension, hyperplanes, probes, k, candidate_multiplier, queries_per_case);
    println!();
    println!("{:<8} {:<10} {:>12} {:>14} {:>14} {:>12}", "N", "Variant", "Rebuild(ms)", "SearchTotal(ms)", "SearchAvg(ms)", "Checksum");

    for &n in &sizes {
        let data = generate_vectors(n, dimension);
        let queries = generate_queries(&data, n, dimension, queries_per_case);

        let baseline = run_bench(
            BaselineIndex::new(hyperplanes, probes),
            &data,
            dimension,
            &queries,
            k,
            candidate_multiplier,
        );

        let optimized = run_bench(
            OptimizedIndex::new(hyperplanes, probes),
            &data,
            dimension,
            &queries,
            k,
            candidate_multiplier,
        );

        let base_avg = baseline.search_total.as_secs_f64() * 1000.0 / queries_per_case as f64;
        let opt_avg = optimized.search_total.as_secs_f64() * 1000.0 / queries_per_case as f64;

        println!(
            "{:<8} {:<10} {:>12} {:>14} {:>14.3} {:>12.4}",
            n,
            "before",
            format_ms(baseline.rebuild),
            format_ms(baseline.search_total),
            base_avg,
            baseline.checksum
        );

        println!(
            "{:<8} {:<10} {:>12} {:>14} {:>14.3} {:>12.4}",
            n,
            "after",
            format_ms(optimized.rebuild),
            format_ms(optimized.search_total),
            opt_avg,
            optimized.checksum
        );

        let rebuild_speedup = baseline.rebuild.as_secs_f64() / optimized.rebuild.as_secs_f64();
        let search_speedup = baseline.search_total.as_secs_f64() / optimized.search_total.as_secs_f64();
        println!("{: <8} {: <10} rebuild x{:.2}, search x{:.2}", "", "speedup", rebuild_speedup, search_speedup);
        println!();
    }
}
