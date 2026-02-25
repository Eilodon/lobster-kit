use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteDecisionAudit {
    pub trace_id: String,
    pub tenant_id: String,
    pub provider: String,
    pub route_decision: String,
    pub fallback_used: bool,
    pub fallback_reason: Option<String>,
    pub latency_ms: u128,
    pub status: String,
    pub timestamp_ms: i64,
}

impl RouteDecisionAudit {
    pub fn new(
        tenant_id: impl Into<String>,
        provider: impl Into<String>,
        route_decision: impl Into<String>,
        fallback_used: bool,
        fallback_reason: Option<String>,
        latency_ms: u128,
        status: impl Into<String>,
    ) -> Self {
        let timestamp_ms = Utc::now().timestamp_millis();
        let trace_id = format!(
            "trace-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        Self {
            trace_id,
            tenant_id: tenant_id.into(),
            provider: provider.into(),
            route_decision: route_decision.into(),
            fallback_used,
            fallback_reason,
            latency_ms,
            status: status.into(),
            timestamp_ms,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            "{\"trace_id\":\"serialization_failed\",\"status\":\"error\"}".to_string()
        })
    }
}
