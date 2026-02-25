// db.rs — SQLite persistence layer for telemetry, audit, and tool metrics.
//
// Uses impl-block extension pattern: EidolonMcpServer methods live here
// but the struct definition remains in main.rs.
// All functions are stateless (take `path: &Path`) for testability.

use crate::helpers::clamp01;
use crate::types::*;
use crate::EidolonMcpServer;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;

impl EidolonMcpServer {
    pub(crate) fn ensure_telemetry_storage_sync(path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS tool_performance (
                tenant_id TEXT NOT NULL DEFAULT 'default',
                tool_name TEXT NOT NULL,
                call_count INTEGER NOT NULL,
                error_count INTEGER NOT NULL DEFAULT 0,
                fallback_count INTEGER NOT NULL DEFAULT 0,
                success_rate REAL NOT NULL,
                avg_latency_ms REAL NOT NULL,
                avg_latency_us REAL NOT NULL DEFAULT 0,
                latency_p50_ms REAL NOT NULL DEFAULT 0,
                latency_p90_ms REAL NOT NULL DEFAULT 0,
                latency_p95_ms REAL NOT NULL DEFAULT 0,
                latency_p99_ms REAL NOT NULL DEFAULT 0,
                fallback_rate REAL NOT NULL DEFAULT 0,
                user_satisfaction REAL NOT NULL,
                latency_sample_count INTEGER NOT NULL DEFAULT 0,
                last_called INTEGER NOT NULL,
                PRIMARY KEY (tenant_id, tool_name)
            );
            CREATE TABLE IF NOT EXISTS generated_tool_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL DEFAULT 'default',
                tool_name TEXT NOT NULL,
                need TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                metadata TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_generated_tool_audit_created_at
                ON generated_tool_audit(created_at DESC);
            CREATE TRIGGER IF NOT EXISTS trg_generated_tool_audit_immutable_update
                BEFORE UPDATE ON generated_tool_audit
                BEGIN
                    SELECT RAISE(ABORT, 'generated_tool_audit is immutable');
                END;
            CREATE TRIGGER IF NOT EXISTS trg_generated_tool_audit_immutable_delete
                BEFORE DELETE ON generated_tool_audit
                BEGIN
                    SELECT RAISE(ABORT, 'generated_tool_audit is immutable');
                END;
            CREATE TABLE IF NOT EXISTS recommender_shadow_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task TEXT NOT NULL,
                available_tools TEXT NOT NULL,
                primary_model TEXT NOT NULL,
                primary_top_tool TEXT NOT NULL,
                primary_top_score REAL NOT NULL,
                shadow_model TEXT NOT NULL,
                shadow_top_tool TEXT NOT NULL,
                shadow_top_score REAL NOT NULL,
                top1_agreement INTEGER NOT NULL,
                top3_overlap_ratio REAL NOT NULL,
                metadata TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_recommender_shadow_audit_created_at
                ON recommender_shadow_audit(created_at DESC);
            "#,
        )
        .map_err(|err| err.to_string())?;

        let mut existing_columns = HashSet::new();
        let mut stmt = conn
            .prepare("PRAGMA table_info(tool_performance)")
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|err| err.to_string())?;
        for row in rows {
            existing_columns.insert(row.map_err(|err| err.to_string())?);
        }
        drop(stmt);

        let required_columns = [
            ("avg_latency_us", "REAL NOT NULL DEFAULT 0"),
            ("latency_p90_ms", "REAL NOT NULL DEFAULT 0"),
            ("latency_p99_ms", "REAL NOT NULL DEFAULT 0"),
            ("latency_sample_count", "INTEGER NOT NULL DEFAULT 0"),
        ];
        for (name, ddl) in required_columns {
            if !existing_columns.contains(name) {
                conn.execute_batch(&format!(
                    "ALTER TABLE tool_performance ADD COLUMN {} {}",
                    name, ddl
                ))
                .map_err(|err| err.to_string())?;
            }
        }

        if !existing_columns.contains("tenant_id") {
            // Complex Migration for PK change
            conn.execute_batch(
                r#"
                CREATE TABLE tool_performance_v2 (
                    tenant_id TEXT NOT NULL DEFAULT 'default',
                    tool_name TEXT NOT NULL,
                    call_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL DEFAULT 0,
                    fallback_count INTEGER NOT NULL DEFAULT 0,
                    success_rate REAL NOT NULL,
                    avg_latency_ms REAL NOT NULL,
                    avg_latency_us REAL NOT NULL DEFAULT 0,
                    latency_p50_ms REAL NOT NULL DEFAULT 0,
                    latency_p90_ms REAL NOT NULL DEFAULT 0,
                    latency_p95_ms REAL NOT NULL DEFAULT 0,
                    latency_p99_ms REAL NOT NULL DEFAULT 0,
                    fallback_rate REAL NOT NULL DEFAULT 0,
                    user_satisfaction REAL NOT NULL,
                    latency_sample_count INTEGER NOT NULL DEFAULT 0,
                    last_called INTEGER NOT NULL,
                    PRIMARY KEY(tenant_id, tool_name)
                );
                INSERT INTO tool_performance_v2
                SELECT 'default', tool_name, call_count, error_count, fallback_count, success_rate, avg_latency_ms, avg_latency_us, latency_p50_ms, latency_p90_ms, latency_p95_ms, latency_p99_ms, fallback_rate, user_satisfaction, latency_sample_count, last_called FROM tool_performance;
                DROP TABLE tool_performance;
                ALTER TABLE tool_performance_v2 RENAME TO tool_performance;

                ALTER TABLE generated_tool_audit ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
                CREATE INDEX IF NOT EXISTS idx_generated_tool_audit_tenant_id ON generated_tool_audit(tenant_id);
                "#,
            )
            .map_err(|err| err.to_string())?;
        }

        Ok(())
    }

    pub(crate) fn persist_tool_performance_sync(
        path: &Path,
        row: &PersistedToolPerformanceRow,
    ) -> Result<(), String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        conn.execute(
            r#"
            INSERT INTO tool_performance
                (tenant_id, tool_name, call_count, error_count, fallback_count, success_rate, avg_latency_ms, avg_latency_us, latency_p50_ms, latency_p90_ms, latency_p95_ms, latency_p99_ms, fallback_rate, user_satisfaction, latency_sample_count, last_called)
            VALUES
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ON CONFLICT(tenant_id, tool_name) DO UPDATE SET
                call_count = excluded.call_count,
                error_count = excluded.error_count,
                fallback_count = excluded.fallback_count,
                success_rate = excluded.success_rate,
                avg_latency_ms = excluded.avg_latency_ms,
                avg_latency_us = excluded.avg_latency_us,
                latency_p50_ms = excluded.latency_p50_ms,
                latency_p90_ms = excluded.latency_p90_ms,
                latency_p95_ms = excluded.latency_p95_ms,
                latency_p99_ms = excluded.latency_p99_ms,
                fallback_rate = excluded.fallback_rate,
                user_satisfaction = excluded.user_satisfaction,
                latency_sample_count = excluded.latency_sample_count,
                last_called = excluded.last_called
            "#,
            params![
                row.tenant_id,
                row.tool_name,
                row.call_count as i64,
                row.error_count as i64,
                row.fallback_count as i64,
                row.success_rate,
                row.avg_latency_ms,
                row.avg_latency_us,
                row.latency_p50_ms,
                row.latency_p90_ms,
                row.latency_p95_ms,
                row.latency_p99_ms,
                row.fallback_rate,
                row.user_satisfaction,
                row.latency_sample_count as i64,
                row.last_called
            ],
        )
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub(crate) fn persist_generated_tool_audit_sync(
        path: &Path,
        row: &GeneratedToolAuditRow,
    ) -> Result<(), String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        conn.execute(
            r#"
            INSERT INTO generated_tool_audit (tenant_id, tool_name, need, status, reason, metadata, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                row.tenant_id,
                row.tool_name,
                row.need,
                row.status,
                row.reason,
                row.metadata,
                row.created_at
            ],
        )
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub(crate) fn persist_recommender_shadow_audit_sync(
        path: &Path,
        row: &RecommenderShadowAuditRow,
    ) -> Result<(), String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        conn.execute(
            r#"
            INSERT INTO recommender_shadow_audit
                (task, available_tools, primary_model, primary_top_tool, primary_top_score, shadow_model, shadow_top_tool, shadow_top_score, top1_agreement, top3_overlap_ratio, metadata, created_at)
            VALUES
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                row.task,
                row.available_tools,
                row.primary_model,
                row.primary_top_tool,
                row.primary_top_score,
                row.shadow_model,
                row.shadow_top_tool,
                row.shadow_top_score,
                if row.top1_agreement { 1 } else { 0 },
                row.top3_overlap_ratio,
                row.metadata,
                row.created_at
            ],
        )
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub(crate) fn load_tool_metrics_from_db_sync(
        path: &Path,
    ) -> Result<HashMap<String, ToolTelemetry>, String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                    tenant_id,
                    tool_name,
                    call_count,
                    error_count,
                    fallback_count,
                    avg_latency_ms,
                    avg_latency_us,
                    latency_p50_ms,
                    latency_p90_ms,
                    latency_p95_ms,
                    latency_p99_ms,
                    user_satisfaction,
                    latency_sample_count,
                    last_called
                FROM tool_performance
                ORDER BY last_called DESC
                "#,
            )
            .map_err(|err| err.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let tenant_id: String = row.get(0)?;
                let tool_name: String = row.get(1)?;
                let calls: i64 = row.get(2)?;
                let errors: i64 = row.get(3)?;
                let fallback_count: i64 = row.get(4)?;
                let avg_latency_ms: f64 = row.get(5)?;
                let avg_latency_us: f64 = row.get(6)?;
                let latency_p50_ms: f64 = row.get(7)?;
                let latency_p90_ms: f64 = row.get(8)?;
                let latency_p95_ms: f64 = row.get(9)?;
                let latency_p99_ms: f64 = row.get(10)?;
                let user_satisfaction: f64 = row.get(11)?;
                let latency_sample_count: i64 = row.get(12)?;
                let last_called: i64 = row.get(13)?;
                let calls_non_negative = calls.max(0) as u64;
                let total_latency_us = if avg_latency_us > 0.0 {
                    (calls_non_negative as f64 * avg_latency_us).round() as u64
                } else {
                    ((calls_non_negative as f64) * avg_latency_ms * 1000.0).round() as u64
                };

                let metric_key = format!("{}:{}", tenant_id, tool_name);

                Ok((
                    metric_key,
                    ToolTelemetry {
                        calls: calls_non_negative,
                        errors: errors.max(0) as u64,
                        fallback_count: fallback_count.max(0) as u64,
                        total_latency_ms: ((calls_non_negative as f64) * avg_latency_ms).round()
                            as u64,
                        total_latency_us,
                        latency_p50_ms,
                        latency_p90_ms,
                        latency_p95_ms,
                        latency_p99_ms,
                        user_satisfaction: clamp01(user_satisfaction),
                        last_called,
                        latency_sample_count: latency_sample_count.max(0) as u64,
                        latency_samples: VecDeque::with_capacity(MAX_LATENCY_SAMPLES),
                    },
                ))
            })
            .map_err(|err| err.to_string())?;

        let mut out = HashMap::new();
        for row in rows {
            let (metric_key, telemetry) = row.map_err(|err| err.to_string())?;
            out.insert(metric_key, telemetry);
        }
        Ok(out)
    }

    pub(crate) fn load_tool_performance_rows_sync(
        path: &Path,
        limit: usize,
    ) -> Result<Vec<PersistedToolPerformanceRow>, String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let safe_limit = i64::try_from(limit.max(1)).unwrap_or(1000);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                    tenant_id,
                    tool_name,
                    call_count,
                    error_count,
                    fallback_count,
                    success_rate,
                    avg_latency_ms,
                    avg_latency_us,
                    latency_p50_ms,
                    latency_p90_ms,
                    latency_p95_ms,
                    latency_p99_ms,
                    fallback_rate,
                    user_satisfaction,
                    latency_sample_count,
                    last_called
                FROM tool_performance
                ORDER BY last_called DESC
                LIMIT ?1
                "#,
            )
            .map_err(|err| err.to_string())?;

        let rows = stmt
            .query_map([safe_limit], |row| {
                Ok(PersistedToolPerformanceRow {
                    tenant_id: row.get::<_, String>(0)?,
                    tool_name: row.get::<_, String>(1)?,
                    call_count: row.get::<_, i64>(2)?.max(0) as u64,
                    error_count: row.get::<_, i64>(3)?.max(0) as u64,
                    fallback_count: row.get::<_, i64>(4)?.max(0) as u64,
                    success_rate: clamp01(row.get::<_, f64>(5)?),
                    avg_latency_ms: row.get::<_, f64>(6)?,
                    avg_latency_us: row.get::<_, f64>(7)?,
                    latency_p50_ms: row.get::<_, f64>(8)?,
                    latency_p90_ms: row.get::<_, f64>(9)?,
                    latency_p95_ms: row.get::<_, f64>(10)?,
                    latency_p99_ms: row.get::<_, f64>(11)?,
                    fallback_rate: clamp01(row.get::<_, f64>(12)?),
                    user_satisfaction: clamp01(row.get::<_, f64>(13)?),
                    latency_sample_count: row.get::<_, i64>(14)?.max(0) as u64,
                    last_called: row.get::<_, i64>(15)?,
                })
            })
            .map_err(|err| err.to_string())?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|err| err.to_string())?);
        }
        Ok(out)
    }

    pub(crate) fn load_tool_performance_row_sync(
        path: &Path,
        tenant_id: &str,
        tool_name: &str,
    ) -> Result<Option<PersistedToolPerformanceRow>, String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                    tenant_id,
                    tool_name,
                    call_count,
                    error_count,
                    fallback_count,
                    success_rate,
                    avg_latency_ms,
                    avg_latency_us,
                    latency_p50_ms,
                    latency_p90_ms,
                    latency_p95_ms,
                    latency_p99_ms,
                    fallback_rate,
                    user_satisfaction,
                    latency_sample_count,
                    last_called
                FROM tool_performance
                WHERE tenant_id = ?1
                  AND tool_name = ?2
                LIMIT 1
                "#,
            )
            .map_err(|err| err.to_string())?;

        let mut rows = stmt
            .query([tenant_id, tool_name])
            .map_err(|err| err.to_string())?;
        let Some(row) = rows.next().map_err(|err| err.to_string())? else {
            return Ok(None);
        };

        Ok(Some(PersistedToolPerformanceRow {
            tenant_id: row.get::<_, String>(0).map_err(|err| err.to_string())?,
            tool_name: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            call_count: row.get::<_, i64>(2).map_err(|err| err.to_string())?.max(0) as u64,
            error_count: row.get::<_, i64>(3).map_err(|err| err.to_string())?.max(0) as u64,
            fallback_count: row.get::<_, i64>(4).map_err(|err| err.to_string())?.max(0) as u64,
            success_rate: clamp01(row.get::<_, f64>(5).map_err(|err| err.to_string())?),
            avg_latency_ms: row.get::<_, f64>(6).map_err(|err| err.to_string())?,
            avg_latency_us: row.get::<_, f64>(7).map_err(|err| err.to_string())?,
            latency_p50_ms: row.get::<_, f64>(8).map_err(|err| err.to_string())?,
            latency_p90_ms: row.get::<_, f64>(9).map_err(|err| err.to_string())?,
            latency_p95_ms: row.get::<_, f64>(10).map_err(|err| err.to_string())?,
            latency_p99_ms: row.get::<_, f64>(11).map_err(|err| err.to_string())?,
            fallback_rate: clamp01(row.get::<_, f64>(12).map_err(|err| err.to_string())?),
            user_satisfaction: clamp01(row.get::<_, f64>(13).map_err(|err| err.to_string())?),
            latency_sample_count: row.get::<_, i64>(14).map_err(|err| err.to_string())?.max(0)
                as u64,
            last_called: row.get::<_, i64>(15).map_err(|err| err.to_string())?,
        }))
    }

    pub(crate) fn load_tool_generator_active_count_sync(path: &Path) -> Result<u64, String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let count: i64 = conn
            .query_row(
                r#"
                SELECT COUNT(DISTINCT tool_name)
                FROM generated_tool_audit
                WHERE need = 'tool_generator_review'
                  AND status IN ('accepted', 'promoted')
                "#,
                [],
                |row| row.get(0),
            )
            .map_err(|err| err.to_string())?;
        Ok(count.max(0) as u64)
    }

    pub(crate) fn load_generated_tool_audit_rows_sync(
        path: &Path,
        limit: usize,
    ) -> Result<Vec<GeneratedToolAuditRow>, String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let safe_limit = i64::try_from(limit.max(1)).unwrap_or(200);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                    tenant_id,
                    tool_name,
                    need,
                    status,
                    reason,
                    COALESCE(metadata, '{}'),
                    created_at
                FROM generated_tool_audit
                ORDER BY created_at DESC
                LIMIT ?1
                "#,
            )
            .map_err(|err| err.to_string())?;

        let rows = stmt
            .query_map([safe_limit], |row| {
                Ok(GeneratedToolAuditRow {
                    tenant_id: row.get::<_, String>(0)?,
                    tool_name: row.get::<_, String>(1)?,
                    need: row.get::<_, String>(2)?,
                    status: row.get::<_, String>(3)?,
                    reason: row.get::<_, String>(4)?,
                    metadata: row.get::<_, String>(5)?,
                    created_at: row.get::<_, i64>(6)?,
                })
            })
            .map_err(|err| err.to_string())?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|err| err.to_string())?);
        }
        Ok(out)
    }

    pub(crate) fn load_recommender_shadow_rows_sync(
        path: &Path,
        limit: usize,
    ) -> Result<Vec<RecommenderShadowAuditRow>, String> {
        Self::ensure_telemetry_storage_sync(path)?;

        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let safe_limit = i64::try_from(limit.max(1)).unwrap_or(200);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                    task,
                    available_tools,
                    primary_model,
                    primary_top_tool,
                    primary_top_score,
                    shadow_model,
                    shadow_top_tool,
                    shadow_top_score,
                    top1_agreement,
                    top3_overlap_ratio,
                    COALESCE(metadata, '{}'),
                    created_at
                FROM recommender_shadow_audit
                ORDER BY created_at DESC
                LIMIT ?1
                "#,
            )
            .map_err(|err| err.to_string())?;

        let rows = stmt
            .query_map([safe_limit], |row| {
                Ok(RecommenderShadowAuditRow {
                    task: row.get::<_, String>(0)?,
                    available_tools: row.get::<_, String>(1)?,
                    primary_model: row.get::<_, String>(2)?,
                    primary_top_tool: row.get::<_, String>(3)?,
                    primary_top_score: row.get::<_, f64>(4)?,
                    shadow_model: row.get::<_, String>(5)?,
                    shadow_top_tool: row.get::<_, String>(6)?,
                    shadow_top_score: row.get::<_, f64>(7)?,
                    top1_agreement: row.get::<_, i64>(8)? != 0,
                    top3_overlap_ratio: clamp01(row.get::<_, f64>(9)?),
                    metadata: row.get::<_, String>(10)?,
                    created_at: row.get::<_, i64>(11)?,
                })
            })
            .map_err(|err| err.to_string())?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|err| err.to_string())?);
        }
        Ok(out)
    }
}
