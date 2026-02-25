// subbrain_auto.rs — Sub-Brain Automatic Orchestration Layer
//
// This module implements the optimal integration solution:
// Single entry point that automatically orchestrates the entire pre-processing flow
// before LLM analysis. Acts as a "Sub-Brain" that handles intent classification,
// tool recommendation, routing decision, and optional auto-execution.

use crate::EidolonMcpServer;
use serde_json::json;

/// Intent categories for auto-routing
#[derive(Debug, Clone, PartialEq)]
pub enum IntentCategory {
    CodeAudit,
    DebugIssue,
    ExplainCode,
    CreateFeature,
    SecurityScan,
    MemoryQuery,
    GetValidation,
    GeneralQuery,
}

impl IntentCategory {
    fn from_text(text: &str) -> Self {
        let lower = text.to_lowercase();
        if lower.contains("audit") || lower.contains("kiểm tra") || lower.contains("review") {
            IntentCategory::CodeAudit
        } else if lower.contains("bug")
            || lower.contains("lỗi")
            || lower.contains("fix")
            || lower.contains("crash")
        {
            IntentCategory::DebugIssue
        } else if lower.contains("giải thích")
            || lower.contains("explain")
            || lower.contains("how")
            || lower.contains("tại sao")
        {
            IntentCategory::ExplainCode
        } else if lower.contains("tạo")
            || lower.contains("thêm")
            || lower.contains("implement")
            || lower.contains("create")
        {
            IntentCategory::CreateFeature
        } else if lower.contains("security")
            || lower.contains("bảo mật")
            || lower.contains("exploit")
        {
            IntentCategory::SecurityScan
        } else if lower.contains("nhớ")
            || lower.contains("recall")
            || lower.contains("memory")
            || lower.contains("context")
        {
            IntentCategory::MemoryQuery
        } else if lower.contains("validate")
            || lower.contains("evaluate")
            || lower.contains("đánh giá")
            || lower.contains("tốt không")
            || lower.contains("hợp lý không")
            || lower.contains("strategy")
            || lower.contains("chiến lược")
        {
            IntentCategory::GetValidation
        } else {
            IntentCategory::GeneralQuery
        }
    }

    fn suggested_tools(&self) -> Vec<&str> {
        match self {
            IntentCategory::CodeAudit => vec![
                "eidolon_check_pattern",
                "eidolon_reason_chain",
                "eidolon_orchestrate",
            ],
            IntentCategory::DebugIssue => vec![
                "eidolon_recall_similar",
                "eidolon_memory_query",
                "eidolon_sense_intent",
            ],
            IntentCategory::ExplainCode => vec![
                "eidolon_sense_intent",
                "eidolon_memory_query",
                "eidolon_reason_chain",
            ],
            IntentCategory::CreateFeature => vec![
                "eidolon_tool_recommend",
                "eidolon_reason_chain",
                "eidolon_orchestrate",
            ],
            IntentCategory::SecurityScan => vec![
                "eidolon_check_pattern",
                "eidolon_reason_chain",
                "eidolon_orchestrate",
            ],
            IntentCategory::MemoryQuery => vec![
                "eidolon_recall_user",
                "eidolon_memory_query",
                "eidolon_recall_similar",
            ],
            IntentCategory::GetValidation => vec![
                "eidolon_simulate_response",
                "eidolon_reason_chain",
                "eidolon_sense_intent",
            ],
            IntentCategory::GeneralQuery => vec![
                "eidolon_sense_intent",
                "eidolon_reason_chain",
                "eidolon_tool_recommend",
            ],
        }
    }
}

/// Routing strategy based on confidence
#[derive(Debug, Clone)]
pub enum AutoRoutingStrategy {
    /// Execute tools automatically, return enriched context
    AutoExecute,
    /// Return tool recommendations for LLM to decide
    ProposeTools,
    /// Return detailed analysis request
    DeepAnalysis,
}

impl EidolonMcpServer {
    /// Sub-Brain Auto-Orchestration Entry Point
    ///
    /// This is the OPTIMAL integration solution. Single tool call that:
    /// 1. Classifies user intent
    /// 2. Recommends appropriate tools
    /// 3. Determines routing strategy
    /// 4. Optionally auto-executes tools
    /// 5. Returns enriched context ready for LLM analysis
    ///
    /// # Parameters
    /// - `input`: Raw user input text
    /// - `auto_execute`: Whether to auto-execute tools (default: true for confidence > 0.75)
    /// - `max_tools`: Maximum tools to execute (default: 3)
    /// - `context`: Additional context (user_id, session_id, etc.)
    ///
    /// # Returns
    /// Enriched context with tool results, ready for LLM analysis
    pub(crate) async fn handle_subbrain_auto(
        &self,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let input = params["input"].as_str().unwrap_or("");
        let user_id = params["user_id"].as_str().unwrap_or("default");
        let auto_execute = params["auto_execute"].as_bool().unwrap_or(true);
        let max_tools = params["max_tools"].as_u64().unwrap_or(3).clamp(1, 5) as usize;
        let include_raw_results = params["include_raw_results"].as_bool().unwrap_or(true);

        if input.is_empty() {
            return json!({
                "error": "input_required",
                "message": "Sub-Brain requires user input to analyze"
            });
        }

        // ─────────────────────────────────────────────────────────────────
        // LAYER 1: INTENT CLASSIFICATION
        // ─────────────────────────────────────────────────────────────────
        let intent = IntentCategory::from_text(input);
        let suggested_tools = intent.suggested_tools();

        // Get embedding-based intent analysis
        let sense_params = json!({
            "query": input,
            "user_id": user_id,
            "extract_entities": true,
            "analyze_sentiment": true
        });
        let intent_analysis = self.handle_sense_intent(sense_params).await;

        // ─────────────────────────────────────────────────────────────────
        // LAYER 2: TOOL RECOMMENDATION
        // ─────────────────────────────────────────────────────────────────
        let recommend_params = json!({
            "task": input,
            "available_tools": suggested_tools,
            "context": intent_analysis
        });
        let tool_recommendations = self.handle_tool_recommend(recommend_params).await;

        // ─────────────────────────────────────────────────────────────────
        // LAYER 3: ROUTING DECISION
        // ─────────────────────────────────────────────────────────────────
        // Combine intent confidence (how well we understood the query)
        // with recommender confidence (how well we can serve it)
        let intent_confidence = intent_analysis["confidence"].as_f64().unwrap_or(0.5);
        let recommender_score = tool_recommendations["recommended_tools"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|t| t["relevance_score"].as_f64())
            .unwrap_or(0.3);
        let confidence = intent_confidence * 0.6 + recommender_score * 0.4;

        let force_execute = params["force_execute"].as_bool().unwrap_or(false);

        let strategy = if force_execute || (confidence > 0.60 && auto_execute) {
            AutoRoutingStrategy::AutoExecute
        } else if confidence > 0.35 {
            AutoRoutingStrategy::ProposeTools
        } else {
            AutoRoutingStrategy::DeepAnalysis
        };

        // ─────────────────────────────────────────────────────────────────
        // LAYER 4: EXECUTION (if AUTO)
        // ─────────────────────────────────────────────────────────────────
        let mut executed_tools = vec![];
        let mut tool_results = vec![];
        let mut execution_errors = vec![];

        if matches!(strategy, AutoRoutingStrategy::AutoExecute) {
            // Get top tools from recommendations
            let top_tools: Vec<String> = tool_recommendations["recommended_tools"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .take(max_tools)
                        .filter_map(|t| t["tool"].as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_else(|| {
                    suggested_tools
                        .iter()
                        .take(max_tools)
                        .map(|s| s.to_string())
                        .collect()
                });

            // Execute each tool
            let now_ms = chrono::Utc::now().timestamp_millis();
            for tool_name in &top_tools {
                // Phase 1C: Check trauma inhibition before executing
                {
                    let trauma = self.trauma.lock().await;
                    if trauma.is_inhibited(
                        core_rust::sentinel::modes::SentinelMode::Berserk,
                        tool_name,
                        now_ms,
                    ) {
                        execution_errors.push(json!({
                            "tool": tool_name,
                            "error": "trauma_inhibited",
                            "reason": "Recent failure pattern detected, skipping tool"
                        }));
                        continue;
                    }
                }

                let tool_params = json!({
                    "query": input,
                    "pattern": input,
                    "context": intent_analysis.clone()
                });

                let result = match tool_name.as_str() {
                    "eidolon_sense_intent" => self.handle_sense_intent(tool_params).await,
                    "eidolon_check_pattern" => self.handle_check_pattern(tool_params).await,
                    "eidolon_reason_chain" => self.handle_reason_chain(tool_params).await,
                    "eidolon_memory_query" => self.handle_memory_query(tool_params).await,
                    "eidolon_recall_similar" => self.handle_recall_similar(tool_params).await,
                    "eidolon_orchestrate" => {
                        let orch_params = json!({
                            "task": input,
                            "confidence": confidence,
                            "agent_count": 3
                        });
                        self.handle_orchestrate(orch_params).await
                    }
                    _ => json!({"status": "skipped", "reason": "tool_not_in_auto_list"}),
                };

                executed_tools.push(tool_name.clone());

                if result.get("error").is_some() {
                    execution_errors.push(json!({
                        "tool": tool_name,
                        "error": result["error"]
                    }));
                    // Phase 1C: Record trauma on tool failure
                    {
                        let mut trauma = self.trauma.lock().await;
                        trauma.record_trauma(
                            core_rust::sentinel::modes::SentinelMode::Berserk,
                            tool_name,
                            3.0,
                            now_ms,
                        );
                    }
                } else if include_raw_results {
                    tool_results.push(json!({
                        "tool": tool_name,
                        "result": result,
                        "relevance": tool_recommendations["recommended_tools"]
                            .as_array()
                            .and_then(|arr| arr.iter().find(|t| t["tool"].as_str() == Some(tool_name)))
                            .and_then(|t| t["relevance_score"].as_f64())
                            .unwrap_or(0.5)
                    }));
                }
            }

            // Phase 4B: Record tool chain as memory for future learning
            if !executed_tools.is_empty() {
                let chain_str = executed_tools.join("→");
                let success_count = executed_tools.len() - execution_errors.len();
                let chain_content = format!(
                    "chain:{}|success:{}|errors:{}|intent:{:?}|confidence:{:.3}",
                    chain_str,
                    success_count,
                    execution_errors.len(),
                    intent,
                    confidence
                );
                let (chain_embed, _) = self.embed_text_with_fallback(&chain_content);
                let mut mems = self.memories.lock().await;
                mems.push(crate::types::MemoryEntry {
                    timestamp: chrono::Utc::now().timestamp_millis(),
                    category: "tool_chain".to_string(),
                    content: chain_content,
                    embedding: chain_embed,
                });
                drop(mems);
                self.save_memories_to_disk().await;

                // Record causal edge: intent type → tool success
                if success_count > 0 {
                    let mut brain = self.causal_brain.lock().await;
                    brain.learn(
                        core_rust::sentinel::variables::SentinelVariable::Sentiment,
                        core_rust::sentinel::variables::SentinelVariable::PriceDelta,
                        true, // positive outcome
                    );
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // LAYER 5: CONTEXT ENRICHMENT
        // ─────────────────────────────────────────────────────────────────
        let enriched_context = self
            .enrich_context(
                input,
                &intent,
                &intent_analysis,
                &tool_recommendations,
                &strategy,
                &executed_tools,
                &tool_results,
                confidence,
            )
            .await;

        // ─────────────────────────────────────────────────────────────────
        // RETURN: Complete Sub-Brain Analysis
        // ─────────────────────────────────────────────────────────────────
        json!({
            "subbrain_analysis": {
                "intent_classification": {
                    "category": format!("{:?}", intent),
                    "confidence": confidence,
                    "entities": intent_analysis.get("entities"),
                    "sentiment": intent_analysis.get("sentiment_analysis")
                },
                "routing_strategy": format!("{:?}", strategy),
                "tool_recommendations": tool_recommendations["recommended_tools"],
                "executed_tools": executed_tools,
                "execution_summary": {
                    "total": executed_tools.len(),
                    "successful": executed_tools.len() - execution_errors.len(),
                    "errors": execution_errors.len()
                },
                "tool_results": if include_raw_results { Some(tool_results) } else { None },
                "execution_errors": if execution_errors.is_empty() { None } else { Some(execution_errors) },
                "enriched_context": enriched_context,
                "suggested_approach": self.suggest_approach(&intent, &strategy, confidence)
            },
            "ready_for_llm_analysis": true,
            "auto_executed": matches!(strategy, AutoRoutingStrategy::AutoExecute)
        })
    }

    /// Enrich context for LLM analysis
    async fn enrich_context(
        &self,
        input: &str,
        intent: &IntentCategory,
        _intent_analysis: &serde_json::Value,
        _tool_recommendations: &serde_json::Value,
        strategy: &AutoRoutingStrategy,
        executed_tools: &[String],
        tool_results: &[serde_json::Value],
        confidence: f64,
    ) -> serde_json::Value {
        // Aggregate key findings from tool results
        let mut key_findings = vec![];
        let mut relevant_memories = vec![];
        let mut patterns_detected = vec![];

        for result in tool_results {
            if let Some(tool) = result["tool"].as_str() {
                match tool {
                    "eidolon_sense_intent" => {
                        if let Some(entities) = result["result"]["entities"].as_array() {
                            key_findings.extend(entities.iter().cloned());
                        }
                    }
                    "eidolon_check_pattern" => {
                        if let Some(patterns) = result["result"]["patterns"].as_array() {
                            patterns_detected.extend(patterns.iter().cloned());
                        }
                    }
                    "eidolon_memory_query" | "eidolon_recall_similar" => {
                        if let Some(memories) = result["result"]["memories"].as_array() {
                            relevant_memories.extend(memories.iter().cloned());
                        }
                    }
                    _ => {}
                }
            }
        }

        json!({
            "user_intent": {
                "raw_input": input,
                "category": format!("{:?}", intent),
                "confidence": confidence
            },
            "analysis_ready": matches!(strategy, AutoRoutingStrategy::AutoExecute) || matches!(strategy, AutoRoutingStrategy::DeepAnalysis),
            "tools_data": {
                "executed": executed_tools,
                "key_findings": key_findings,
                "relevant_memories": relevant_memories,
                "patterns_detected": patterns_detected
            },
            "llm_guidance": {
                "focus_areas": self.get_focus_areas(intent),
                "use_results": matches!(strategy, AutoRoutingStrategy::AutoExecute),
                "ask_clarification": matches!(strategy, AutoRoutingStrategy::ProposeTools)
            }
        })
    }

    /// Suggest approach based on intent and strategy
    fn suggest_approach(
        &self,
        intent: &IntentCategory,
        strategy: &AutoRoutingStrategy,
        confidence: f64,
    ) -> String {
        match (intent, strategy) {
            (IntentCategory::CodeAudit, AutoRoutingStrategy::AutoExecute) =>
                format!("Audit results ready (confidence: {:.0}%). Review findings and provide actionable recommendations.", confidence * 100.0),
            (IntentCategory::DebugIssue, AutoRoutingStrategy::AutoExecute) =>
                format!("Similar issues recalled and patterns checked (confidence: {:.0}%). Analyze root cause and suggest fixes.", confidence * 100.0),
            (IntentCategory::ExplainCode, AutoRoutingStrategy::AutoExecute) =>
                "Intent analyzed and relevant context retrieved. Provide clear explanation with references.".to_string(),
            (_, AutoRoutingStrategy::ProposeTools) =>
                "Moderate confidence. Review tool recommendations and confirm execution.".to_string(),
            (_, AutoRoutingStrategy::DeepAnalysis) =>
                "Low confidence or complex request. Perform deep analysis before responding.".to_string(),
            _ => "Review available data and provide comprehensive response.".to_string()
        }
    }

    /// Get focus areas for LLM analysis
    fn get_focus_areas(&self, intent: &IntentCategory) -> Vec<String> {
        match intent {
            IntentCategory::CodeAudit => vec![
                "security_issues".to_string(),
                "performance_bottlenecks".to_string(),
                "maintainability_concerns".to_string(),
            ],
            IntentCategory::DebugIssue => vec![
                "root_cause_analysis".to_string(),
                "similar_past_issues".to_string(),
                "proposed_fixes".to_string(),
            ],
            IntentCategory::ExplainCode => vec![
                "architecture_overview".to_string(),
                "key_components".to_string(),
                "usage_examples".to_string(),
            ],
            IntentCategory::CreateFeature => vec![
                "implementation_approach".to_string(),
                "integration_points".to_string(),
                "testing_strategy".to_string(),
            ],
            IntentCategory::SecurityScan => vec![
                "vulnerabilities_found".to_string(),
                "risk_assessment".to_string(),
                "remediation_steps".to_string(),
            ],
            IntentCategory::GetValidation => vec![
                "falsification_pass".to_string(),
                "pre_mortem_analysis".to_string(),
                "identify_critical_weaknesses".to_string(),
                "assume_complete_failure_and_explain_why".to_string(),
            ],
            _ => vec!["comprehensive_analysis".to_string()],
        }
    }
}
