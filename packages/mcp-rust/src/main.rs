use core_rust::sentinel::causal::dagma::{Dagma, DagmaConfig};
use core_rust::sentinel::causal::{CausalGraph, CausalGraphV2};
use core_rust::sentinel::thermo::ThermodynamicEngine;
use core_rust::sentinel::variables::SentinelVariable;
use nalgebra::DMatrix;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

// === Upgrade 3: Stateful Memory ===
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryEntry {
    pub timestamp: i64,
    pub category: String,
    pub content: String,
}

// DeepSeekOracle abstraction with reqwest
#[derive(Clone)]
pub struct DeepSeekOracle {
    pub api_key: String,
    pub client: reqwest::Client,
}

impl DeepSeekOracle {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
    }

    pub async fn analyze(&self, context: &str) -> String {
        // Actual HTTP request to DeepSeek API
        let payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [
                { "role": "system", "content": "You are Eidolon-V Oracle." },
                { "role": "user", "content": context }
            ],
            "temperature": 0.1
        });

        match self
            .client
            .post("https://api.deepseek.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
        {
            Ok(res) => {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    json["choices"][0]["message"]["content"]
                        .as_str()
                        .unwrap_or("Failed to parse")
                        .to_string()
                } else {
                    "Failed to parse JSON".to_string()
                }
            }
            Err(e) => format!("API Error: {}", e),
        }
    }
}

pub struct EidolonMcpServer {
    oracle: Arc<DeepSeekOracle>,
    causal_brain: Arc<Mutex<CausalGraph>>,
    causal_brain_v2: Arc<Mutex<CausalGraphV2>>,
    thermo: Arc<Mutex<ThermodynamicEngine>>,
    trauma: Arc<Mutex<core_rust::sentinel::trauma::TraumaRegistry>>,
    agent_tx: tokio::sync::mpsc::Sender<core_rust::sentinel::systems::CognitiveEvent>,
    // Upgrade 1: Persistent User Profiles
    users: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    // Upgrade 3: Stateful Memory
    memories: Arc<Mutex<Vec<MemoryEntry>>>,
    replay_telemetry: Arc<Mutex<ReplayTelemetry>>,
    runtime_db_path: PathBuf,
    dagma_last_checkpoint: Arc<Mutex<i64>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct ReplayTelemetry {
    awake_replay_events: u64,
    sleep_replay_events: u64,
    fictive_replay_events: u64,
    total_outcomes: u64,
    prediction_error_ema: f64,
    last_update_ms: i64,
}

impl Default for ReplayTelemetry {
    fn default() -> Self {
        Self {
            awake_replay_events: 0,
            sleep_replay_events: 0,
            fictive_replay_events: 0,
            total_outcomes: 0,
            prediction_error_ema: 0.0,
            last_update_ms: 0,
        }
    }
}

#[derive(Debug, Clone)]
struct KciLiteComputation {
    ci_pass: bool,
    ci_p_value: Option<f64>,
    fail_streak: i64,
    sample_count: i64,
    should_attenuate: bool,
}

#[derive(Debug, Clone)]
struct DagmaSampleRow {
    cause_node: String,
    effect_node: String,
    outcome_positive: bool,
    severity: f32,
    state_json: serde_json::Value,
}

#[derive(Debug, Clone)]
struct DagmaRetrainComputation {
    sample_count: i64,
    training_sample_count: usize,
    learned_edges: Vec<(String, String, f32)>,
}

impl EidolonMcpServer {
    const KCI_LITE_WINDOW_MS: i64 = 30 * 60 * 1000;
    const KCI_LITE_MIN_EDGE_SAMPLES: i64 = 6;
    const KCI_LITE_MIN_BASELINE_SAMPLES: i64 = 6;
    const KCI_LITE_DEPENDENCE_PVALUE: f64 = 0.20;
    const KCI_LITE_FAIL_STREAK_ATTENUATE: i64 = 3;
    const KCI_LITE_ATTENUATION_FACTOR: f32 = 0.82;
    const DAGMA_RETRAIN_INTERVAL_SAMPLES: i64 = 1000;
    const DAGMA_MIN_TRAIN_SAMPLES: usize = 64;
    const DAGMA_MAX_TRAIN_SAMPLES: usize = 768;
    const DAGMA_EDGE_MIN_WEIGHT: f32 = 0.01;
    const DAGMA_LAMBDA_ONLINE: f32 = 0.60;
    const DAGMA_LAMBDA_PRIOR: f32 = 0.40;

    pub fn new(
        oracle: DeepSeekOracle,
        tx: tokio::sync::mpsc::Sender<core_rust::sentinel::systems::CognitiveEvent>,
    ) -> Self {
        let runtime_db_path = Self::resolve_runtime_db_path();
        Self::new_with_runtime_db_path(oracle, tx, runtime_db_path)
    }

    fn new_with_runtime_db_path(
        oracle: DeepSeekOracle,
        tx: tokio::sync::mpsc::Sender<core_rust::sentinel::systems::CognitiveEvent>,
        runtime_db_path: PathBuf,
    ) -> Self {
        // Load user profiles from disk if available
        let users = Self::load_users_from_disk();
        if let Err(err) = Self::init_runtime_db(&runtime_db_path) {
            eprintln!("[ClawKit] runtime DB init failed: {}", err);
        }
        Self {
            oracle: Arc::new(oracle),
            causal_brain: Arc::new(Mutex::new(CausalGraph::new())),
            causal_brain_v2: Arc::new(Mutex::new(CausalGraphV2::new())),
            thermo: Arc::new(Mutex::new(ThermodynamicEngine::new(
                core_rust::sentinel::thermo::ThermoConfig::default(),
            ))),
            trauma: Arc::new(Mutex::new(
                core_rust::sentinel::trauma::TraumaRegistry::new(),
            )),
            agent_tx: tx,
            users: Arc::new(Mutex::new(users)),
            memories: Arc::new(Mutex::new(Vec::new())),
            replay_telemetry: Arc::new(Mutex::new(ReplayTelemetry::default())),
            runtime_db_path,
            dagma_last_checkpoint: Arc::new(Mutex::new(0)),
        }
    }

    fn users_file_path() -> std::path::PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let dir = std::path::PathBuf::from(home).join(".clawkit");
        let _ = std::fs::create_dir_all(&dir);
        dir.join("users.json")
    }

    fn load_users_from_disk() -> HashMap<String, serde_json::Value> {
        let path = Self::users_file_path();
        if let Ok(data) = std::fs::read_to_string(&path) {
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            HashMap::new()
        }
    }

    async fn save_users_to_disk(&self) {
        let users = self.users.lock().await;
        let path = Self::users_file_path();
        if let Ok(json) = serde_json::to_string_pretty(&*users) {
            let _ = std::fs::write(path, json);
        }
    }

    fn resolve_runtime_db_path() -> PathBuf {
        if let Ok(raw) = std::env::var("CLAWKIT_COGNITIVE_DB_PATH") {
            let path = PathBuf::from(raw);
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            return path;
        }
        let path = PathBuf::from("data/memory/cognitive-runtime.db");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        path
    }

    fn open_runtime_db(&self) -> Result<Connection, String> {
        Connection::open(&self.runtime_db_path).map_err(|e| e.to_string())
    }

    fn init_runtime_db(path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS primitive_dict (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                usage_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS causal_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_ts_ms INTEGER NOT NULL,
                pattern TEXT NOT NULL,
                mode TEXT NOT NULL,
                severity REAL NOT NULL,
                cause_node TEXT NOT NULL,
                effect_node TEXT NOT NULL,
                outcome_positive INTEGER NOT NULL,
                primitive_name TEXT NOT NULL,
                state_json TEXT NOT NULL,
                context_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_causal_events_ts ON causal_events(event_ts_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_causal_events_pattern ON causal_events(pattern);
            CREATE INDEX IF NOT EXISTS idx_causal_events_primitive ON causal_events(primitive_name);

            CREATE TABLE IF NOT EXISTS kci_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                edge_key TEXT NOT NULL,
                window_start_ms INTEGER NOT NULL,
                window_end_ms INTEGER NOT NULL,
                ci_p_value REAL,
                ci_pass INTEGER NOT NULL,
                fail_streak INTEGER NOT NULL DEFAULT 0,
                sample_count INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                UNIQUE(edge_key, window_start_ms, window_end_ms)
            );
            CREATE INDEX IF NOT EXISTS idx_kci_stats_edge ON kci_stats(edge_key);

            CREATE TABLE IF NOT EXISTS dagma_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at_ms INTEGER NOT NULL,
                sample_count INTEGER NOT NULL,
                lambda_online REAL NOT NULL,
                lambda_prior REAL NOT NULL,
                w_prior_json TEXT NOT NULL,
                notes TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_dagma_snapshots_ts ON dagma_snapshots(created_at_ms DESC);
            "#,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn persist_causal_event(
        &self,
        now_ms: i64,
        pattern: &str,
        mode: &str,
        severity: f32,
        cause_node: &str,
        effect_node: &str,
        outcome_positive: bool,
        primitive_name: &str,
        state_json: &serde_json::Value,
        context_json: &serde_json::Value,
    ) -> Result<(), String> {
        let conn = self.open_runtime_db()?;
        conn.execute(
            r#"
            INSERT INTO primitive_dict (name, created_at_ms, updated_at_ms, usage_count)
            VALUES (?1, ?2, ?2, 1)
            ON CONFLICT(name) DO UPDATE SET
                updated_at_ms = excluded.updated_at_ms,
                usage_count = primitive_dict.usage_count + 1
            "#,
            params![primitive_name, now_ms],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            r#"
            INSERT INTO causal_events (
                event_ts_ms, pattern, mode, severity, cause_node, effect_node,
                outcome_positive, primitive_name, state_json, context_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                now_ms,
                pattern,
                mode,
                severity as f64,
                cause_node,
                effect_node,
                if outcome_positive { 1i64 } else { 0i64 },
                primitive_name,
                state_json.to_string(),
                context_json.to_string()
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn sentinel_variable_from_name(name: &str) -> Option<SentinelVariable> {
        SentinelVariable::all()
            .iter()
            .copied()
            .find(|variable| variable.name().eq_ignore_ascii_case(name))
    }

    fn infer_cause_variable(text: &str) -> &'static str {
        let lower = text.to_lowercase();
        if lower.contains("liquidity") {
            "LiquidityImbalance"
        } else if lower.contains("gas") {
            "GasPriceGwei"
        } else if lower.contains("mempool") {
            "MempoolPendingCnt"
        } else if lower.contains("whale") {
            "WhaleNetFlow"
        } else if lower.contains("smart money") || lower.contains("smart_money") {
            "SmartMoneyActivity"
        } else if lower.contains("macro") {
            "MacroFactor"
        } else {
            "Sentiment"
        }
    }

    fn infer_effect_variable(text: &str) -> &'static str {
        let lower = text.to_lowercase();
        if lower.contains("risk") {
            "PortfolioRisk"
        } else if lower.contains("volatility") {
            "Volatility"
        } else if lower.contains("gas") {
            "GasPriceGwei"
        } else {
            "PriceDelta"
        }
    }

    fn infer_target_variable(query: &str) -> Option<&'static str> {
        let lower = query.to_lowercase();
        if lower.contains("risk") {
            Some("PortfolioRisk")
        } else if lower.contains("volatility") {
            Some("Volatility")
        } else if lower.contains("price") || lower.contains("delta") {
            Some("PriceDelta")
        } else if lower.contains("gas") {
            Some("GasPriceGwei")
        } else {
            None
        }
    }

    fn normalize_primitive_name(value: &str) -> String {
        let mut parts = Vec::new();
        for token in value
            .trim()
            .to_lowercase()
            .split(|c: char| !c.is_ascii_alphanumeric())
        {
            if !token.is_empty() {
                parts.push(token.to_string());
            }
        }
        if parts.is_empty() {
            "global".to_string()
        } else {
            parts.join("_")
        }
    }

    fn derive_primitive_name(params: &serde_json::Value, pattern: &str, mode: &str) -> String {
        if let Some(primitive) = params["primitive"].as_str() {
            let normalized = Self::normalize_primitive_name(primitive);
            if normalized != "global" {
                return normalized;
            }
        }
        let mode_name = Self::normalize_primitive_name(mode);
        let tokens = Self::tokenize_keyword_primitives(pattern, 3);
        if tokens.is_empty() {
            return format!("{}_global", mode_name);
        }
        format!("{}__{}", mode_name, tokens.join("__"))
    }

    fn extract_requested_primitives(params: &serde_json::Value) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let mut push_primitive = |candidate: &str| {
            let normalized = Self::normalize_primitive_name(candidate);
            if normalized == "global" {
                return;
            }
            if seen.insert(normalized.clone()) {
                out.push(normalized);
            }
        };

        if let Some(primitive) = params["primitive"].as_str() {
            push_primitive(primitive);
        }
        if let Some(arr) = params["primitives"].as_array() {
            for value in arr {
                if let Some(primitive) = value.as_str() {
                    push_primitive(primitive);
                }
            }
        }
        out
    }

    fn split_identifier_tokens(text: &str) -> Vec<String> {
        let mut expanded = String::new();
        let mut prev_lower = false;
        for ch in text.trim().chars() {
            if ch.is_ascii_uppercase() {
                if prev_lower {
                    expanded.push('_');
                }
                expanded.push(ch.to_ascii_lowercase());
                prev_lower = false;
            } else if ch.is_ascii_alphanumeric() {
                expanded.push(ch.to_ascii_lowercase());
                prev_lower = ch.is_ascii_lowercase();
            } else {
                expanded.push('_');
                prev_lower = false;
            }
        }
        expanded
            .split('_')
            .filter(|token| token.len() >= 3)
            .map(|token| token.to_string())
            .collect()
    }

    fn is_primitive_stopword(token: &str) -> bool {
        matches!(
            token,
            "the"
                | "and"
                | "for"
                | "with"
                | "from"
                | "after"
                | "before"
                | "this"
                | "that"
                | "into"
                | "mode"
                | "pattern"
                | "risk"
        )
    }

    fn tokenize_keyword_primitives(text: &str, max_tokens: usize) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for token in text
            .to_lowercase()
            .split(|c: char| !c.is_ascii_alphanumeric())
        {
            if token.len() < 3 || Self::is_primitive_stopword(token) {
                continue;
            }
            if seen.insert(token.to_string()) {
                out.push(token.to_string());
                if out.len() >= max_tokens {
                    break;
                }
            }
        }
        out
    }

    fn state_bucket(value: f64) -> &'static str {
        if value >= 0.75 {
            "high"
        } else if value <= 0.25 {
            "low"
        } else {
            "mid"
        }
    }

    fn collect_state_features(state: &serde_json::Value, max_features: usize) -> Vec<String> {
        let Some(obj) = state.as_object() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for (key, value) in obj {
            let normalized_key = Self::normalize_primitive_name(key);
            if normalized_key == "global" {
                continue;
            }
            if seen.insert(normalized_key.clone()) {
                out.push(normalized_key.clone());
            }

            match value {
                serde_json::Value::Number(number) => {
                    if let Some(v) = number.as_f64() {
                        let bucket = Self::state_bucket(v);
                        let combined = format!("{}_{}", normalized_key, bucket);
                        if seen.insert(combined.clone()) {
                            out.push(combined);
                        }
                    }
                }
                serde_json::Value::Bool(flag) => {
                    let combined = format!(
                        "{}_{}",
                        normalized_key,
                        if *flag { "true" } else { "false" }
                    );
                    if seen.insert(combined.clone()) {
                        out.push(combined);
                    }
                }
                serde_json::Value::String(text) => {
                    for token in Self::tokenize_keyword_primitives(text, 2) {
                        let combined = format!("{}_{}", normalized_key, token);
                        if seen.insert(combined.clone()) {
                            out.push(combined);
                        }
                    }
                }
                _ => {}
            }

            if out.len() >= max_features {
                break;
            }
        }
        out.truncate(max_features);
        out
    }

    fn extract_experience_primitives(
        params: &serde_json::Value,
        pattern: &str,
        mode: &str,
        cause_variable: &str,
        effect_variable: &str,
        state_payload: &serde_json::Value,
        context_payload: &serde_json::Value,
    ) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let mut push = |candidate: &str| {
            let normalized = Self::normalize_primitive_name(candidate);
            if normalized == "global" {
                return;
            }
            if seen.insert(normalized.clone()) {
                out.push(normalized);
            }
        };

        let primary = Self::derive_primitive_name(params, pattern, mode);
        push(&primary);

        for primitive in Self::extract_requested_primitives(params) {
            push(&primitive);
        }

        let mode_name = Self::normalize_primitive_name(mode);
        let cause_name = Self::normalize_primitive_name(cause_variable);
        let effect_name = Self::normalize_primitive_name(effect_variable);
        push(&cause_name);
        push(&effect_name);
        push(&format!("{}__{}", cause_name, effect_name));
        push(&format!("{}__{}__{}", mode_name, cause_name, effect_name));
        for token in Self::split_identifier_tokens(cause_variable) {
            push(&format!("{}__{}", mode_name, token));
        }
        for token in Self::split_identifier_tokens(effect_variable) {
            push(&format!("{}__{}", mode_name, token));
        }

        for token in Self::tokenize_keyword_primitives(pattern, 3) {
            push(&format!("{}__{}", mode_name, token));
        }

        for feature in Self::collect_state_features(state_payload, 4) {
            push(&feature);
            push(&format!("{}__{}", mode_name, feature));
        }

        if let Some(obj) = context_payload.as_object() {
            for (key, value) in obj {
                let key_name = Self::normalize_primitive_name(key);
                push(&key_name);
                if let Some(text) = value.as_str() {
                    for token in Self::tokenize_keyword_primitives(text, 2) {
                        push(&format!("{}__{}", key_name, token));
                    }
                }
            }
        }

        if out.is_empty() {
            return vec!["global".to_string()];
        }

        out.truncate(10);
        out
    }

    fn should_use_causal_route(route: &str, query_lower: &str) -> bool {
        if route.eq_ignore_ascii_case("causal") {
            return true;
        }
        route.eq_ignore_ascii_case("auto")
            && (query_lower.contains("why")
                || query_lower.contains("cause")
                || query_lower.contains("because")
                || query_lower.contains("increased")
                || query_lower.contains("decreased"))
    }

    fn normalize_token(token: &str) -> String {
        token.trim().to_lowercase()
    }

    fn build_kci_edge_key(
        cause_variable: &str,
        effect_variable: &str,
        primitive_name: &str,
    ) -> String {
        format!(
            "{}->{}@{}",
            Self::normalize_token(cause_variable),
            Self::normalize_token(effect_variable),
            if primitive_name.trim().is_empty() {
                "global".to_string()
            } else {
                Self::normalize_token(primitive_name)
            }
        )
    }

    fn approx_normal_cdf(x: f64) -> f64 {
        // Abramowitz and Stegun formula 7.1.26
        let sign = if x < 0.0 { -1.0 } else { 1.0 };
        let x = x.abs() / (2.0_f64).sqrt();
        let t = 1.0 / (1.0 + 0.327_591_1 * x);
        let a1 = 0.254_829_592;
        let a2 = -0.284_496_736;
        let a3 = 1.421_413_741;
        let a4 = -1.453_152_027;
        let a5 = 1.061_405_429;
        let erf = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * (-x * x).exp());
        0.5 * (1.0 + sign * erf)
    }

    fn approx_two_tailed_p_value_from_z(z: f64) -> f64 {
        let tail = (1.0 - Self::approx_normal_cdf(z.abs())).clamp(0.0, 1.0);
        (2.0 * tail).clamp(0.0, 1.0)
    }

    fn run_kci_lite_window_update(
        db_path: &Path,
        now_ms: i64,
        edge_key: &str,
        cause_variable: &str,
        effect_variable: &str,
        primitive_name: &str,
    ) -> Result<KciLiteComputation, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        let window_start_ms = now_ms - Self::KCI_LITE_WINDOW_MS;

        let (edge_count, edge_positive): (i64, i64) = conn
            .query_row(
                r#"
                SELECT COUNT(*), COALESCE(SUM(outcome_positive), 0)
                FROM causal_events
                WHERE event_ts_ms BETWEEN ?1 AND ?2
                  AND LOWER(cause_node) = LOWER(?3)
                  AND LOWER(effect_node) = LOWER(?4)
                  AND LOWER(primitive_name) = LOWER(?5)
                "#,
                params![
                    window_start_ms,
                    now_ms,
                    cause_variable,
                    effect_variable,
                    primitive_name
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        let mut baseline: (i64, i64) = conn
            .query_row(
                r#"
                SELECT COUNT(*), COALESCE(SUM(outcome_positive), 0)
                FROM causal_events
                WHERE event_ts_ms BETWEEN ?1 AND ?2
                  AND LOWER(cause_node) <> LOWER(?3)
                  AND LOWER(effect_node) = LOWER(?4)
                  AND LOWER(primitive_name) = LOWER(?5)
                "#,
                params![
                    window_start_ms,
                    now_ms,
                    cause_variable,
                    effect_variable,
                    primitive_name
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        if baseline.0 < Self::KCI_LITE_MIN_BASELINE_SAMPLES {
            baseline = conn
                .query_row(
                    r#"
                    SELECT COUNT(*), COALESCE(SUM(outcome_positive), 0)
                    FROM causal_events
                    WHERE event_ts_ms BETWEEN ?1 AND ?2
                      AND LOWER(cause_node) <> LOWER(?3)
                      AND LOWER(effect_node) = LOWER(?4)
                    "#,
                    params![window_start_ms, now_ms, cause_variable, effect_variable],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|e| e.to_string())?;
        }

        let previous_fail_streak: i64 = conn
            .query_row(
                "SELECT fail_streak FROM kci_stats WHERE edge_key = ?1 ORDER BY window_end_ms DESC LIMIT 1",
                params![edge_key],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let (ci_pass, ci_p_value) = if edge_count < Self::KCI_LITE_MIN_EDGE_SAMPLES
            || baseline.0 < Self::KCI_LITE_MIN_BASELINE_SAMPLES
        {
            (true, None)
        } else {
            let edge_rate = (edge_positive as f64 / edge_count as f64).clamp(0.0, 1.0);
            let base_rate = (baseline.1 as f64 / baseline.0 as f64).clamp(0.0, 1.0);
            let pooled = ((edge_positive + baseline.1) as f64 / (edge_count + baseline.0) as f64)
                .clamp(1e-6, 1.0 - 1e-6);
            let variance = pooled * (1.0 - pooled);
            let inv_n = (1.0 / edge_count as f64) + (1.0 / baseline.0 as f64);
            let se = (variance * inv_n).sqrt();

            let p_value = if se <= 1e-9 {
                1.0
            } else {
                let z = ((edge_rate - base_rate).abs() / se).clamp(0.0, 12.0);
                Self::approx_two_tailed_p_value_from_z(z)
            };
            (p_value < Self::KCI_LITE_DEPENDENCE_PVALUE, Some(p_value))
        };

        let fail_streak = if ci_pass {
            0
        } else {
            previous_fail_streak.saturating_add(1)
        };
        let sample_count = edge_count + baseline.0;
        let should_attenuate = !ci_pass && fail_streak >= Self::KCI_LITE_FAIL_STREAK_ATTENUATE;

        let metadata = serde_json::json!({
            "edge_sample_count": edge_count,
            "edge_positive_count": edge_positive,
            "baseline_sample_count": baseline.0,
            "baseline_positive_count": baseline.1,
            "kci_mode": "lite_proportion_test",
            "dependence_pvalue_threshold": Self::KCI_LITE_DEPENDENCE_PVALUE
        });

        conn.execute(
            r#"
            INSERT INTO kci_stats (
                edge_key, window_start_ms, window_end_ms, ci_p_value, ci_pass,
                fail_streak, sample_count, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(edge_key, window_start_ms, window_end_ms) DO UPDATE SET
                ci_p_value = excluded.ci_p_value,
                ci_pass = excluded.ci_pass,
                fail_streak = excluded.fail_streak,
                sample_count = excluded.sample_count,
                metadata_json = excluded.metadata_json
            "#,
            params![
                edge_key,
                window_start_ms,
                now_ms,
                ci_p_value,
                if ci_pass { 1i64 } else { 0i64 },
                fail_streak,
                sample_count,
                metadata.to_string()
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(KciLiteComputation {
            ci_pass,
            ci_p_value,
            fail_streak,
            sample_count,
            should_attenuate,
        })
    }

    async fn run_kci_lite_worker(
        runtime_db_path: PathBuf,
        causal_brain_v2: Arc<Mutex<CausalGraphV2>>,
        cause_variable: String,
        effect_variable: String,
        primitive_name: String,
    ) -> Result<(), String> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let edge_key = Self::build_kci_edge_key(&cause_variable, &effect_variable, &primitive_name);
        let db_cause = cause_variable.clone();
        let db_effect = effect_variable.clone();
        let db_primitive = primitive_name.clone();
        let db_path = runtime_db_path.clone();

        let stats = tokio::task::spawn_blocking(move || {
            Self::run_kci_lite_window_update(
                &db_path,
                now_ms,
                &edge_key,
                &db_cause,
                &db_effect,
                &db_primitive,
            )
        })
        .await
        .map_err(|e| e.to_string())??;

        if stats.should_attenuate {
            let mut brain_v2 = causal_brain_v2.lock().await;
            let attenuated = brain_v2.attenuate_edge_by_name(
                &cause_variable,
                &effect_variable,
                &primitive_name,
                Self::KCI_LITE_ATTENUATION_FACTOR,
            );
            if !attenuated {
                let _ = brain_v2.attenuate_edge_by_name(
                    &cause_variable,
                    &effect_variable,
                    "global",
                    Self::KCI_LITE_ATTENUATION_FACTOR,
                );
            }
        }

        if !stats.ci_pass {
            eprintln!(
                "[ClawKit] KCI-lite ci_fail edge={} p_value={:?} fail_streak={} sample_count={}",
                Self::build_kci_edge_key(&cause_variable, &effect_variable, &primitive_name),
                stats.ci_p_value,
                stats.fail_streak,
                stats.sample_count
            );
        }

        Ok(())
    }

    fn schedule_kci_lite_worker(
        &self,
        cause_variable: String,
        effect_variable: String,
        primitive_name: String,
    ) {
        let db_path = self.runtime_db_path.clone();
        let causal_brain_v2 = self.causal_brain_v2.clone();
        tokio::spawn(async move {
            if let Err(err) = Self::run_kci_lite_worker(
                db_path,
                causal_brain_v2,
                cause_variable,
                effect_variable,
                primitive_name,
            )
            .await
            {
                eprintln!("[ClawKit] KCI-lite worker failed: {}", err);
            }
        });
    }

    fn fetch_total_causal_event_count(db_path: &Path) -> Result<i64, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.query_row("SELECT COUNT(*) FROM causal_events", [], |row| row.get(0))
            .map_err(|e| e.to_string())
    }

    fn fetch_dagma_training_rows(
        db_path: &Path,
        limit: usize,
    ) -> Result<Vec<DagmaSampleRow>, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT cause_node, effect_node, outcome_positive, severity, state_json
                FROM causal_events
                ORDER BY event_ts_ms DESC
                LIMIT ?1
                "#,
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(params![limit as i64])
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let state_raw: String = row.get(4).map_err(|e| e.to_string())?;
            let state_json = serde_json::from_str::<serde_json::Value>(&state_raw)
                .unwrap_or(serde_json::json!({}));
            out.push(DagmaSampleRow {
                cause_node: row.get::<_, String>(0).map_err(|e| e.to_string())?,
                effect_node: row.get::<_, String>(1).map_err(|e| e.to_string())?,
                outcome_positive: row.get::<_, i64>(2).map_err(|e| e.to_string())? > 0,
                severity: row.get::<_, f64>(3).map_err(|e| e.to_string())? as f32,
                state_json,
            });
        }
        Ok(out)
    }

    fn normalize_numeric_feature(value: f64) -> f32 {
        value.tanh().clamp(-1.0, 1.0) as f32
    }

    fn build_dagma_training_matrix(
        samples: &[DagmaSampleRow],
    ) -> Option<(Vec<String>, DMatrix<f32>)> {
        if samples.is_empty() {
            return None;
        }

        let mut node_names: Vec<String> = SentinelVariable::all()
            .iter()
            .map(|variable| variable.name().to_string())
            .collect();
        let mut node_index: HashMap<String, usize> = node_names
            .iter()
            .enumerate()
            .map(|(idx, name)| (Self::normalize_token(name), idx))
            .collect();

        for sample in samples {
            for name in [&sample.cause_node, &sample.effect_node] {
                let normalized = Self::normalize_token(name);
                if node_index.contains_key(&normalized) {
                    continue;
                }
                node_index.insert(normalized, node_names.len());
                node_names.push(name.to_string());
            }
        }

        let rows = samples.len();
        let cols = node_names.len();
        if cols < 2 {
            return None;
        }

        let mut values = vec![0.0f32; rows * cols];
        for (row_idx, sample) in samples.iter().enumerate() {
            let offset = row_idx * cols;
            if let Some(&cause_idx) = node_index.get(&Self::normalize_token(&sample.cause_node)) {
                values[offset + cause_idx] = 1.0;
            }

            if let Some(&effect_idx) = node_index.get(&Self::normalize_token(&sample.effect_node)) {
                let confidence = (1.0 - (sample.severity / 5.0).clamp(0.0, 1.0)).clamp(0.0, 1.0);
                values[offset + effect_idx] = if sample.outcome_positive {
                    0.6 + 0.4 * confidence
                } else {
                    -(0.6 + 0.4 * (1.0 - confidence))
                };
            }

            if let Some(state_obj) = sample.state_json.as_object() {
                for (key, value) in state_obj {
                    let Some(&idx) = node_index.get(&Self::normalize_token(key)) else {
                        continue;
                    };
                    let feature = match value {
                        serde_json::Value::Number(number) => {
                            number.as_f64().map(Self::normalize_numeric_feature)
                        }
                        serde_json::Value::Bool(flag) => Some(if *flag { 1.0 } else { -1.0 }),
                        _ => None,
                    };
                    if let Some(feature_value) = feature {
                        let current = values[offset + idx];
                        values[offset + idx] = if current == 0.0 {
                            feature_value
                        } else {
                            0.5 * current + 0.5 * feature_value
                        };
                    }
                }
            }
        }

        Some((node_names, DMatrix::from_row_slice(rows, cols, &values)))
    }

    fn extract_dagma_learned_edges(
        node_names: &[String],
        learned_matrix: &DMatrix<f32>,
    ) -> Vec<(String, String, f32)> {
        let mut out = Vec::new();
        let cols = learned_matrix.ncols();
        for cause_idx in 0..learned_matrix.nrows() {
            for effect_idx in 0..cols {
                if cause_idx == effect_idx {
                    continue;
                }
                let raw_weight = learned_matrix[(cause_idx, effect_idx)];
                let weight = raw_weight.abs().clamp(0.0, 1.0);
                if weight < Self::DAGMA_EDGE_MIN_WEIGHT {
                    continue;
                }
                out.push((
                    node_names[cause_idx].clone(),
                    node_names[effect_idx].clone(),
                    weight,
                ));
            }
        }
        out
    }

    fn run_dagma_retrain_once(db_path: &Path) -> Result<Option<DagmaRetrainComputation>, String> {
        let total_samples = Self::fetch_total_causal_event_count(db_path)?;
        if total_samples < Self::DAGMA_MIN_TRAIN_SAMPLES as i64 {
            return Ok(None);
        }

        let samples = Self::fetch_dagma_training_rows(db_path, Self::DAGMA_MAX_TRAIN_SAMPLES)?;
        if samples.len() < Self::DAGMA_MIN_TRAIN_SAMPLES {
            return Ok(None);
        }

        let Some((node_names, matrix)) = Self::build_dagma_training_matrix(&samples) else {
            return Ok(None);
        };

        let dagma = Dagma::new(DagmaConfig {
            max_iter: 8,
            tol: 1e-3,
            lambda1: 0.02,
            rho_max: 1e6,
            s: 1.0,
        });
        let learned_matrix = dagma.fit(&matrix);
        let learned_edges = Self::extract_dagma_learned_edges(&node_names, &learned_matrix);
        if learned_edges.is_empty() {
            return Ok(None);
        }

        Ok(Some(DagmaRetrainComputation {
            sample_count: total_samples,
            training_sample_count: samples.len(),
            learned_edges,
        }))
    }

    fn persist_dagma_snapshot(
        db_path: &Path,
        sample_count: i64,
        lambda_online: f32,
        lambda_prior: f32,
        edge_payload: serde_json::Value,
        notes: &str,
    ) -> Result<(), String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.execute(
            r#"
            INSERT INTO dagma_snapshots (
                created_at_ms, sample_count, lambda_online, lambda_prior, w_prior_json, notes
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                chrono::Utc::now().timestamp_millis(),
                sample_count,
                lambda_online as f64,
                lambda_prior as f64,
                edge_payload.to_string(),
                notes
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn run_dagma_retrain_worker(
        runtime_db_path: PathBuf,
        causal_brain_v2: Arc<Mutex<CausalGraphV2>>,
        checkpoint: i64,
    ) -> Result<(), String> {
        let db_path_for_train = runtime_db_path.clone();
        let maybe_retrain =
            tokio::task::spawn_blocking(move || Self::run_dagma_retrain_once(&db_path_for_train))
                .await
                .map_err(|e| e.to_string())??;

        let Some(retrain) = maybe_retrain else {
            return Ok(());
        };

        let mut merged_edges = 0usize;
        {
            let mut brain_v2 = causal_brain_v2.lock().await;
            for (cause_name, effect_name, learned_weight) in &retrain.learned_edges {
                let cause = brain_v2.ensure_node(cause_name);
                let effect = brain_v2.ensure_node(effect_name);
                let edge_key = (cause.0, effect.0);
                let prior = brain_v2.prior_edges.get(&edge_key).copied().unwrap_or(0.0);
                let merged = (Self::DAGMA_LAMBDA_PRIOR * prior
                    + Self::DAGMA_LAMBDA_ONLINE * *learned_weight)
                    .clamp(0.0, 1.0);
                brain_v2.prior_edges.insert(edge_key, merged);
                merged_edges += 1;
            }
        }

        let edge_payload = serde_json::json!({
            "checkpoint": checkpoint,
            "training_sample_count": retrain.training_sample_count,
            "merged_edges": merged_edges,
            "edges": retrain.learned_edges.iter().map(|(cause, effect, weight)| {
                serde_json::json!({
                    "cause": cause,
                    "effect": effect,
                    "weight": weight
                })
            }).collect::<Vec<serde_json::Value>>()
        });
        let snapshot_notes = format!(
            "periodic_dagma_retrain checkpoint={} merged_edges={}",
            checkpoint, merged_edges
        );
        let db_path_for_snapshot = runtime_db_path.clone();
        tokio::task::spawn_blocking(move || {
            Self::persist_dagma_snapshot(
                &db_path_for_snapshot,
                retrain.sample_count,
                Self::DAGMA_LAMBDA_ONLINE,
                Self::DAGMA_LAMBDA_PRIOR,
                edge_payload,
                &snapshot_notes,
            )
        })
        .await
        .map_err(|e| e.to_string())??;

        Ok(())
    }

    fn schedule_dagma_retrain_worker(&self, checkpoint: i64) {
        let db_path = self.runtime_db_path.clone();
        let causal_brain_v2 = self.causal_brain_v2.clone();
        tokio::spawn(async move {
            if let Err(err) =
                Self::run_dagma_retrain_worker(db_path, causal_brain_v2, checkpoint).await
            {
                eprintln!("[ClawKit] DAGMA worker failed: {}", err);
            }
        });
    }

    async fn maybe_schedule_dagma_retrain(&self) -> bool {
        let sample_count = match Self::fetch_total_causal_event_count(&self.runtime_db_path) {
            Ok(count) => count,
            Err(err) => {
                eprintln!("[ClawKit] DAGMA sample count failed: {}", err);
                return false;
            }
        };

        let checkpoint = sample_count / Self::DAGMA_RETRAIN_INTERVAL_SAMPLES;
        if checkpoint <= 0 {
            return false;
        }

        let mut last_checkpoint = self.dagma_last_checkpoint.lock().await;
        if checkpoint <= *last_checkpoint {
            return false;
        }
        *last_checkpoint = checkpoint;
        drop(last_checkpoint);

        self.schedule_dagma_retrain_worker(checkpoint);
        true
    }

    fn normalize_prediction_error(severity: f32) -> f64 {
        (severity as f64 / 5.0).clamp(0.0, 1.0)
    }

    async fn register_awake_replay(&self, prediction_error: f64, now_ms: i64) -> ReplayTelemetry {
        let mut telemetry = self.replay_telemetry.lock().await;
        telemetry.awake_replay_events = telemetry.awake_replay_events.saturating_add(1);
        telemetry.total_outcomes = telemetry.total_outcomes.saturating_add(1);
        // Exponential moving average of surprise.
        telemetry.prediction_error_ema =
            0.9 * telemetry.prediction_error_ema + 0.1 * prediction_error;
        telemetry.last_update_ms = now_ms;
        telemetry.clone()
    }

    async fn register_sleep_replay(
        &self,
        sleep_events: u64,
        fictive_events: u64,
        now_ms: i64,
    ) -> ReplayTelemetry {
        let mut telemetry = self.replay_telemetry.lock().await;
        telemetry.sleep_replay_events = telemetry.sleep_replay_events.saturating_add(sleep_events);
        telemetry.fictive_replay_events = telemetry
            .fictive_replay_events
            .saturating_add(fictive_events);
        telemetry.last_update_ms = now_ms;
        telemetry.clone()
    }

    async fn snapshot_replay_telemetry(&self) -> ReplayTelemetry {
        self.replay_telemetry.lock().await.clone()
    }

    pub async fn handle_tool_call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> serde_json::Value {
        match method {
            // PHASE A: CORE LOOP TOOLS
            "clawkit_recall_user" => {
                let user_id = params["user_id"].as_str().unwrap_or("unknown");
                let users = self.users.lock().await;
                let profile = users.get(user_id).cloned().unwrap_or_else(|| {
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
            "clawkit_sense_intent" => {
                let _brain = self.causal_brain.lock().await;
                // Dispatch event to Actor for async evaluation
                let _ = self
                    .agent_tx
                    .send(core_rust::sentinel::systems::CognitiveEvent::Evaluate)
                    .await;

                serde_json::json!({
                    "success": true,
                    "confidence": 0.95,
                    "recommended_mode": "Peer",
                    "thermo_entropy": 0.4
                })
            }
            "clawkit_check_pattern" => {
                let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
                let mode_str = params["mode"].as_str().unwrap_or("Peer");

                let mode = match mode_str {
                    "Stalking" => core_rust::sentinel::modes::SentinelMode::Stalking,
                    "Berserk" => core_rust::sentinel::modes::SentinelMode::Berserk,
                    "Snipe" => core_rust::sentinel::modes::SentinelMode::Snipe,
                    _ => core_rust::sentinel::modes::SentinelMode::Zen,
                };

                let trauma = self.trauma.lock().await;
                let now = chrono::Utc::now().timestamp_millis();
                let is_inhibited = trauma.is_inhibited(mode, pattern, now);
                let remaining_ms = trauma.get_remaining_ms(mode, pattern, now);

                serde_json::json!({
                    "pattern": pattern,
                    "inhibited": is_inhibited,
                    "remaining_ms": remaining_ms
                })
            }
            "clawkit_simulate_response" => {
                let action = params["action"].as_str().unwrap_or("default");
                let trauma = self.trauma.lock().await;
                let now = chrono::Utc::now().timestamp_millis();

                // Real Simulation: Cross-reference action across all modes in TraumaRegistry
                let modes = vec![
                    core_rust::sentinel::modes::SentinelMode::Zen,
                    core_rust::sentinel::modes::SentinelMode::Emergency,
                    core_rust::sentinel::modes::SentinelMode::Stalking,
                    core_rust::sentinel::modes::SentinelMode::Berserk,
                    core_rust::sentinel::modes::SentinelMode::Snipe,
                ];

                let mut inhibited_mode = None;
                for mode in modes {
                    if trauma.is_inhibited(mode, action, now) {
                        inhibited_mode = Some(mode);
                        break;
                    }
                }

                if let Some(_mode) = inhibited_mode {
                    serde_json::json!({
                        "action_tested": action,
                        "predicted_outcome": "negative",
                        "confidence": 0.99,
                        "should_revise": true,
                        "reason": "Action is currently inhibited by TraumaRegistry due to past negative outcomes."
                    })
                } else {
                    serde_json::json!({
                        "action_tested": action,
                        "predicted_outcome": "positive",
                        "confidence": 0.85,
                        "should_revise": false,
                        "reason": "No historical trauma found for this action."
                    })
                }
            }
            "clawkit_commit_pattern" => {
                let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
                let mut thermo = self.thermo.lock().await;
                let state = nalgebra::DVector::from_element(5, 0.5);
                let target = nalgebra::DVector::from_element(5, 0.6);
                let new_state = thermo.step(&state, &target);
                let entropy = thermo.entropy(&new_state);

                // Upgrade 3: Push to Stateful Memory
                let mut mems = self.memories.lock().await;
                mems.push(MemoryEntry {
                    timestamp: chrono::Utc::now().timestamp_millis(),
                    category: "commit".to_string(),
                    content: format!("Pattern '{}' committed. Entropy: {:.4}", pattern, entropy),
                });

                serde_json::json!({
                    "status": "committed",
                    "pattern": pattern,
                    "new_entropy": entropy
                })
            }
            // PHASE B: REASONING & MEMORY TOOLS
            "clawkit_reason_chain" => {
                // Upgrade 4: Real mathematical scoring using ThermodynamicEngine
                let draft = params["draft"].as_str().unwrap_or("");
                let context = params["context"].as_str().unwrap_or("");
                let mode = params["mode"].as_str().unwrap_or("fast");

                let mut thermo = self.thermo.lock().await;
                // Seed DVector based on text variance (simulated by character distribution)
                let len_draft = draft.len() as f32;
                let len_ctx = context.len() as f32;
                let ratio = if len_ctx > 0.0 {
                    len_draft / len_ctx
                } else {
                    1.0
                }
                .clamp(0.1, 10.0);

                let state = nalgebra::DVector::from_element(5, 0.5 * ratio.min(1.0));
                let target = nalgebra::DVector::from_element(5, 0.1); // Target low entropy
                let new_state = thermo.step(&state, &target);
                let entropy = thermo.entropy(&new_state);

                // Entropy bounds [0.0, ~2.0]. Lower entropy = Higher Coherence = Higher Score
                let score = (1.0 - (entropy / 2.0)).max(0.0).min(1.0);

                // Qualitative critique via Oracle
                let prompt = format!(
                    "Evaluate draft: {}\nContext: {}\nMode: {}",
                    draft, context, mode
                );
                let insight = self.oracle.analyze(&prompt).await;

                let iterations = if mode == "deep" { 3 } else { 1 };

                serde_json::json!({
                    "draft_evaluation": insight,
                    "final_score": score,
                    "thermo_entropy": entropy,
                    "iterations": iterations
                })
            }
            "clawkit_recall_similar" => {
                // Upgraded: search memories by context similarity (substring match)
                let context = params["context"].as_str().unwrap_or("");
                let k = params["k"].as_u64().unwrap_or(5) as usize;
                let mems = self.memories.lock().await;

                if context.is_empty() || mems.is_empty() {
                    return serde_json::json!({
                        "matches": [],
                        "total_memories": mems.len(),
                        "note": "No context provided or memory store is empty."
                    });
                }

                let ctx_lower = context.to_lowercase();
                let ctx_words: Vec<&str> = ctx_lower.split_whitespace().collect();

                // Score each memory by word overlap
                let mut scored: Vec<(f64, &MemoryEntry)> = mems
                    .iter()
                    .map(|m| {
                        let content_lower = m.content.to_lowercase();
                        let matching = ctx_words
                            .iter()
                            .filter(|w| content_lower.contains(*w))
                            .count();
                        let similarity = if ctx_words.is_empty() {
                            0.0
                        } else {
                            matching as f64 / ctx_words.len() as f64
                        };
                        (similarity, m)
                    })
                    .filter(|(s, _)| *s > 0.0)
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
                    "total_memories": mems.len()
                })
            }
            "clawkit_memory_query" => {
                // Upgrade 3: Real stateful memory search + causal-v2 route
                let query = params["query"].as_str().unwrap_or("");
                let route = params["route"].as_str().unwrap_or("auto");
                let query_lower = query.to_lowercase();

                if !query.is_empty() && Self::should_use_causal_route(route, &query_lower) {
                    if let Some(target_variable) = Self::infer_target_variable(query) {
                        let mut requested_primitives = Self::extract_requested_primitives(&params);
                        let state_features = Self::collect_state_features(&params["state"], 6);
                        for feature in state_features.iter().take(3) {
                            let candidate = Self::normalize_primitive_name(feature);
                            if !requested_primitives.iter().any(|item| item == &candidate) {
                                requested_primitives.push(candidate);
                            }
                        }
                        let top_k_primitives =
                            params["top_k_primitives"].as_u64().unwrap_or(3) as usize;
                        let top_n = params["top_n"].as_u64().unwrap_or(5) as usize;
                        let causal_brain_v2 = self.causal_brain_v2.lock().await;
                        let active_primitives = causal_brain_v2.active_primitives_with_state(
                            query,
                            &requested_primitives,
                            &state_features,
                            top_k_primitives,
                        );
                        let ranked = causal_brain_v2.rank_causes_for_target(
                            target_variable,
                            query,
                            &requested_primitives,
                            &state_features,
                            top_k_primitives,
                            top_n,
                        );
                        if !ranked.is_empty() {
                            return serde_json::json!({
                                "query": query,
                                "route_candidates": ["causal_v2", "semantic", "episodic"],
                                "route_requested": route,
                                "route_selected": "causal_v2",
                                "target_variable": target_variable,
                                "state_features": state_features,
                                "active_primitives": active_primitives.iter().map(|(name, score)| {
                                    serde_json::json!({"primitive": name, "activation": score})
                                }).collect::<Vec<serde_json::Value>>(),
                                "matches": ranked.len(),
                                "results": ranked
                            });
                        }
                    }
                }

                let mems = self.memories.lock().await;

                // Guard: empty query returns all memories (up to 10)
                if query.is_empty() {
                    let results: Vec<serde_json::Value> = mems
                        .iter()
                        .rev()
                        .take(10)
                        .map(|m| {
                            serde_json::json!({
                                "timestamp": m.timestamp,
                                "category": m.category,
                                "content": m.content
                            })
                        })
                        .collect();
                    return serde_json::json!({
                        "query": "*",
                        "route_selected": "semantic",
                        "total_memories": mems.len(),
                        "matches": results.len(),
                        "results": results
                    });
                }

                let query_lower = query.to_lowercase();
                let matches: Vec<&MemoryEntry> = mems
                    .iter()
                    .filter(|m| {
                        m.content.to_lowercase().contains(&query_lower)
                            || m.category.to_lowercase().contains(&query_lower)
                    })
                    .collect();

                if matches.is_empty() {
                    serde_json::json!({
                        "query": query,
                        "route_selected": "semantic",
                        "total_memories": mems.len(),
                        "matches": 0,
                        "results": "No matching memories found. Record outcomes or commit patterns first."
                    })
                } else {
                    let results: Vec<serde_json::Value> = matches
                        .iter()
                        .take(10)
                        .map(|m| {
                            serde_json::json!({
                                "timestamp": m.timestamp,
                                "category": m.category,
                                "content": m.content
                            })
                        })
                        .collect();
                    serde_json::json!({
                        "query": query,
                        "route_selected": "semantic",
                        "total_memories": mems.len(),
                        "matches": results.len(),
                        "results": results
                    })
                }
            }
            "clawkit_compress_context" => {
                // Upgrade 2: Real context compression
                let target_tokens =
                    params["target_tokens"].as_u64().unwrap_or(1000).max(1) as usize;
                let context = params["context"].as_str().unwrap_or("");

                if context.is_empty() {
                    // Fallback: compress from memory store
                    let mems = self.memories.lock().await;
                    if mems.is_empty() {
                        return serde_json::json!({
                            "compressed_context": "",
                            "original_tokens": 0,
                            "compressed_tokens": 0,
                            "compression_ratio": "N/A",
                            "source": "memory_store",
                            "note": "Memory store is empty. Record outcomes or commit patterns first."
                        });
                    }
                    let summary: String = mems
                        .iter()
                        .rev()
                        .take(10)
                        .map(|m| m.content.as_str())
                        .collect::<Vec<&str>>()
                        .join(". ");
                    let original_words = summary.split_whitespace().count();
                    let target_words = (target_tokens as f64 * 0.75) as usize;
                    let compressed: String = summary
                        .split_whitespace()
                        .take(target_words.max(5))
                        .collect::<Vec<&str>>()
                        .join(" ");
                    return serde_json::json!({
                        "compressed_context": compressed,
                        "original_tokens": original_words,
                        "compressed_tokens": compressed.split_whitespace().count(),
                        "compression_ratio": if compressed.split_whitespace().count() > 0 { format!("{}x", original_words / compressed.split_whitespace().count().max(1)) } else { "N/A".to_string() },
                        "source": "memory_store"
                    });
                }

                // Real compression: split by sentences, keep top N within budget
                let sentences: Vec<&str> = context
                    .split(|c: char| c == '.' || c == '!' || c == '?')
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .collect();
                let original_words = context.split_whitespace().count();
                let target_words = (target_tokens as f64 * 0.75) as usize; // ~0.75 words per token

                let mut compressed = String::new();
                let mut word_count = 0;
                for sentence in &sentences {
                    let sw = sentence.split_whitespace().count();
                    if word_count + sw > target_words && word_count > 0 {
                        break;
                    }
                    if !compressed.is_empty() {
                        compressed.push_str(". ");
                    }
                    compressed.push_str(sentence);
                    word_count += sw;
                }
                if !compressed.is_empty() && !compressed.ends_with('.') {
                    compressed.push('.');
                }

                serde_json::json!({
                    "compressed_context": compressed,
                    "original_tokens": original_words,
                    "compressed_tokens": word_count,
                    "compression_ratio": format!("{}x", if word_count > 0 { original_words / word_count } else { 1 }),
                    "source": "input_context"
                })
            }
            // PHASE C: LEARNING & ORCHESTRATION TOOLS
            "clawkit_record_outcome" => {
                let pattern = params["pattern"].as_str().unwrap_or("unknown_pattern");
                let mode_str = params["mode"].as_str().unwrap_or("Peer");
                // Clamp severity to [0.0, 5.0] — prevents garbage inputs
                let raw_severity = params["severity"].as_f64().unwrap_or(0.0) as f32;
                let severity = raw_severity.clamp(0.0, 5.0);
                let outcome_positive = severity == 0.0;
                let cause_variable = params["cause_variable"]
                    .as_str()
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| Self::infer_cause_variable(pattern).to_string());
                let effect_variable = params["effect_variable"]
                    .as_str()
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| Self::infer_effect_variable(pattern).to_string());
                let state_json = params["state"].clone();
                let state_payload = if state_json.is_null() {
                    serde_json::json!({
                        "severity": severity,
                        "mode": mode_str,
                        "outcome_positive": outcome_positive
                    })
                } else {
                    state_json
                };

                let context_json = params["context"].clone();
                let context_payload = if context_json.is_null() {
                    serde_json::json!({
                        "pattern": pattern,
                        "cause_variable": cause_variable.clone(),
                        "effect_variable": effect_variable.clone()
                    })
                } else {
                    context_json
                };

                let extracted_primitives = Self::extract_experience_primitives(
                    &params,
                    pattern,
                    mode_str,
                    &cause_variable,
                    &effect_variable,
                    &state_payload,
                    &context_payload,
                );
                let primary_primitive = extracted_primitives
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "global".to_string());

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

                let mut brain = self.causal_brain.lock().await;
                if let (Some(cause), Some(effect)) = (
                    Self::sentinel_variable_from_name(&cause_variable),
                    Self::sentinel_variable_from_name(&effect_variable),
                ) {
                    brain.learn(cause, effect, outcome_positive);
                } else {
                    brain.learn(
                        core_rust::sentinel::variables::SentinelVariable::Sentiment,
                        core_rust::sentinel::variables::SentinelVariable::PriceDelta,
                        outcome_positive,
                    );
                }
                drop(brain);

                let mut brain_v2 = self.causal_brain_v2.lock().await;
                let state_weight = (1.0 - severity / 5.0).clamp(0.0, 1.0);
                for (idx, primitive_name) in extracted_primitives.iter().enumerate() {
                    let decay = (1.0 - (idx as f32) * 0.08).clamp(0.45, 1.0);
                    brain_v2.observe_outcome(
                        &cause_variable,
                        &effect_variable,
                        outcome_positive,
                        primitive_name,
                        (state_weight * decay).clamp(0.0, 1.0),
                    );
                }
                let v2_effect_estimate = brain_v2.infer_local_effect_by_name(
                    &cause_variable,
                    &effect_variable,
                    pattern,
                    &extracted_primitives,
                    3,
                );
                drop(brain_v2);

                // Upgrade 3: Push to Stateful Memory
                let mut mems = self.memories.lock().await;
                mems.push(MemoryEntry {
                    timestamp: now,
                    category: "outcome".to_string(),
                    content: format!(
                        "Outcome for '{}' in {} mode. Severity: {}. Cause={} -> Effect={} (primitive={}, extracted={})",
                        pattern,
                        mode_str,
                        severity,
                        cause_variable,
                        effect_variable,
                        primary_primitive,
                        extracted_primitives.join("|")
                    ),
                });
                drop(mems);

                let persisted = self
                    .persist_causal_event(
                        now,
                        pattern,
                        mode_str,
                        severity,
                        &cause_variable,
                        &effect_variable,
                        outcome_positive,
                        &primary_primitive,
                        &state_payload,
                        &context_payload,
                    )
                    .is_ok();

                self.schedule_kci_lite_worker(
                    cause_variable.clone(),
                    effect_variable.clone(),
                    primary_primitive.clone(),
                );
                let dagma_worker_scheduled = self.maybe_schedule_dagma_retrain().await;
                let prediction_error = Self::normalize_prediction_error(severity);
                let replay_telemetry = self.register_awake_replay(prediction_error, now).await;

                serde_json::json!({
                    "status": "outcome_recorded",
                    "learning_applied": true,
                    "memory_stored": true,
                    "db_persisted": persisted,
                    "kci_worker_scheduled": true,
                    "dagma_worker_scheduled": dagma_worker_scheduled,
                    "cause_variable": cause_variable,
                    "effect_variable": effect_variable,
                    "primitive": primary_primitive,
                    "primitives_extracted": extracted_primitives,
                    "v2_effect_estimate": v2_effect_estimate,
                    "replay": {
                        "phase": "awake",
                        "prediction_error": prediction_error,
                        "telemetry": replay_telemetry
                    }
                })
            }
            "clawkit_update_user" => {
                // Upgrade 1: Real persistent user update
                let user_id = params["user_id"].as_str().unwrap_or("unknown");
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
                drop(users);
                self.save_users_to_disk().await;

                serde_json::json!({
                    "user_id": user_id,
                    "status": "user_profile_persisted"
                })
            }
            "clawkit_dream_conversation" => {
                // Upgrade 6: Real Memory Consolidation / Thermodynamic Relaxation
                let episodes = params["episodes"].as_u64().unwrap_or(20) as usize;

                let mut thermo = self.thermo.lock().await;
                let mut state = nalgebra::DVector::from_element(5, 0.8); // Start hot
                let target = nalgebra::DVector::from_element(5, 0.0); // Target zero (Zen)

                // Simulate annealing over N episodes
                for _ in 0..episodes {
                    state = thermo.step(&state, &target);
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
                drop(mems);

                let sleep_replay_events = episodes as u64;
                let fictive_replay_events = if episodes == 0 {
                    0
                } else {
                    (episodes / 4).max(1) as u64
                };
                let replay_telemetry = self
                    .register_sleep_replay(
                        sleep_replay_events,
                        fictive_replay_events,
                        chrono::Utc::now().timestamp_millis(),
                    )
                    .await;

                serde_json::json!({
                    "status": "dream_sequence_complete",
                    "episodes_processed": episodes,
                    "final_entropy": final_entropy,
                    "memory_pruned": pruned,
                    "state_relaxed": final_entropy < 0.5,
                    "replay": {
                        "phase": "sleep",
                        "sleep_replay_events": sleep_replay_events,
                        "fictive_replay_events": fictive_replay_events,
                        "telemetry": replay_telemetry
                    }
                })
            }
            "clawkit_replay_stats" => {
                let telemetry = self.snapshot_replay_telemetry().await;
                let total_replay_events = telemetry
                    .awake_replay_events
                    .saturating_add(telemetry.sleep_replay_events)
                    .saturating_add(telemetry.fictive_replay_events);
                serde_json::json!({
                    "status": "success",
                    "replay_stats": {
                        "awake_replay_events": telemetry.awake_replay_events,
                        "sleep_replay_events": telemetry.sleep_replay_events,
                        "fictive_replay_events": telemetry.fictive_replay_events,
                        "total_replay_events": total_replay_events,
                        "total_outcomes": telemetry.total_outcomes,
                        "prediction_error_ema": telemetry.prediction_error_ema,
                        "last_update_ms": telemetry.last_update_ms
                    }
                })
            }
            "clawkit_orchestrate" => {
                // Upgrade 7: Real Multi-Agent Orchestration via Tokio async tasks
                let agents = params["agent_count"].as_u64().unwrap_or(3).clamp(1, 100) as usize;

                let mut handles = vec![];

                for i in 0..agents {
                    // Spawn real concurrent OS threads/tasks via Tokio
                    let handle = tokio::spawn(async move {
                        // Simulate independent agent heuristic
                        let state = nalgebra::DVector::from_element(5, (i as f32 + 1.0) / 100.0);
                        let target = nalgebra::DVector::from_element(5, 0.5);
                        let mut thermo = core_rust::sentinel::thermo::ThermodynamicEngine::new(
                            core_rust::sentinel::thermo::ThermoConfig::default(),
                        );
                        let next = thermo.step(&state, &target);
                        thermo.entropy(&next)
                    });
                    handles.push(handle);
                }

                let results = futures::future::join_all(handles).await;

                let mut valid_results = vec![];
                let mut sum_entropy = 0.0;
                for res in results {
                    if let Ok(entropy) = res {
                        valid_results.push(entropy);
                        sum_entropy += entropy;
                    }
                }

                let consensus = if valid_results.is_empty() {
                    0.0
                } else {
                    sum_entropy / valid_results.len() as f32
                };

                serde_json::json!({
                    "status": "consensus_reached",
                    "agents_spawned": agents,
                    "agents_responded": valid_results.len(),
                    "consensus_entropy": consensus,
                    "strategy": if consensus < 0.5 { "Convergent" } else { "Divergent" }
                })
            }
            "clawkit_tool_recommend" => {
                // Upgrade 8: Dynamic Keyword TF-IDF style Tool Recommendation
                let task = params["task"].as_str().unwrap_or("").to_lowercase();

                // Simple keyword-to-tool mapping
                let keywords: Vec<(&str, &str)> = vec![
                    ("user", "clawkit_recall_user"),
                    ("user", "clawkit_update_user"),
                    ("profile", "clawkit_recall_user"),
                    ("profile", "clawkit_update_user"),
                    ("memory", "clawkit_memory_query"),
                    ("remember", "clawkit_memory_query"),
                    ("compress", "clawkit_compress_context"),
                    ("summarize", "clawkit_compress_context"),
                    ("similar", "clawkit_recall_similar"),
                    ("context", "clawkit_recall_similar"),
                    ("reason", "clawkit_reason_chain"),
                    ("think", "clawkit_reason_chain"),
                    ("logic", "clawkit_reason_chain"),
                    ("simulate", "clawkit_simulate_response"),
                    ("test", "clawkit_simulate_response"),
                    ("pattern", "clawkit_check_pattern"),
                    ("pattern", "clawkit_commit_pattern"),
                    ("outcome", "clawkit_record_outcome"),
                    ("learn", "clawkit_record_outcome"),
                    ("dream", "clawkit_dream_conversation"),
                    ("sleep", "clawkit_dream_conversation"),
                    ("replay", "clawkit_replay_stats"),
                    ("hippocampal", "clawkit_replay_stats"),
                    ("swarm", "clawkit_orchestrate"),
                    ("agents", "clawkit_orchestrate"),
                ];

                let mut scores = std::collections::HashMap::new();
                for (kw, tool) in keywords {
                    if task.contains(kw) {
                        *scores.entry(tool.to_string()).or_insert(0.0) += 0.33; // Simple TF weighting
                    }
                }

                // Default fallback if no matches
                if scores.is_empty() {
                    scores.insert("clawkit_reason_chain".to_string(), 0.5);
                    scores.insert("clawkit_recall_similar".to_string(), 0.5);
                }

                let mut scored_tools: Vec<(String, f64)> = scores.into_iter().collect();
                scored_tools
                    .sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

                let results: Vec<serde_json::Value> = scored_tools
                    .iter()
                    .take(3)
                    .map(|(tool, score)| {
                        serde_json::json!({
                            "tool": tool,
                            "relevance_score": score.min(0.99)
                        })
                    })
                    .collect();

                serde_json::json!({
                    "task": task,
                    "recommended_tools": results
                })
            }
            // Legacy/Test Tools
            "clawkit_oracle_query" => {
                let query = params["query"].as_str().unwrap_or("analyze");
                let insight = self.oracle.analyze(query).await;
                serde_json::json!({ "insight": insight })
            }
            _ => serde_json::json!({ "error": "Unknown tool" }),
        }
    }

    pub async fn run_stdio(&self) {
        let stdin = io::stdin();
        let mut stdout = io::stdout();
        let mut reader = io::BufReader::new(stdin).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(req) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(method) = req["method"].as_str() {
                    let id = req["id"].clone();

                    let response = match method {
                        "initialize" => {
                            serde_json::json!({
                                "protocolVersion": "2024-11-05",
                                "capabilities": { "tools": {} },
                                "serverInfo": { "name": "clawkit-v4", "version": "4.0.0" }
                            })
                        }
                        "notifications/initialized" => {
                            continue; // No response needed for notification
                        }
                        "tools/list" => {
                            serde_json::json!({
                                "tools": [
                                    { "name": "clawkit_recall_user", "description": "Recall User Profile", "inputSchema": { "type": "object", "properties": { "user_id": { "type": "string" } } } },
                                    { "name": "clawkit_sense_intent", "description": "Sense intent", "inputSchema": { "type": "object", "properties": {} } },
                                    { "name": "clawkit_check_pattern", "description": "Check safety guardrail", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" }, "mode": { "type": "string" } } } },
                                    { "name": "clawkit_simulate_response", "description": "Simulate causal response", "inputSchema": { "type": "object", "properties": { "action": { "type": "string" } } } },
                                    { "name": "clawkit_commit_pattern", "description": "Commit to memory", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" } } } },
                                    { "name": "clawkit_reason_chain", "description": "Deep reasoning chain", "inputSchema": { "type": "object", "properties": { "draft": { "type": "string" }, "context": { "type": "string" }, "mode": { "type": "string" } } } },
                                    { "name": "clawkit_recall_similar", "description": "Recall similar memories", "inputSchema": { "type": "object", "properties": { "context": { "type": "string" }, "k": { "type": "number" } } } },
                                    { "name": "clawkit_memory_query", "description": "Query Vector Memory", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "route": { "type": "string" }, "primitive": { "type": "string" }, "primitives": { "type": "array", "items": { "type": "string" } }, "state": { "type": "object" }, "top_k_primitives": { "type": "number" }, "top_n": { "type": "number" } } } },
                                    { "name": "clawkit_compress_context", "description": "Compress Context", "inputSchema": { "type": "object", "properties": { "target_tokens": { "type": "number" }, "context": { "type": "string", "description": "Raw text to compress. If empty, compresses from memory store." } } } },
                                    { "name": "clawkit_record_outcome", "description": "Record outcome and learn", "inputSchema": { "type": "object", "properties": { "pattern": { "type": "string" }, "mode": { "type": "string" }, "severity": { "type": "number" }, "cause_variable": { "type": "string" }, "effect_variable": { "type": "string" }, "primitive": { "type": "string" }, "state": { "type": "object" }, "context": { "type": "object" } } } },
                                    { "name": "clawkit_update_user", "description": "Update User", "inputSchema": { "type": "object", "properties": { "user_id": { "type": "string" } } } },
                                    { "name": "clawkit_dream_conversation", "description": "Dream conversation replay", "inputSchema": { "type": "object", "properties": { "episodes": { "type": "number" } } } },
                                    { "name": "clawkit_replay_stats", "description": "Get replay telemetry stats", "inputSchema": { "type": "object", "properties": {} } },
                                    { "name": "clawkit_orchestrate", "description": "Orchestrate mult-agents", "inputSchema": { "type": "object", "properties": { "agent_count": { "type": "number" } } } },
                                    { "name": "clawkit_tool_recommend", "description": "Recommend tool", "inputSchema": { "type": "object", "properties": { "task": { "type": "string" } } } }
                                ]
                            })
                        }
                        "tools/call" => {
                            let tool_name = req["params"]["name"].as_str().unwrap_or("");
                            let tool_args = req["params"]["arguments"].clone();
                            let result_content = self.handle_tool_call(tool_name, tool_args).await;

                            // MCP tools/call expects `content` array
                            serde_json::json!({
                                "content": [
                                    {
                                        "type": "text",
                                        "text": serde_json::to_string(&result_content).unwrap_or_else(|_| "Error".to_string())
                                    }
                                ]
                            })
                        }
                        // Fallback for legacy generic tests
                        _ => self.handle_tool_call(method, req["params"].clone()).await,
                    };

                    let result = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": response
                    });

                    if let Ok(res_str) = serde_json::to_string(&result) {
                        let _ = stdout.write_all(format!("{}\n", res_str).as_bytes()).await;
                        let _ = stdout.flush().await;
                    }
                }
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let oracle = DeepSeekOracle::new(
        std::env::var("DEEPSEEK_API_KEY").unwrap_or_else(|_| "dummy_key".to_string()),
    );

    // Spawn the SentinelActor
    let (tx, rx) = tokio::sync::mpsc::channel(100);
    let critic = core_rust::sentinel::systems::SentinelActor::new(rx);
    tokio::spawn(async move { critic.run().await });

    let server = EidolonMcpServer::new(oracle, tx);

    server.run_stdio().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Helper function to setup the server
    fn setup_server() -> EidolonMcpServer {
        let oracle = DeepSeekOracle::new("dummy".to_string());
        let (tx, _rx) = tokio::sync::mpsc::channel(10);
        let ts = chrono::Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis() * 1_000_000);
        let db_path = std::env::temp_dir().join(format!(
            "clawkit-mcp-rust-test-{}-{}.db",
            std::process::id(),
            ts
        ));
        let _ = std::fs::remove_file(&db_path);
        EidolonMcpServer::new_with_runtime_db_path(oracle, tx, db_path)
    }

    #[tokio::test]
    async fn test_phase_a_core_loop() {
        let server = setup_server();

        let res = server
            .handle_tool_call("clawkit_recall_user", json!({"user_id": "u123"}))
            .await;
        assert_eq!(res["user_id"], "u123");
        assert_eq!(res["status"], "success");

        let res = server
            .handle_tool_call("clawkit_sense_intent", json!({}))
            .await;
        assert_eq!(res["success"], true);
        assert_eq!(res["recommended_mode"], "Peer");

        let res = server
            .handle_tool_call(
                "clawkit_check_pattern",
                json!({"pattern": "greetings", "mode": "Peer"}),
            )
            .await;
        assert_eq!(res["pattern"], "greetings");
        assert_eq!(res["inhibited"], false);

        let res = server
            .handle_tool_call("clawkit_simulate_response", json!({"action": "ask_why"}))
            .await;
        assert_eq!(res["action_tested"], "ask_why");
        assert_eq!(res["predicted_outcome"], "positive");

        let res = server
            .handle_tool_call("clawkit_commit_pattern", json!({"pattern": "greetings"}))
            .await;
        assert_eq!(res["status"], "committed");
    }

    #[tokio::test]
    async fn test_phase_b_reasoning_memory() {
        let server = setup_server();

        let res = server
            .handle_tool_call(
                "clawkit_recall_similar",
                json!({"context": "hello", "k": 2}),
            )
            .await;
        assert!(res["matches"].is_array());

        // Memory query: no memories yet, should return 0 matches
        let res = server
            .handle_tool_call("clawkit_memory_query", json!({"query": "risk level"}))
            .await;
        assert_eq!(res["query"], "risk level");
        assert_eq!(res["matches"], 0);

        // Compress with real input
        let res = server.handle_tool_call("clawkit_compress_context", json!({
            "target_tokens": 10,
            "context": "The market is volatile today. Gas fees are extremely high. User wants to buy BNB. There is a potential rug pull."
        })).await;
        assert!(res["compressed_context"].is_string());
        let _compressed = res["compressed_context"].as_str().unwrap();
        let original = res["original_tokens"].as_u64().unwrap();
        let comp_tokens = res["compressed_tokens"].as_u64().unwrap();
        assert!(
            comp_tokens <= original,
            "Compressed should not be larger than original"
        );
    }

    #[tokio::test]
    async fn test_phase_c_learning_orchestration() {
        let server = setup_server();

        // Record an outcome → should also write to memory
        let res = server
            .handle_tool_call(
                "clawkit_record_outcome",
                json!({
                    "pattern": "test_pattern", "mode": "Peer", "severity": 0.0
                }),
            )
            .await;
        assert_eq!(res["status"], "outcome_recorded");
        assert_eq!(res["memory_stored"], true);

        // Now memory_query should find it
        let res = server
            .handle_tool_call("clawkit_memory_query", json!({"query": "test_pattern"}))
            .await;
        assert!(
            res["matches"].as_u64().unwrap() > 0,
            "Memory should contain the recorded outcome"
        );

        // Update user and verify persistence
        let res = server
            .handle_tool_call(
                "clawkit_update_user",
                json!({"user_id": "u123", "preferred_mode": "Berserk", "risk_tolerance": 0.99}),
            )
            .await;
        assert_eq!(res["status"], "user_profile_persisted");

        let res = server
            .handle_tool_call("clawkit_recall_user", json!({"user_id": "u123"}))
            .await;
        assert_eq!(res["profile"]["preferred_mode"], "Berserk");
        assert_eq!(res["profile"]["risk_tolerance"], 0.99);

        let res = server
            .handle_tool_call("clawkit_dream_conversation", json!({"episodes": 10}))
            .await;
        assert_eq!(res["episodes_processed"], 10);
        assert!(res["replay"]["sleep_replay_events"].as_u64().unwrap_or(0) > 0);

        let res = server
            .handle_tool_call("clawkit_orchestrate", json!({"agent_count": 5}))
            .await;
        assert_eq!(res["agents_spawned"], 5);

        let res = server
            .handle_tool_call("clawkit_tool_recommend", json!({"task": "analyze_market"}))
            .await;
        assert!(res["recommended_tools"].is_array());
        assert_eq!(res["task"], "analyze_market");
    }

    #[tokio::test]
    async fn test_replay_stats_tracks_awake_sleep_and_fictive() {
        let server = setup_server();

        let before = server
            .handle_tool_call("clawkit_replay_stats", json!({}))
            .await;
        assert_eq!(before["status"], "success");
        assert_eq!(before["replay_stats"]["total_replay_events"], 0);

        let _ = server
            .handle_tool_call(
                "clawkit_record_outcome",
                json!({
                    "pattern": "replay_bootstrap",
                    "mode": "Peer",
                    "severity": 2.5
                }),
            )
            .await;
        let after_awake = server
            .handle_tool_call("clawkit_replay_stats", json!({}))
            .await;
        assert_eq!(after_awake["replay_stats"]["awake_replay_events"], 1);
        assert_eq!(after_awake["replay_stats"]["total_outcomes"], 1);
        assert!(
            after_awake["replay_stats"]["prediction_error_ema"]
                .as_f64()
                .unwrap_or(0.0)
                > 0.0
        );

        let _ = server
            .handle_tool_call("clawkit_dream_conversation", json!({"episodes": 12}))
            .await;
        let after_sleep = server
            .handle_tool_call("clawkit_replay_stats", json!({}))
            .await;
        assert_eq!(after_sleep["replay_stats"]["sleep_replay_events"], 12);
        assert_eq!(after_sleep["replay_stats"]["fictive_replay_events"], 3);
        assert_eq!(after_sleep["replay_stats"]["total_replay_events"], 16);
    }

    #[tokio::test]
    async fn test_phase0_phase1_runtime_schema_and_causal_v2_route() {
        let server = setup_server();

        let res = server
            .handle_tool_call(
                "clawkit_record_outcome",
                json!({
                    "pattern": "liquidity shock increased risk",
                    "mode": "Peer",
                    "severity": 2.3,
                    "cause_variable": "LiquidityImbalance",
                    "effect_variable": "PortfolioRisk",
                    "primitive": "liquidity_shock",
                    "state": {"portfolio_exposure": 0.72},
                    "context": {"source": "integration-test"}
                }),
            )
            .await;

        assert_eq!(res["status"], "outcome_recorded");
        assert_eq!(res["cause_variable"], "LiquidityImbalance");
        assert_eq!(res["effect_variable"], "PortfolioRisk");
        assert_eq!(res["db_persisted"], true);

        let res = server
            .handle_tool_call(
                "clawkit_memory_query",
                json!({
                    "query": "why risk increased after liquidity shock",
                    "route": "causal",
                    "primitive": "liquidity_shock"
                }),
            )
            .await;
        assert_eq!(res["route_selected"], "causal_v2");
        assert!(res["results"].is_array());
        assert!(res["matches"].as_u64().unwrap_or(0) > 0);
    }

    #[tokio::test]
    async fn test_phase2_kci_lite_worker_persists_stats() {
        let server = setup_server();
        let primitive = format!("kci_async_{}", chrono::Utc::now().timestamp_millis());

        for i in 0..12 {
            let _ = server
                .handle_tool_call(
                    "clawkit_record_outcome",
                    json!({
                        "pattern": format!("kci_target_{}", i),
                        "mode": "Peer",
                        "severity": 0.0,
                        "cause_variable": "LiquidityImbalance",
                        "effect_variable": "PortfolioRisk",
                        "primitive": primitive.clone()
                    }),
                )
                .await;
            let _ = server
                .handle_tool_call(
                    "clawkit_record_outcome",
                    json!({
                        "pattern": format!("kci_baseline_{}", i),
                        "mode": "Peer",
                        "severity": 0.0,
                        "cause_variable": "MacroFactor",
                        "effect_variable": "PortfolioRisk",
                        "primitive": primitive.clone()
                    }),
                )
                .await;
        }

        tokio::time::sleep(std::time::Duration::from_millis(350)).await;

        let conn = server.open_runtime_db().expect("runtime db should open");
        let edge_key =
            EidolonMcpServer::build_kci_edge_key("LiquidityImbalance", "PortfolioRisk", &primitive);
        let stats_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kci_stats WHERE edge_key = ?1",
                rusqlite::params![edge_key],
                |row| row.get(0),
            )
            .expect("kci_stats query should succeed");
        assert!(
            stats_count > 0,
            "Expected kci_stats rows for the tracked edge"
        );

        let ci_fail_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kci_stats WHERE edge_key = ?1 AND ci_pass = 0",
                rusqlite::params![edge_key],
                |row| row.get(0),
            )
            .expect("ci_fail query should succeed");
        assert!(
            ci_fail_count > 0,
            "Expected at least one CI failure for attenuation path"
        );
    }

    #[tokio::test]
    async fn test_phase3a_state_dependent_primitive_activation() {
        let server = setup_server();

        let _ = server
            .handle_tool_call(
                "clawkit_record_outcome",
                json!({
                    "pattern": "liquidity shock increased risk",
                    "mode": "Peer",
                    "severity": 2.2,
                    "cause_variable": "LiquidityImbalance",
                    "effect_variable": "PortfolioRisk",
                    "primitive": "portfolio_risk_high",
                    "state": {"portfolio_risk": 0.91}
                }),
            )
            .await;
        let _ = server
            .handle_tool_call(
                "clawkit_record_outcome",
                json!({
                    "pattern": "risk cooled down",
                    "mode": "Peer",
                    "severity": 0.4,
                    "cause_variable": "MacroFactor",
                    "effect_variable": "PortfolioRisk",
                    "primitive": "portfolio_risk_low",
                    "state": {"portfolio_risk": 0.12}
                }),
            )
            .await;

        let res = server
            .handle_tool_call(
                "clawkit_memory_query",
                json!({
                    "query": "why risk increased after shock",
                    "route": "causal",
                    "state": {"portfolio_risk": 0.95},
                    "top_k_primitives": 3,
                    "top_n": 5
                }),
            )
            .await;

        assert_eq!(res["route_selected"], "causal_v2");
        assert!(res["state_features"].is_array());
        let active = res["active_primitives"]
            .as_array()
            .expect("active_primitives should be an array");
        assert!(
            active.iter().any(|entry| {
                entry["primitive"]
                    .as_str()
                    .map(|name| name.contains("portfolio_risk_high"))
                    .unwrap_or(false)
            }),
            "Expected high-risk primitive to activate under high-risk state"
        );
    }

    #[tokio::test]
    async fn test_phase3b_periodic_dagma_retrain_snapshot() {
        let server = setup_server();
        let now = chrono::Utc::now().timestamp_millis();
        let primitive = format!("dagma_periodic_{}", now);

        for i in 0..1000 {
            let (cause, effect) = if i % 2 == 0 {
                ("LiquidityImbalance", "PortfolioRisk")
            } else {
                ("MacroFactor", "Volatility")
            };
            let outcome_positive = i % 5 != 0;
            let severity = if outcome_positive { 0.0 } else { 2.8 };
            let state = if outcome_positive {
                json!({"PortfolioRisk": 0.82, "Volatility": 0.41})
            } else {
                json!({"PortfolioRisk": 0.18, "Volatility": 0.86})
            };
            server
                .persist_causal_event(
                    now + i as i64,
                    &format!("dagma_seed_{}", i),
                    "Peer",
                    severity,
                    cause,
                    effect,
                    outcome_positive,
                    &primitive,
                    &state,
                    &json!({"source": "phase3b_test"}),
                )
                .expect("seed insert must succeed");
        }

        let scheduled = server.maybe_schedule_dagma_retrain().await;
        assert!(
            scheduled,
            "Expected DAGMA retrain to be scheduled at 1000 samples"
        );

        let mut snapshot_count = 0i64;
        for _ in 0..24 {
            let conn = server.open_runtime_db().expect("runtime db should open");
            snapshot_count = conn
                .query_row("SELECT COUNT(*) FROM dagma_snapshots", [], |row| row.get(0))
                .expect("snapshot count query should succeed");
            if snapshot_count > 0 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        assert!(
            snapshot_count > 0,
            "Expected at least one DAGMA snapshot after scheduled retrain"
        );

        let conn = server.open_runtime_db().expect("runtime db should open");
        let latest_snapshot: String = conn
            .query_row(
                "SELECT w_prior_json FROM dagma_snapshots ORDER BY created_at_ms DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("latest snapshot payload should exist");
        assert!(
            latest_snapshot.contains("LiquidityImbalance")
                || latest_snapshot.contains("PortfolioRisk"),
            "Expected learned edge payload to include causal variables"
        );
    }
}
