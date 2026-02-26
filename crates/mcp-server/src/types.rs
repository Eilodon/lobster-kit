// types.rs — Shared data types for the MCP server
//
// Extracted from main.rs to reduce God File complexity.
// These types are used across db, telemetry, tools, and server modules.

use std::collections::VecDeque;

pub const MAX_LATENCY_SAMPLES: usize = 256;
pub const DEFAULT_USER_SATISFACTION: f64 = 0.5;

pub type TenantId = String;

// === Stateful Memory ===
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryEntry {
    #[serde(default = "default_tenant_id")]
    pub tenant_id: TenantId,
    pub timestamp: i64,
    pub category: String,
    pub content: String,
    #[serde(default = "default_embedding")]
    pub embedding: Vec<f32>,
}

pub fn default_embedding() -> Vec<f32> {
    Vec::new()
}

pub fn default_tenant_id() -> TenantId {
    "default".to_string()
}

#[derive(Clone, Debug)]
pub struct ToolTelemetry {
    pub calls: u64,
    pub errors: u64,
    pub fallback_count: u64,
    // Legacy coarse latency counter preserved for compatibility.
    pub total_latency_ms: u64,
    // High-resolution latency counter (microseconds) used for calculations.
    pub total_latency_us: u64,
    pub latency_p50_ms: f64,
    pub latency_p90_ms: f64,
    pub latency_p95_ms: f64,
    pub latency_p99_ms: f64,
    pub user_satisfaction: f64,
    pub last_called: i64,
    pub latency_sample_count: u64,
    // Stored in microseconds.
    pub latency_samples: VecDeque<u64>,
}

impl Default for ToolTelemetry {
    fn default() -> Self {
        Self {
            calls: 0,
            errors: 0,
            fallback_count: 0,
            total_latency_ms: 0,
            total_latency_us: 0,
            latency_p50_ms: 0.0,
            latency_p90_ms: 0.0,
            latency_p95_ms: 0.0,
            latency_p99_ms: 0.0,
            user_satisfaction: DEFAULT_USER_SATISFACTION,
            last_called: 0,
            latency_sample_count: 0,
            latency_samples: VecDeque::with_capacity(MAX_LATENCY_SAMPLES),
        }
    }
}

#[derive(Clone, Debug)]
pub struct PersistedToolPerformanceRow {
    pub tenant_id: TenantId,
    pub tool_name: String,
    pub call_count: u64,
    pub error_count: u64,
    pub fallback_count: u64,
    pub success_rate: f64,
    pub avg_latency_ms: f64,
    pub avg_latency_us: f64,
    pub latency_p50_ms: f64,
    pub latency_p90_ms: f64,
    pub latency_p95_ms: f64,
    pub latency_p99_ms: f64,
    pub fallback_rate: f64,
    pub user_satisfaction: f64,
    pub latency_sample_count: u64,
    pub last_called: i64,
}

#[derive(Clone, Debug)]
pub struct GeneratedToolAuditRow {
    pub tenant_id: TenantId,
    pub tool_name: String,
    pub need: String,
    pub status: String,
    pub reason: String,
    pub metadata: String,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct RecommenderShadowAuditRow {
    pub task: String,
    pub available_tools: String,
    pub primary_model: String,
    pub primary_top_tool: String,
    pub primary_top_score: f64,
    pub shadow_model: String,
    pub shadow_top_tool: String,
    pub shadow_top_score: f64,
    pub top1_agreement: bool,
    pub top3_overlap_ratio: f64,
    pub metadata: String,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct ToolPromotionThresholds {
    pub min_calls: u64,
    pub max_error_rate: f64,
    pub max_p95_ms: f64,
    pub max_fallback_rate: f64,
    pub min_satisfaction: f64,
}

#[derive(Clone, Debug)]
pub struct ToolAutopilotGuardrails {
    pub max_error_rate: f64,
    pub max_fallback_rate: f64,
    pub max_p95_ms: f64,
    pub max_p99_p50_ratio: f64,
    pub min_sample_count: u64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct EffectivePolicyThresholds {
    pub auto_execute_min_confidence: f64,
    pub propose_min_confidence: f64,
    pub ingress_block_risk: f64,
    pub ingress_block_critical: f64,
    pub ingress_ask_risk: f64,
    pub ingress_ask_critical: f64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecision {
    Allow,
    AskUser,
    Block,
}

impl PolicyDecision {
    pub fn as_str(&self) -> &'static str {
        match self {
            PolicyDecision::Allow => "allow",
            PolicyDecision::AskUser => "ask_user",
            PolicyDecision::Block => "block",
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PolicySignalSnapshot {
    pub lexical_risk_score: f64,
    pub critical_action_signal: f64,
    pub privacy_sensitive_payload: bool,
    pub actionable_tool: bool,
    pub trauma_inhibited: bool,
    pub historical_success_rate: f64,
    pub historical_fallback_rate: f64,
    pub historical_calls: u64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct UnifiedPolicyContext {
    pub policy_version: String,
    pub request_id: String,
    pub tenant_id: TenantId,
    pub tool_name: String,
    pub timestamp_ms: i64,
    pub signals: PolicySignalSnapshot,
    pub thresholds: EffectivePolicyThresholds,
    pub route_gate: serde_json::Value,
    pub decision: PolicyDecision,
    pub decision_reason: String,
}
