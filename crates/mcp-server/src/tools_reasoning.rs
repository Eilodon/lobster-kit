use crate::EidolonMcpServer;
use crate::embedding::EmbeddingEngine;
use crate::types::*;
use crate::helpers::*;
use crate::oracle::query_local_llm;
use core_rust::sentinel::causal::CausalGraph;
use std::collections::HashMap;
use std::collections::HashSet;

impl EidolonMcpServer {
    pub(crate) async fn handle_reason_chain(&self, params: serde_json::Value) -> serde_json::Value {
            let started = std::time::Instant::now();
            let draft = params["draft"].as_str().unwrap_or("");
            let context = params["context"].as_str().unwrap_or("");
            let requested_mode = params["mode"].as_str().unwrap_or("auto");
            let latency_budget_ms = params["latency_budget_ms"]
                .as_u64()
                .unwrap_or_else(Self::default_reasoning_latency_budget_ms)
                .max(200);

            let (mode_selected, fallback_used, policy_reason) = self
                .select_reasoning_mode(requested_mode, draft, context, latency_budget_ms)
                .await;

            let prompt = format!(
                "Evaluate this draft against the context. Does the draft hallucinate facts not in context? How much does it overlap with the core context? Return ONLY a JSON object with 'factual_consistency' (float 0.0-1.0) and 'context_overlap' (float 0.0-1.0).\nDraft: {}\nContext: {}",
                draft, context
            );

            let llm_res = query_local_llm(&prompt).await;
            let mut factual_consistency = 0.5;
            let mut context_overlap = 0.5;
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&llm_res) {
                if let Some(fc) = parsed.get("factual_consistency").and_then(|v| v.as_f64()) {
                    factual_consistency = clamp01(fc);
                }
                if let Some(co) = parsed.get("context_overlap").and_then(|v| v.as_f64()) {
                    context_overlap = clamp01(co);
                }
            }

            let critic_penalty = clamp01(1.0 - factual_consistency);
            let mut critic_findings: Vec<String> = Vec::new();
            if factual_consistency < 1.0 {
                critic_findings.push("hallucination_detected".to_string());
            }
            if context_overlap < 0.5 {
                critic_findings.push("low_context_overlap".to_string());
            }

            let iterations = if mode_selected == "deep" { 3 } else { 1 };

            let mut thermo = self.thermo.lock().await;
            let ratio = (context_overlap as f32).max(0.1);

            let mut state = nalgebra::DVector::from_element(5, 0.5 * ratio);
            let target = nalgebra::DVector::from_element(5, 0.1);
            thermo.step(&mut state, &target);
            let entropy = thermo.entropy(&state);
            drop(thermo);

            let coherence_score = clamp01((1.0 - (entropy as f64 / 2.0)).clamp(0.0, 1.0));
            let mut branches: Vec<serde_json::Value> = Vec::new();
            let branch_templates: [&str; 4] =
                ["conservative", "balanced", "exploratory", "counterfactual"];
            let branch_count = if mode_selected == "deep" { 4 } else { 2 };
            for (index, strategy) in branch_templates.iter().take(branch_count).enumerate() {
                let exploration_bias = (index as f64) * 0.05;
                let branch_score = clamp01(
                    coherence_score * 0.6 + (1.0 - critic_penalty) * 0.35 + exploration_bias,
                );
                branches.push(serde_json::json!({
                    "strategy": strategy,
                    "step_count": if mode_selected == "deep" { 3 + index as u64 } else { 2 + index as u64 },
                    "score": branch_score
                }));
            }
            branches.sort_by(|a, b| {
                let ascore = a.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let bscore = b.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
                bscore
                    .partial_cmp(&ascore)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let selected_branch = branches
                .first()
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let best_branch_score = branches
                .first()
                .and_then(|branch| branch.get("score"))
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);

            let mut evidence_pool: Vec<serde_json::Value> = split_sentences(context)
                .into_iter()
                .take(16)
                .enumerate()
                .map(|(index, sentence)| {
                    serde_json::json!({
                        "id": format!("ctx_{}", index),
                        "source": "context",
                        "content": sentence
                    })
                })
                .collect();

            let memories_snapshot = { self.memories.lock().await.clone() };
            if !memories_snapshot.is_empty() {
                let retrieval_query = format!("{} {}", draft, context);
                let episodic_evidence =
                    Self::episodic_memory_search(&memories_snapshot, &retrieval_query, 6);
                let (semantic_evidence, _) =
                    self.semantic_memory_search(&memories_snapshot, &retrieval_query, 6);

                for record in episodic_evidence
                    .into_iter()
                    .chain(semantic_evidence.into_iter())
                    .take(10)
                {
                    let content = record
                        .get("content")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    if content.is_empty() {
                        continue;
                    }
                    let timestamp = record
                        .get("timestamp")
                        .and_then(|value| value.as_i64())
                        .unwrap_or_default();
                    let category = record
                        .get("category")
                        .and_then(|value| value.as_str())
                        .unwrap_or("memory");
                    evidence_pool.push(serde_json::json!({
                        "id": format!("mem_{}_{}", category, timestamp),
                        "source": "memory",
                        "content": content
                    }));
                }
            }

            let mut seen_evidence = HashSet::new();
            evidence_pool.retain(|item| {
                let content = item
                    .get("content")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_lowercase();
                if content.is_empty() {
                    return false;
                }
                seen_evidence.insert(content)
            });

            let claim_sentences = {
                let parsed_claims = split_sentences(draft);
                if parsed_claims.is_empty() && !draft.trim().is_empty() {
                    vec![draft.trim().to_string()]
                } else {
                    parsed_claims
                }
            };
            let groundedness_threshold = if mode_selected == "deep" { 0.6 } else { 0.45 };
            let overlap_threshold = if mode_selected == "deep" { 0.18 } else { 0.14 };
            let mut supported_claims = 0usize;
            let mut unsupported_claims: Vec<String> = Vec::new();
            let mut used_evidence_ids: HashSet<String> = HashSet::new();

            for claim in &claim_sentences {
                let claim_tokens = sentence_token_set(claim);
                if claim_tokens.is_empty() {
                    continue;
                }

                let mut best_overlap = 0.0;
                let mut best_evidence_id: Option<String> = None;

                for evidence in &evidence_pool {
                    let evidence_id = evidence
                        .get("id")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default();
                    let evidence_tokens = sentence_token_set(
                        evidence
                            .get("content")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default(),
                    );
                    if evidence_tokens.is_empty() {
                        continue;
                    }
                    let overlap = jaccard_similarity(&claim_tokens, &evidence_tokens);
                    if overlap > best_overlap {
                        best_overlap = overlap;
                        best_evidence_id = Some(evidence_id.to_string());
                    }
                }

                if best_overlap >= overlap_threshold {
                    supported_claims += 1;
                    if let Some(id) = best_evidence_id {
                        used_evidence_ids.insert(id);
                    }
                } else {
                    unsupported_claims.push(claim.clone());
                }
            }

            let groundedness_coverage = if claim_sentences.is_empty() {
                1.0
            } else {
                clamp01(supported_claims as f64 / claim_sentences.len().max(1) as f64)
            };
            let groundedness_pass =
                claim_sentences.is_empty() || groundedness_coverage >= groundedness_threshold;

            if !unsupported_claims.is_empty() {
                critic_findings.push("evidence_coverage_gap".to_string());
            }
            if !groundedness_pass {
                critic_findings.push("groundedness_gate_failed".to_string());
            }

            let verifier_score = clamp01(
                best_branch_score * 0.55
                    + (1.0 - critic_penalty) * 0.25
                    + groundedness_coverage * 0.20,
            );
            let reasoning_latency_ms = started.elapsed().as_millis() as u64;
            let slo_warning = reasoning_latency_ms > latency_budget_ms;
            let mut final_score = verifier_score;
            if slo_warning {
                final_score = clamp01(final_score * 0.92);
            }
            if !groundedness_pass {
                final_score = clamp01(final_score * 0.86);
            }

            let insight = format!(
                "mode={} policy={} factual_consist={:.2} overlap={:.2} grounded={:.2} verifier={:.3}",
                mode_selected,
                policy_reason,
                factual_consistency,
                context_overlap,
                groundedness_coverage,
                verifier_score
            );

            let mut used_evidence_id_list: Vec<String> =
                used_evidence_ids.into_iter().collect();
            used_evidence_id_list.sort();

            serde_json::json!({
                "draft_evaluation": insight,
                "final_score": final_score,
                "thermo_entropy": entropy,
                "iterations": iterations,
                "mode_selected": mode_selected,
                "fallback_used": fallback_used,
                "reasoning_latency_ms": reasoning_latency_ms,
                "pipeline": {
                    "critic": {
                        "findings": critic_findings,
                        "penalty": critic_penalty
                    },
                    "tot": {
                        "branches": branches,
                        "selected_branch": selected_branch
                    },
                    "verifier": {
                        "score": verifier_score,
                        "slo_warning": slo_warning,
                        "groundedness_coverage": groundedness_coverage,
                        "groundedness_threshold": groundedness_threshold,
                        "groundedness_pass": groundedness_pass,
                        "unsupported_claim_count": unsupported_claims.len(),
                        "unsupported_claims": unsupported_claims,
                        "evidence_ids": used_evidence_id_list
                    }
                },
                "evidence": {
                    "pool_size": evidence_pool.len()
                },
                "policy": {
                    "requested_mode": requested_mode,
                    "latency_budget_ms": latency_budget_ms,
                    "decision_reason": policy_reason
                }
            })
    }

    pub(crate) async fn handle_recall_similar(&self, params: serde_json::Value) -> serde_json::Value {
            // P1: search memories by context similarity using ONNX embeddings when available.
            let context = params["context"].as_str().unwrap_or("");
            let k = params["k"].as_u64().unwrap_or(5) as usize;
            let mems_snapshot = { self.memories.lock().await.clone() };

            if context.is_empty() || mems_snapshot.is_empty() {
                return serde_json::json!({
                    "matches": [],
                    "total_memories": mems_snapshot.len(),
                    "note": "No context provided or memory store is empty."
                });
            }

            let (query_vec, embedding_backend) = self.embed_text_with_fallback(context);
            let semantic_threshold = if embedding_backend == "onnx_minilm" {
                0.22
            } else {
                0.1
            };

            let mut scored: Vec<(f64, &MemoryEntry)> = mems_snapshot
                .iter()
                .map(|m| {
                    let similarity =
                        if !m.embedding.is_empty() && m.embedding.len() == query_vec.len() {
                            cosine_similarity(&query_vec, &m.embedding)
                        } else {
                            let mem_vec = self.embed_text_with_fallback(&m.content).0;
                            cosine_similarity(&query_vec, &mem_vec)
                        };
                    (similarity, m)
                })
                .filter(|(s, _)| *s > semantic_threshold)
                .collect();

            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

            let results: Vec<serde_json::Value> = scored
                .iter()
                .take(k)
                .map(|(sim, m)| {
                    serde_json::json!({
                        "similarity": sim,
                        "category": m.category,
                        "content": m.content,
                        "timestamp": m.timestamp
                    })
                })
                .collect();

            serde_json::json!({
                "matches": results,
                "total_memories": mems_snapshot.len(),
                "embedding_backend": embedding_backend
            })
    }

    pub(crate) async fn handle_memory_query(&self, params: serde_json::Value) -> serde_json::Value {
            // P1: memory router with quality scorer across episodic/semantic/causal routes.
            let query = params["query"].as_str().unwrap_or("");
            let route_requested = params["route"]
                .as_str()
                .unwrap_or("auto")
                .to_ascii_lowercase();
            let limit = params["k"].as_u64().unwrap_or(10).clamp(1, 50) as usize;
            let route_candidates = memory_route_candidates(query);
            let memories_snapshot = { self.memories.lock().await.clone() };

            if query.is_empty() {
                let results: Vec<serde_json::Value> = memories_snapshot
                    .iter()
                    .rev()
                    .take(limit)
                    .map(|m| {
                        serde_json::json!({
                            "route": "episodic",
                            "score": 1.0,
                            "timestamp": m.timestamp,
                            "category": m.category,
                            "content": m.content
                        })
                    })
                    .collect();
                return serde_json::json!({
                    "query": "*",
                    "route_requested": route_requested,
                    "route_selected": "episodic",
                    "route_candidates": route_candidates,
                    "routing_reason": "empty_query_defaults_to_recent_episodic",
                    "total_memories": memories_snapshot.len(),
                    "matches": results.len(),
                    "results": results
                });
            }

            let mut route_selected = match route_requested.as_str() {
                "episodic" | "semantic" | "causal" => route_requested.as_str().to_string(),
                _ => "auto".to_string(),
            };
            let mut fallback_used = false;
            let mut routing_reason: String;

            let episodic_results =
                Self::episodic_memory_search(&memories_snapshot, query, limit);
            let (semantic_results, semantic_backend) =
                self.semantic_memory_search(&memories_snapshot, query, limit);
            let recent_memories: Vec<MemoryEntry> =
                memories_snapshot.iter().rev().take(40).cloned().collect();
            let causal_results = self
                .causal_memory_search(&recent_memories, query, limit)
                .await;

            let episodic_quality = route_quality_score(query, &episodic_results, limit);
            let semantic_quality = route_quality_score(query, &semantic_results, limit);
            let causal_quality = route_quality_score(query, &causal_results, limit);
            let feedback_bias = route_feedback_bias(&memories_snapshot, query);

            let route_quality_scores = serde_json::json!({
                "episodic": episodic_quality,
                "semantic": semantic_quality,
                "causal": causal_quality
            });

            let mut results = match route_selected.as_str() {
                "semantic" => {
                    routing_reason = "manual_route_selected=semantic".to_string();
                    semantic_results.clone()
                }
                "causal" => {
                    routing_reason = "manual_route_selected=causal".to_string();
                    causal_results.clone()
                }
                "episodic" => {
                    routing_reason = "manual_route_selected=episodic".to_string();
                    episodic_results.clone()
                }
                _ => {
                    let lowered_query = query.to_ascii_lowercase();
                    let has_causal_intent =
                        ["why", "cause", "effect", "impact", "risk", "because"]
                            .iter()
                            .any(|cue| lowered_query.contains(cue));
                    if has_causal_intent && !causal_results.is_empty() {
                        route_selected = "causal".to_string();
                        routing_reason =
                            "auto_quality_route_selected=causal_intent_override".to_string();
                        causal_results.clone()
                    } else {
                        let mut ranked_candidates: Vec<(String, f64)> = route_candidates
                            .iter()
                            .enumerate()
                            .map(|(index, route)| {
                                let quality = match *route {
                                    "semantic" => semantic_quality,
                                    "causal" => causal_quality,
                                    _ => episodic_quality,
                                };
                                let prior_bonus =
                                    ((route_candidates.len().saturating_sub(index)) as f64)
                                        * 0.03;
                                let causal_boost = if has_causal_intent && *route == "causal" {
                                    0.2
                                } else {
                                    0.0
                                };
                                let feedback_boost =
                                    feedback_bias.get(*route).copied().unwrap_or(0.0) * 0.18;
                                (
                                    route.to_string(),
                                    clamp01(
                                        quality + prior_bonus + causal_boost + feedback_boost,
                                    ),
                                )
                            })
                            .collect();
                        ranked_candidates.sort_by(|a, b| {
                            b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
                        });
                        let best_route = ranked_candidates
                            .first()
                            .map(|entry| entry.0.clone())
                            .unwrap_or_else(|| "episodic".to_string());
                        route_selected = best_route.clone();
                        routing_reason = format!("auto_quality_route_selected={}", best_route);
                        match best_route.as_str() {
                            "semantic" => semantic_results.clone(),
                            "causal" => causal_results.clone(),
                            _ => episodic_results.clone(),
                        }
                    }
                }
            };

            let selected_quality = match route_selected.as_str() {
                "semantic" => semantic_quality,
                "causal" => causal_quality,
                _ => episodic_quality,
            };

            if results.is_empty() && route_selected != "episodic" {
                fallback_used = true;
                routing_reason = format!("{}; fallback=episodic_no_matches", routing_reason);
                results = episodic_results.clone();
            }

            let total_memories = memories_snapshot.len();

            if results.is_empty() {
                serde_json::json!({
                    "query": query,
                    "route_requested": route_requested,
                    "route_selected": route_selected,
                    "route_candidates": route_candidates,
                    "routing_reason": routing_reason,
                    "route_quality_scores": route_quality_scores,
                    "route_selected_quality": selected_quality,
                    "route_feedback_bias": feedback_bias,
                    "semantic_embedding_backend": semantic_backend,
                    "fallback_used": fallback_used,
                    "total_memories": total_memories,
                    "matches": 0,
                    "results": "No matching memories found. Record outcomes or commit patterns first."
                })
            } else {
                serde_json::json!({
                    "query": query,
                    "route_requested": route_requested,
                    "route_selected": route_selected,
                    "route_candidates": route_candidates,
                    "routing_reason": routing_reason,
                    "route_quality_scores": route_quality_scores,
                    "route_selected_quality": selected_quality,
                    "route_feedback_bias": feedback_bias,
                    "semantic_embedding_backend": semantic_backend,
                    "fallback_used": fallback_used,
                    "total_memories": total_memories,
                    "matches": results.len(),
                    "results": results
                })
            }
    }

    pub(crate) async fn handle_compress_context(&self, params: serde_json::Value) -> serde_json::Value {
            // Phase D: context compressor with importance scoring + dedupe.
            let target_tokens =
                params["target_tokens"].as_u64().unwrap_or(1000).max(1) as usize;
            let context = params["context"].as_str().unwrap_or("").to_string();
            let preserve_recent = params["preserve_recent"].as_u64().unwrap_or(1) as usize;
            let dedupe_threshold = params["dedupe_threshold"]
                .as_f64()
                .map(clamp01)
                .unwrap_or(0.85);
            let focus_terms: Vec<String> = params["focus_terms"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str())
                        .map(|item| item.trim().to_ascii_lowercase())
                        .filter(|item| !item.is_empty())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_default();

            let (source_text, source, fallback_used) = if context.trim().is_empty() {
                let mems = self.memories.lock().await;
                if mems.is_empty() {
                    return serde_json::json!({
                        "compressed_context": "",
                        "original_tokens": 0,
                        "compressed_tokens": 0,
                        "compression_ratio": "N/A",
                        "token_reduction_ratio": 0.0,
                        "source": "memory_store",
                        "strategy": "context_compressor.importance_dedupe_v1",
                        "fallback_used": true,
                        "note": "Memory store is empty. Record outcomes or commit patterns first."
                    });
                }
                let summary = mems
                    .iter()
                    .rev()
                    .take(25)
                    .map(|m| m.content.as_str())
                    .collect::<Vec<&str>>()
                    .join(". ");
                (summary, "memory_store".to_string(), true)
            } else {
                (context, "input_context".to_string(), false)
            };

            let result_json = tokio::task::spawn_blocking(move || {
                let sentences = split_sentences(&source_text);
                if sentences.is_empty() {
                    return serde_json::json!({
                        "compressed_context": "",
                        "original_tokens": 0,
                        "compressed_tokens": 0,
                        "compression_ratio": "N/A",
                        "token_reduction_ratio": 0.0,
                        "source": source,
                        "strategy": "context_compressor.importance_dedupe_v1",
                        "fallback_used": fallback_used
                    });
                }

                let original_words = source_text.split_whitespace().count();
                let target_words = ((target_tokens as f64) * 0.75).round().max(5.0) as usize;

                let mut candidates: Vec<(usize, String, usize, f64, HashSet<String>)> =
                    sentences
                        .iter()
                        .enumerate()
                        .map(|(index, sentence)| {
                            let words = sentence.split_whitespace().count();
                            let score = score_context_sentence(
                                sentence,
                                index,
                                sentences.len(),
                                &focus_terms,
                            );
                            let token_set = sentence_token_set(sentence);
                            (index, sentence.clone(), words, score, token_set)
                        })
                        .collect();
                candidates.sort_by(|a, b| {
                    b.3.partial_cmp(&a.3)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| a.0.cmp(&b.0))
                });

                let mut selected: Vec<(usize, String, usize, f64, HashSet<String>, bool)> =
                    Vec::new();
                let mut selected_words = 0usize;
                let mut dedupe_removed_count = 0usize;
                let mut budget_skipped_count = 0usize;

                for (index, sentence, words, score, token_set) in &candidates {
                    let is_duplicate = selected.iter().any(|(_, _, _, _, selected_set, _)| {
                        jaccard_similarity(&token_set, selected_set) >= dedupe_threshold
                    });
                    if is_duplicate {
                        dedupe_removed_count += 1;
                        continue;
                    }
                    if selected_words + *words > target_words && !selected.is_empty() {
                        budget_skipped_count += 1;
                        continue;
                    }
                    selected.push((
                        *index,
                        sentence.clone(),
                        *words,
                        *score,
                        token_set.clone(),
                        false,
                    ));
                    selected_words += *words;
                    if selected_words >= target_words {
                        break;
                    }
                }

                if selected.is_empty() {
                    if let Some((index, sentence, _, score, token_set)) = candidates.first() {
                        let truncated = sentence
                            .split_whitespace()
                            .take(target_words.max(5))
                            .collect::<Vec<&str>>()
                            .join(" ");
                        let words = truncated.split_whitespace().count();
                        selected.push((
                            *index,
                            truncated,
                            words,
                            *score,
                            token_set.clone(),
                            false,
                        ));
                        selected_words = words;
                    }
                }

                let recent_indexes: Vec<usize> =
                    (sentences.len().saturating_sub(preserve_recent)..sentences.len())
                        .collect();
                for index in recent_indexes {
                    if selected
                        .iter()
                        .any(|(selected_index, _, _, _, _, _)| *selected_index == index)
                    {
                        continue;
                    }
                    let sentence = sentences[index].clone();
                    let token_set = sentence_token_set(&sentence);
                    let words = sentence.split_whitespace().count();
                    let is_duplicate = selected.iter().any(|(_, _, _, _, selected_set, _)| {
                        jaccard_similarity(&token_set, selected_set) >= dedupe_threshold
                    });
                    if is_duplicate {
                        continue;
                    }
                    if selected_words + words > target_words && !selected.is_empty() {
                        continue;
                    }
                    selected.push((
                        index,
                        sentence.clone(),
                        words,
                        score_context_sentence(&sentence, index, sentences.len(), &focus_terms),
                        token_set,
                        true,
                    ));
                    selected_words += words;
                }

                selected.sort_by(|a, b| a.0.cmp(&b.0));
                let compressed_sentences: Vec<String> = selected
                    .iter()
                    .map(|(_, sentence, _, _, _, _)| sentence.clone())
                    .collect();
                let mut compressed = compressed_sentences.join(". ");
                if !compressed.is_empty()
                    && !compressed.ends_with('.')
                    && !compressed.ends_with('!')
                    && !compressed.ends_with('?')
                {
                    compressed.push('.');
                }

                let compressed_tokens = compressed.split_whitespace().count();
                let reduction_ratio = if original_words > 0 {
                    clamp01(1.0 - compressed_tokens as f64 / original_words as f64)
                } else {
                    0.0
                };
                let compression_ratio = if compressed_tokens > 0 {
                    original_words as f64 / compressed_tokens as f64
                } else {
                    1.0
                };

                serde_json::json!({
                    "compressed_context": compressed,
                    "original_tokens": original_words,
                    "compressed_tokens": compressed_tokens,
                    "compression_ratio": format!("{:.2}x", compression_ratio),
                    "token_reduction_ratio": reduction_ratio,
                    "selected_sentences": selected.len(),
                    "dedupe_removed_count": dedupe_removed_count,
                    "budget_skipped_count": budget_skipped_count,
                    "source": source,
                    "strategy": "context_compressor.importance_dedupe_v1",
                    "target_tokens": target_tokens,
                    "target_words": target_words,
                    "dedupe_threshold": dedupe_threshold,
                    "preserve_recent": preserve_recent,
                    "focus_terms": focus_terms,
                    "fallback_used": fallback_used
                })
            })
            .await
            .unwrap_or_else(
                |_| serde_json::json!({"error": "context_compression_task_panicked"}),
            );

            result_json
    }
}
