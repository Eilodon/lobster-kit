// memory.rs — Memory search engines: episodic, semantic, causal, and risk estimation.
//
// Extracted from main.rs. Uses impl-block extension pattern:
// EidolonMcpServer methods live here, struct definition remains in main.rs.

use crate::helpers::*;
use crate::types::MemoryEntry;
use crate::EidolonMcpServer;
use core_rust::sentinel::variables::SentinelVariable;
use std::collections::HashMap;

impl EidolonMcpServer {
    pub(crate) async fn estimate_historical_risk_prior(&self, tenant_id: &str, query: &str) -> f64 {
        let tokens = sentence_token_set(query);
        if tokens.is_empty() {
            return 0.0;
        }

        let memories = self.memories.read().await;
        let tenant_mems_opt = memories.get(tenant_id);
        if tenant_mems_opt.is_none() {
            return 0.0;
        }
        let tenant_mems = tenant_mems_opt.unwrap();
        if tenant_mems.is_empty() {
            return 0.0;
        }

        let now = chrono::Utc::now().timestamp_millis();
        let mut weighted_sum = 0.0;
        let mut total_weight = 0.0;

        for memory in tenant_mems.iter().rev().take(250) {
            let content_tokens = sentence_token_set(&memory.content);
            if content_tokens.is_empty() {
                continue;
            }
            let overlap = jaccard_similarity(&tokens, &content_tokens);
            if overlap <= 0.02 {
                continue;
            }

            let age_ms = (now - memory.timestamp).max(0) as f64;
            let recency = 1.0 / (1.0 + (age_ms / 1000.0 + 1.0).log10());

            let lowered = memory.content.to_ascii_lowercase();
            let severity = extract_outcome_severity(&memory.content)
                .map(|value| value / 5.0)
                .unwrap_or_else(|| {
                    if lowered.contains("exploit")
                        || lowered.contains("attack")
                        || lowered.contains("inhibited")
                    {
                        0.85
                    } else if lowered.contains("risk") || lowered.contains("warning") {
                        0.55
                    } else {
                        0.2
                    }
                });
            let weight = overlap * (0.6 + 0.4 * recency);
            weighted_sum += clamp01(severity) * weight;
            total_weight += weight;
        }

        if total_weight <= 0.0 {
            0.0
        } else {
            clamp01(weighted_sum / total_weight)
        }
    }

    pub(crate) fn episodic_memory_search(
        memories: &[MemoryEntry],
        query: &str,
        limit: usize,
    ) -> Vec<serde_json::Value> {
        let query_tokens = simple_tokenize(query);
        let now = chrono::Utc::now().timestamp_millis();
        let mut scored: Vec<(f64, &MemoryEntry)> = memories
            .iter()
            .map(|memory| {
                let content_lower = memory.content.to_ascii_lowercase();
                let category_lower = memory.category.to_ascii_lowercase();
                let mut score = 0.0;

                if !query.is_empty() && content_lower.contains(&query.to_ascii_lowercase()) {
                    score += 1.0;
                }
                let overlap = query_tokens
                    .iter()
                    .filter(|token| {
                        content_lower.contains(token.as_str())
                            || category_lower.contains(token.as_str())
                    })
                    .count() as f64;
                if !query_tokens.is_empty() {
                    score += overlap / query_tokens.len() as f64;
                }

                let age_ms = (now - memory.timestamp).max(0) as f64;
                let recency_bonus = 1.0 / (1.0 + (age_ms / 1000.0 + 1.0).log10());
                score += recency_bonus * 0.25;

                (score, memory)
            })
            .filter(|(score, _)| *score > 0.08)
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
            .into_iter()
            .take(limit)
            .map(|(score, memory)| {
                serde_json::json!({
                    "route": "episodic",
                    "score": clamp01(score),
                    "timestamp": memory.timestamp,
                    "category": memory.category,
                    "content": memory.content
                })
            })
            .collect()
    }

    pub(crate) fn semantic_memory_search(
        &self,
        memories: &[MemoryEntry],
        query: &str,
        limit: usize,
    ) -> (Vec<serde_json::Value>, String) {
        if query.is_empty() {
            return (Vec::new(), "none".to_string());
        }
        let (query_vector, backend) = self.embed_text_with_fallback(query);
        let semantic_threshold = if backend == "onnx_minilm" { 0.22 } else { 0.1 };
        let mut scored: Vec<(f64, &MemoryEntry)> = memories
            .iter()
            .map(|memory| {
                let mem_vector = if !memory.embedding.is_empty()
                    && memory.embedding.len() == query_vector.len()
                {
                    memory.embedding.clone()
                } else {
                    self.embed_text_with_fallback(&memory.content).0
                };
                (cosine_similarity(&query_vector, &mem_vector), memory)
            })
            .filter(|(score, _)| *score > semantic_threshold)
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let results = scored
            .into_iter()
            .take(limit)
            .map(|(score, memory)| {
                serde_json::json!({
                    "route": "semantic",
                    "score": clamp01(score),
                    "timestamp": memory.timestamp,
                    "category": memory.category,
                    "content": memory.content,
                    "embedding_backend": backend
                })
            })
            .collect();
        (results, backend.to_string())
    }

    pub(crate) async fn causal_memory_search(
        &self,
        memories: &[MemoryEntry],
        query: &str,
        limit: usize,
    ) -> Vec<serde_json::Value> {
        let target = infer_target_variable(query);
        let recent_memories: Vec<&MemoryEntry> = memories.iter().rev().take(40).collect();
        let mut observation_scores: HashMap<SentinelVariable, f64> = HashMap::new();

        for variable in SentinelVariable::all().iter().copied() {
            let mut sum = 0.0;
            for memory in &recent_memories {
                sum += variable_observation_score(variable, &memory.content);
            }
            let normalized = if recent_memories.is_empty() {
                0.0
            } else {
                sum / recent_memories.len() as f64
            };
            observation_scores.insert(variable, clamp01(normalized));
        }

        let mut scored_edges: Vec<(f64, SentinelVariable, f64, f64)> = Vec::new();
        {
            let brain = self.causal_brain.read().await;
            for cause in SentinelVariable::all().iter().copied() {
                if cause == target {
                    continue;
                }
                let effect_weight = brain.get_causal_effect(cause.index(), target.index()) as f64;
                let observation = observation_scores.get(&cause).copied().unwrap_or(0.0);
                let causal_score = clamp01(effect_weight) * clamp01(observation);
                if effect_weight > 0.0 || observation > 0.0 {
                    scored_edges.push((causal_score, cause, effect_weight, observation));
                }
            }
        }

        scored_edges.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored_edges
            .into_iter()
            .take(limit)
            .map(|(score, cause, effect_weight, observation)| {
                serde_json::json!({
                    "route": "causal",
                    "score": clamp01(score),
                    "cause_variable": cause.name(),
                    "target_variable": target.name(),
                    "effect_weight": clamp01(effect_weight),
                    "observation_score": clamp01(observation)
                })
            })
            .collect()
    }
}
