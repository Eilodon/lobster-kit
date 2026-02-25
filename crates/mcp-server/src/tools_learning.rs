use crate::types::*;
use crate::EidolonMcpServer;

impl EidolonMcpServer {
    pub(crate) async fn handle_record_outcome(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
        let mode_str = params["mode"].as_str().unwrap_or("Peer");
        // Clamp severity to [0.0, 5.0] — prevents garbage inputs
        let raw_severity = params["severity"].as_f64().unwrap_or(0.0) as f32;
        let severity = raw_severity.clamp(0.0, 5.0);

        let mode = match mode_str {
            "Stalking" => core_rust::sentinel::modes::SentinelMode::Stalking,
            "Berserk" => core_rust::sentinel::modes::SentinelMode::Berserk,
            "Snipe" => core_rust::sentinel::modes::SentinelMode::Snipe,
            _ => core_rust::sentinel::modes::SentinelMode::Zen,
        };

        let now = chrono::Utc::now().timestamp_millis();

        if severity > 0.0 {
            let mut trauma = self.trauma.lock().await;
            trauma.record_trauma(mode, pattern, severity, now);
        } else {
            let mut trauma = self.trauma.lock().await;
            trauma.heal(mode, pattern);
        }

        // Phase 6: LiquidBrain online learning from outcome
        {
            let reward_signal = if severity > 0.0 {
                -(severity / 5.0) // Negative reward for bad outcomes
            } else {
                1.0 // Positive reward for healed/good outcomes
            };
            let mut brain = self.liquid_brain.lock().await;
            brain.optimize(reward_signal);
        }

        let mut brain = self.causal_brain.lock().await;
        brain.learn(
            core_rust::sentinel::variables::SentinelVariable::Sentiment,
            core_rust::sentinel::variables::SentinelVariable::PriceDelta,
            severity == 0.0,
        );

        // Upgrade 3: Push to Stateful Memory
        let content = format!(
            "Outcome for '{}' in {} mode. Severity: {}",
            pattern, mode_str, severity
        );
        let (embedding, embedding_backend) = self.embed_text_with_fallback(&content);
        let preferred_route = if pattern.to_ascii_lowercase().contains("why")
            || pattern.to_ascii_lowercase().contains("cause")
            || pattern.to_ascii_lowercase().contains("risk")
        {
            "causal"
        } else if pattern.to_ascii_lowercase().contains("similar")
            || pattern.to_ascii_lowercase().contains("imbalance")
            || pattern.to_ascii_lowercase().contains("semantic")
        {
            "semantic"
        } else {
            "episodic"
        };
        let route_feedback_content = format!(
            "route_feedback route={} pattern={} severity={}",
            preferred_route, pattern, severity
        );
        let (route_feedback_embedding, route_feedback_backend) =
            self.embed_text_with_fallback(&route_feedback_content);
        let mut mems = self.memories.lock().await;
        mems.push(MemoryEntry {
            timestamp: now,
            category: "outcome".to_string(),
            content,
            embedding,
        });
        mems.push(MemoryEntry {
            timestamp: now,
            category: "route_feedback".to_string(),
            content: route_feedback_content,
            embedding: route_feedback_embedding,
        });

        if mems.len() > 10_000 {
            let excess = mems.len() - 10_000;
            mems.drain(0..excess);
        }
        drop(mems);
        // Phase 3: Persist memories to disk
        self.save_memories_to_disk().await;

        serde_json::json!({
            "status": "outcome_recorded",
            "learning_applied": true,
            "memory_stored": true,
            "embedding_backend": embedding_backend,
            "route_policy_feedback": {
                "preferred_route": preferred_route,
                "feedback_embedding_backend": route_feedback_backend
            }
        })
    }

    pub(crate) async fn handle_update_user(&self, params: serde_json::Value) -> serde_json::Value {
        // Upgrade 1: Real persistent user update
        let user_id = params["user_id"].as_str().unwrap_or("unknown");
        {
            let mut users = self.users.lock().await;
            let existing = users
                .entry(user_id.to_string())
                .or_insert_with(|| serde_json::json!({}));

            // Merge all extra fields from params into profile
            if let Some(obj) = params.as_object() {
                if let Some(existing_obj) = existing.as_object_mut() {
                    for (k, v) in obj {
                        if k != "user_id" {
                            existing_obj.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
        }
        self.save_users_to_disk().await;

        serde_json::json!({
            "user_id": user_id,
            "status": "user_profile_persisted"
        })
    }

    pub(crate) async fn handle_dream_conversation(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        // Upgrade 6: Real Memory Consolidation / Thermodynamic Relaxation
        let episodes = params["episodes"].as_u64().unwrap_or(20) as usize;

        let mut thermo = self.thermo.lock().await;
        let mut state = nalgebra::DVector::from_element(5, 0.8); // Start hot
        let target = nalgebra::DVector::from_element(5, 0.0); // Target zero (Zen)

        // Simulate annealing over N episodes
        for _ in 0..episodes {
            thermo.step(&mut state, &target);
        }
        let final_entropy = thermo.entropy(&state);

        // Prune old memories
        let mut mems = self.memories.lock().await;
        let pruned = if mems.len() > 100 {
            let excess = mems.len() - 100;
            mems.drain(0..excess);
            true
        } else {
            false
        };

        serde_json::json!({
            "status": "dream_sequence_complete",
            "episodes_processed": episodes,
            "final_entropy": final_entropy,
            "memory_pruned": pruned,
            "state_relaxed": final_entropy < 0.5
        })
    }
}
