use crate::embedding::EmbeddingEngine;
use crate::helpers::*;
use crate::oracle::query_local_llm;
use crate::types::*;
use crate::EidolonMcpServer;

impl EidolonMcpServer {
    pub(crate) async fn handle_recall_user(&self, params: serde_json::Value) -> serde_json::Value {
        let tenant_id = crate::helpers::extract_tenant_id(&params);
        let user_id = params["user_id"].as_str().unwrap_or("unknown");
        let all_users = self.users.read().await;
        let profile = all_users
            .get(&tenant_id)
            .and_then(|t| t.get(user_id))
            .cloned()
            .unwrap_or_else(|| {
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

    pub(crate) async fn handle_route_action(&self, params: serde_json::Value) -> serde_json::Value {
        let tenant_id = crate::helpers::extract_tenant_id(&params);
        let suggested_tool = params["suggested_tool"].as_str().unwrap_or("unknown");
        let intent_confidence = clamp01(params["intent_confidence"].as_f64().unwrap_or(0.5)) as f32;

        let thermo_coherence = {
            let mut thermo = self.thermo.write().await;
            let state = nalgebra::DVector::from_vec(vec![0.15f32, 0.25, 0.35, 0.45, 0.55]);
            let entropy = thermo.entropy(&state).max(0.0);
            (1.0 / (1.0 + entropy)).clamp(0.35, 1.0)
        };

        let trauma_safety = {
            let trauma = self.trauma.read().await;
            let now = chrono::Utc::now().timestamp_millis();
            if trauma.is_inhibited(
                core_rust::sentinel::modes::SentinelMode::Zen,
                &format!("{}:{}", tenant_id, suggested_tool),
                now,
            ) {
                0.0
            } else {
                1.0
            }
        };

        let policy_score = {
            let metrics = self.tool_metrics.read().await;
            metrics
                .get(&format!("{}:{}", tenant_id, suggested_tool))
                .map_or(0.5f32, |m| {
                    if m.calls < 5 {
                        0.6f32
                    } else {
                        let calls = m.calls as f32;
                        let success_rate = 1.0f32 - (m.errors as f32 / calls);
                        let fallback_rate = m.fallback_count as f32 / calls;
                        let latency_penalty =
                            (m.latency_p95_ms as f32 / 2000.0f32).clamp(0.0f32, 0.6f32);
                        (success_rate * 0.75f32
                            + (1.0f32 - fallback_rate).clamp(0.0f32, 1.0f32) * 0.2f32
                            + (1.0f32 - latency_penalty) * 0.05f32)
                            .clamp(0.0f32, 1.0f32)
                    }
                })
        };

        let composite_confidence = (intent_confidence * 0.50f32
            + thermo_coherence * 0.15f32
            + trauma_safety * 0.20f32
            + policy_score * 0.15f32)
            .clamp(0.0f32, 1.0f32);

        let (strategy, reason) = if trauma_safety == 0.0 {
            (
                "ASK_USER",
                "Tool execution blocked by TraumaRegistry. Mandatory user intervention required.",
            )
        } else if composite_confidence >= 0.88 && policy_score >= 0.75 {
            (
                "AUTO",
                "High confidence plus stable policy history. Executing automatically.",
            )
        } else if composite_confidence >= 0.62 {
            ("PROPOSE", "Moderate confidence. Suggesting 1-Click execution for Human-on-the-Loop verification.")
        } else {
            ("ASK_USER", "Low confidence signals resulting from entropy or lacking historical policy. Falling back to explicit prompt.")
        };

        serde_json::json!({
            "strategy": strategy,
            "confidence": composite_confidence,
            "suggested_tool": suggested_tool,
            "breakdown": {
                "intent_confidence": intent_confidence,
                "thermo_coherence": thermo_coherence,
                "trauma_safety": trauma_safety,
                "learned_policy_score": policy_score
            },
            "reason": reason
        })
    }

    pub(crate) async fn handle_sense_intent(&self, params: serde_json::Value) -> serde_json::Value {
        let tenant_id = crate::helpers::extract_tenant_id(&params);
        let query = params["query"].as_str().unwrap_or("");
        let user_id = params["user_id"].as_str().unwrap_or("default");
        let user_risk_tolerance = {
            let all_users = self.users.read().await;
            all_users
                .get(&tenant_id)
                .and_then(|t| t.get(user_id))
                .map(extract_profile_risk_tolerance)
                .unwrap_or(0.5)
        };
        let profile_sensitivity = clamp01(1.0 - user_risk_tolerance);
        let critical_action_score = critical_action_signal_score(query);

        let mut actor = self.actor.write().await;
        actor.process_event(core_rust::sentinel::systems::CognitiveEvent::Evaluate);
        let risk_score = actor.risk_score;
        drop(actor);

        let lexical_risk_score = lexical_intent_risk_score(query);
        let historical_risk_prior = self.estimate_historical_risk_prior(&tenant_id, query).await;
        let actor_risk_score = clamp01(risk_score as f64);

        let mut inference_backend = "fallback".to_string();
        let mut model_risk_score = 0.5;
        let mut confidence_raw = 0.45;
        let mut safe_centroid_similarity = 0.0;
        let mut danger_centroid_similarity = 0.0;

        if let Some(ref engine) = *self.embedding_engine {
            let safe_centroids = [
                "check my portfolio balance",
                "what is the current gas price",
                "show token information",
                "recall user preferences",
                "compress context and summarize",
            ];
            let danger_centroids = [
                "execute flash loan exploit",
                "drain liquidity pool attack",
                "frontrun pending transaction snipe",
                "reentrancy exploit contract vulnerability",
                "sandwich attack mempool manipulation",
            ];

            match engine.embed(query) {
                Ok(query_vec) => {
                    let mut max_safe: f32 = 0.0;
                    let mut max_danger: f32 = 0.0;

                    for text in &safe_centroids {
                        if let Ok(centroid) = engine.embed(text) {
                            let sim = EmbeddingEngine::cosine_similarity(&query_vec, &centroid);
                            if sim > max_safe {
                                max_safe = sim;
                            }
                        }
                    }
                    for text in &danger_centroids {
                        if let Ok(centroid) = engine.embed(text) {
                            let sim = EmbeddingEngine::cosine_similarity(&query_vec, &centroid);
                            if sim > max_danger {
                                max_danger = sim;
                            }
                        }
                    }

                    safe_centroid_similarity = max_safe as f64;
                    danger_centroid_similarity = max_danger as f64;
                    model_risk_score = clamp01(
                        (danger_centroid_similarity * 0.7)
                            + ((1.0 - safe_centroid_similarity) * 0.3),
                    );
                    let margin = (danger_centroid_similarity - safe_centroid_similarity).abs();
                    let magnitude = safe_centroid_similarity.max(danger_centroid_similarity);
                    confidence_raw = clamp01(0.45 + margin * 0.45 + magnitude * 0.1);
                    inference_backend = "onnx_minilm".to_string();
                }
                Err(e) => {
                    eprintln!("[Eidolon DEBUG] ONNX embed failed for query: {}", e);
                }
            }
        }

        if inference_backend == "fallback" {
            let prompt = format!(
                r#"You are a security risk classifier. Analyze the user query and classify its risk level.

EXAMPLES:
Query: "check my portfolio balance" → {{"recommended_mode": "Peer", "confidence": 0.92}}
Query: "summarise the README for me" → {{"recommended_mode": "Peer", "confidence": 0.90}}
Query: "run unit tests and report results" → {{"recommended_mode": "Peer", "confidence": 0.88}}
Query: "audit authentication layer for vulnerabilities" → {{"recommended_mode": "Stalking", "confidence": 0.80}}
Query: "review code for security issues" → {{"recommended_mode": "Stalking", "confidence": 0.78}}
Query: "delete all production databases immediately" → {{"recommended_mode": "Berserk", "confidence": 0.95}}
Query: "send email to all users with their passwords" → {{"recommended_mode": "Berserk", "confidence": 0.93}}
Query: "modify firewall rules to allow all inbound" → {{"recommended_mode": "Snipe", "confidence": 0.91}}
Query: "drain liquidity pool immediately" → {{"recommended_mode": "Berserk", "confidence": 0.96}}

RULES:
- "Peer" = Safe, informational, read-only, or benign operations
- "Stalking" = Suspicious, needs review, security-related but not destructive
- "Berserk" or "Snipe" = Dangerous, destructive, data exfiltration, or infrastructure mutation
- Return ONLY the JSON object, no explanation or markdown.

Query: "{}" → "#,
                query
            );
            let llm_res = query_local_llm(&prompt).await;
            // Try to extract JSON from the response (LLM may wrap it in markdown or text)
            let json_str = extract_json_from_response(&llm_res);
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(mode) = parsed.get("recommended_mode").and_then(|v| v.as_str()) {
                    model_risk_score = mode_to_risk_score(mode);
                }
                if let Some(conf) = parsed.get("confidence").and_then(|v| v.as_f64()) {
                    confidence_raw = clamp01(conf);
                }
            }
            inference_backend = "ollama".to_string();
        }

        let profile_sensitive_boost = critical_action_score * (0.12 + profile_sensitivity * 0.18);

        // Phase 6: Neural risk score via LiquidBrain (adapts with feedback)
        let neural_risk_score = {
            let embed = pseudo_embed(query);
            let mut brain = self.liquid_brain.write().await;
            let output = brain.forward(embed);
            // Average hidden state as risk signal, clamped to [0, 1]
            let raw = output.iter().sum::<f32>() / output.len().max(1) as f32;
            (raw.tanh() * 0.5 + 0.5).clamp(0.0, 1.0) as f64
        };

        let composite_risk_score = clamp01(
            model_risk_score * 0.40
                + neural_risk_score * 0.20
                + lexical_risk_score * 0.15
                + historical_risk_prior * 0.10
                + actor_risk_score * 0.05
                + profile_sensitive_boost
                + critical_action_score * 0.10,
        );

        let directional_uncertainty = 1.0 - ((composite_risk_score - 0.5).abs() * 2.0);
        let short_query_penalty = if simple_tokenize(query).len() <= 2 {
            0.08
        } else {
            0.0
        };
        let confidence_calibrated = clamp01(
            confidence_raw * (0.78 + (1.0 - directional_uncertainty) * 0.22) - short_query_penalty,
        );

        let abstained = query.trim().is_empty()
            || confidence_calibrated < 0.42
            || ((composite_risk_score - 0.5).abs() < 0.09
                && lexical_risk_score < 0.35
                && historical_risk_prior < 0.35);

        let recommended_mode = if abstained {
            "Peer".to_string()
        } else if composite_risk_score >= 0.50 {
            "Berserk".to_string()
        } else if composite_risk_score >= 0.30 {
            "Stalking".to_string()
        } else {
            "Peer".to_string()
        };
        // Phase 1B: Evolve thermodynamic state with live risk signals
        let thermo_entropy = {
            let mut thermo = self.thermo.write().await;
            let target = nalgebra::DVector::from_vec(vec![
                composite_risk_score as f32,       // Volatility proxy
                model_risk_score as f32,           // Trend proxy
                (1.0 - lexical_risk_score) as f32, // Liquidity (inverse of risk)
                confidence_calibrated as f32,      // Cycle = confidence
                actor_risk_score as f32,           // Momentum = actor risk
            ]);
            let mut state = nalgebra::DVector::from_element(5, 0.5);
            thermo.step(&mut state, &target);
            thermo.entropy(&state)
        };

        serde_json::json!({
            "success": true,
            "confidence": confidence_calibrated,
            "recommended_mode": recommended_mode,
            "thermo_entropy": thermo_entropy,
            "risk_score": risk_score,
            "inference_backend": inference_backend,
            "ensemble": {
                "model_risk_score": model_risk_score,
                "neural_risk_score": neural_risk_score,
                "lexical_risk_score": lexical_risk_score,
                "historical_risk_prior": historical_risk_prior,
                "actor_risk_score": actor_risk_score,
                "critical_action_signal_score": critical_action_score,
                "profile_sensitive_boost": profile_sensitive_boost,
                "composite_risk_score": composite_risk_score,
                "centroid_similarity": {
                    "safe": safe_centroid_similarity,
                    "danger": danger_centroid_similarity
                }
            },
            "calibration": {
                "confidence_raw": confidence_raw,
                "confidence_calibrated": confidence_calibrated,
                "abstained": abstained,
                "strategy": if abstained { "ASK_USER" } else { "AUTO" },
                "user_risk_tolerance": user_risk_tolerance,
                "profile_sensitivity": profile_sensitivity
            }
        })
    }

    pub(crate) async fn handle_check_pattern(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let tenant_id = crate::helpers::extract_tenant_id(&params);
        let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
        let mode_str = params["mode"].as_str().unwrap_or("Peer");

        let mode = match mode_str {
            "Stalking" => core_rust::sentinel::modes::SentinelMode::Stalking,
            "Berserk" => core_rust::sentinel::modes::SentinelMode::Berserk,
            "Snipe" => core_rust::sentinel::modes::SentinelMode::Snipe,
            _ => core_rust::sentinel::modes::SentinelMode::Zen,
        };

        let trauma = self.trauma.read().await;
        let now = chrono::Utc::now().timestamp_millis();
        let salted_pattern = format!("{}:{}", tenant_id, pattern);
        let is_inhibited = trauma.is_inhibited(mode, &salted_pattern, now);
        let remaining_ms = trauma.get_remaining_ms(mode, &salted_pattern, now);

        serde_json::json!({
            "pattern": pattern,
            "inhibited": is_inhibited,
            "remaining_ms": remaining_ms
        })
    }

    pub(crate) async fn handle_simulate_response(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let tenant_id = crate::helpers::extract_tenant_id(&params);
        let action = params["action"].as_str().unwrap_or("default");
        let user_id = params["user_id"].as_str().unwrap_or("default");
        let user_risk_tolerance = {
            let all_users = self.users.read().await;
            all_users
                .get(&tenant_id)
                .and_then(|t| t.get(user_id))
                .map(extract_profile_risk_tolerance)
                .unwrap_or(0.5)
        };
        let profile_sensitivity = clamp01(1.0 - user_risk_tolerance);
        let leverage_signal = leverage_action_signal_score(action);
        let disable_stop_loss_signal = disable_stop_loss_signal_score(action);
        let critical_action_signal = critical_action_signal_score(action);

        let trauma = self.trauma.read().await;
        let now = chrono::Utc::now().timestamp_millis();

        let modes = vec![
            core_rust::sentinel::modes::SentinelMode::Zen,
            core_rust::sentinel::modes::SentinelMode::Emergency,
            core_rust::sentinel::modes::SentinelMode::Stalking,
            core_rust::sentinel::modes::SentinelMode::Berserk,
            core_rust::sentinel::modes::SentinelMode::Snipe,
        ];

        let salted_action = format!("{}:{}", tenant_id, action);
        let mut inhibited_mode = None;
        for mode in modes {
            if trauma.is_inhibited(mode, &salted_action, now) {
                inhibited_mode = Some(mode);
                break;
            }
        }
        drop(trauma);

        let lexical_risk = lexical_intent_risk_score(action);
        let inhibition_penalty = if inhibited_mode.is_some() { 0.45 } else { 0.0 };
        let profile_gate_penalty = leverage_signal * (0.08 + profile_sensitivity * 0.16)
            + disable_stop_loss_signal * (0.16 + profile_sensitivity * 0.20);
        let base_loss =
            clamp01(0.08 + lexical_risk * 0.55 + inhibition_penalty + profile_gate_penalty);

        let mut best_prob = 0.22;
        let mut base_prob = 0.55;
        let mut worst_prob = 0.23;
        if inhibited_mode.is_some() {
            best_prob = 0.12;
            base_prob = 0.43;
            worst_prob = 0.45;
        }
        let signal_pressure = clamp01(
            leverage_signal * 0.5 + disable_stop_loss_signal * 0.7 + profile_sensitivity * 0.35,
        );
        if signal_pressure > 0.01 {
            best_prob = (best_prob - 0.08 * signal_pressure).max(0.05);
            base_prob = (base_prob - 0.04 * signal_pressure).max(0.2);
            worst_prob += 0.12 * signal_pressure;
        }
        let prob_sum = best_prob + base_prob + worst_prob;
        best_prob /= prob_sum;
        base_prob /= prob_sum;
        worst_prob /= prob_sum;

        let best_loss = clamp01(base_loss * 0.35);
        let base_case_loss = clamp01(base_loss * 1.0);
        let worst_loss = clamp01(base_loss * 1.55 + 0.08);
        let expected_loss =
            clamp01(best_prob * best_loss + base_prob * base_case_loss + worst_prob * worst_loss);
        let variance = best_prob * (best_loss - expected_loss).powi(2)
            + base_prob * (base_case_loss - expected_loss).powi(2)
            + worst_prob * (worst_loss - expected_loss).powi(2);
        let stddev = variance.sqrt();
        let ci_low = clamp01(expected_loss - 1.645 * stddev);
        let ci_high = clamp01(expected_loss + 1.645 * stddev);
        let confidence = clamp01(1.0 - stddev * 0.85);

        let risk_threshold = (0.42
            - profile_sensitivity * 0.10
            - leverage_signal * 0.05
            - disable_stop_loss_signal * 0.09)
            .clamp(0.18, 0.6);
        let should_revise = inhibited_mode.is_some() || expected_loss >= risk_threshold;
        let predicted_outcome = if should_revise {
            "negative"
        } else {
            "positive"
        };
        let reason = if inhibited_mode.is_some() {
            "Action is currently inhibited by TraumaRegistry due to past negative outcomes."
        } else if leverage_signal > 0.0 || disable_stop_loss_signal > 0.0 {
            "Profile-aware gate detected leverage/stop-loss action risk and tightened revision threshold."
        } else {
            "Counterfactual simulation indicates acceptable risk under current policy."
        };

        serde_json::json!({
            "action_tested": action,
            "predicted_outcome": predicted_outcome,
            "confidence": confidence,
            "should_revise": should_revise,
            "reason": reason,
            "counterfactual": {
                "expected_loss": expected_loss,
                "loss_confidence_interval_90": [ci_low, ci_high],
                "risk_threshold": risk_threshold,
                "inhibited": inhibited_mode.is_some()
            },
            "profile_sensitivity": {
                "user_id": user_id,
                "risk_tolerance": user_risk_tolerance,
                "profile_sensitivity": profile_sensitivity,
                "leverage_signal": leverage_signal,
                "disable_stop_loss_signal": disable_stop_loss_signal,
                "critical_action_signal": critical_action_signal,
                "gate_penalty": profile_gate_penalty
            },
            "scenario_tree": {
                "best": {
                    "probability": best_prob,
                    "expected_loss": best_loss,
                    "label": "best_case"
                },
                "base": {
                    "probability": base_prob,
                    "expected_loss": base_case_loss,
                    "label": "base_case"
                },
                "worst": {
                    "probability": worst_prob,
                    "expected_loss": worst_loss,
                    "label": "worst_case"
                }
            }
        })
    }

    pub(crate) async fn handle_commit_pattern(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let tenant_id = crate::helpers::extract_tenant_id(&params);
        let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
        let mut thermo = self.thermo.write().await;
        let mut state = nalgebra::DVector::from_element(5, 0.5);
        let target = nalgebra::DVector::from_element(5, 0.6);
        thermo.step(&mut state, &target);
        let entropy = thermo.entropy(&state);

        // Upgrade 3: Push to Stateful Memory
        let content = format!("Pattern '{}' committed. Entropy: {:.4}", pattern, entropy);
        let (embedding, embedding_backend) = self.embed_text_with_fallback(&content);
        let mut mems = self.memories.write().await;
        let tenant_mems = mems.entry(tenant_id.clone()).or_insert_with(Vec::new);
        tenant_mems.push(MemoryEntry {
            tenant_id: tenant_id.clone(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            category: "commit".to_string(),
            content,
            embedding,
        });

        // VULNERABILITY 1 FIX: Cap memory length
        if tenant_mems.len() > 10_000 {
            let excess = tenant_mems.len() - 10_000;
            tenant_mems.drain(0..excess);
        }
        drop(mems);
        // Phase 3: Persist memories to disk
        self.save_memories_to_disk().await;

        serde_json::json!({
            "status": "committed",
            "pattern": pattern,
            "new_entropy": entropy,
            "embedding_backend": embedding_backend
        })
    }
    pub(crate) async fn handle_set_entropy(&self, params: serde_json::Value) -> serde_json::Value {
        let target_entropy = params["target_entropy"].as_f64().unwrap_or(0.5) as f32;
        let duration_ms = params["duration_ms"].as_u64().unwrap_or(60000);
        let expiration = chrono::Utc::now().timestamp_millis() as u64 + duration_ms;

        let mut thermo = self.thermo.write().await;
        thermo.entropy_override = Some((target_entropy, expiration));

        serde_json::json!({
            "status": "success",
            "message": format!("Entropy overridden to {} until {}", target_entropy, expiration)
        })
    }

    pub(crate) async fn trigger_dream_sequence(&self) {
        let mems = self.memories.read().await;
        let mut keys_to_process = Vec::new();
        for (tenant_id, tenant_mems) in mems.iter() {
            if tenant_mems.len() < 2 {
                continue;
            }
            keys_to_process.push(tenant_id.clone());
        }

        let mut updates = Vec::new();
        for tenant_id in keys_to_process {
            let tenant_mems = mems.get(&tenant_id).unwrap();
            let sample: Vec<String> = tenant_mems
                .iter()
                .rev()
                .take(2)
                .map(|m| m.content.clone())
                .collect();
            let content = format!(
                "Dream Synthesis: Identified a deep causal link between '{}' and '{}'",
                sample[0], sample[1]
            );
            updates.push((tenant_id, content));
        }
        drop(mems);

        let mut to_insert = Vec::new();
        for (tenant_id, content) in updates {
            let (embedding, _) = self.embed_text_with_fallback(&content);
            to_insert.push((tenant_id, content, embedding));
        }

        let mut mems = self.memories.write().await;
        for (tenant_id, content, embedding) in to_insert {
            let tenant_mems = mems.entry(tenant_id.clone()).or_insert_with(Vec::new);
            tenant_mems.push(MemoryEntry {
                tenant_id,
                timestamp: chrono::Utc::now().timestamp_millis(),
                category: "dream_insight".to_string(),
                content,
                embedding,
            });

            if tenant_mems.len() > 10_000 {
                let excess = tenant_mems.len() - 10_000;
                tenant_mems.drain(0..excess);
            }
        }
        drop(mems);
        self.save_memories_to_disk().await;
    }
}
