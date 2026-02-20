import * as path from 'path';
import { IStorageProvider } from './IStorageProvider';
import { AppendOnlyAdapter } from './AppendOnlyAdapter';
import type {
    GeneratedToolAuditRecord,
    MemoryEntry,
    MemoryNode,
    ReasoningTraceRecord,
    ToolPerformanceRecord,
    UserSensory
} from '../types/CognitiveTypes';

type SqliteRow = Record<string, unknown>;

interface SqliteStatement<Row extends SqliteRow = SqliteRow> {
    run(...params: unknown[]): void;
    get(...params: unknown[]): Row | undefined;
    all(...params: unknown[]): Row[];
}

interface SqliteDatabase {
    pragma(statement: string): void;
    exec(statement: string): void;
    prepare<Row extends SqliteRow = SqliteRow>(sql: string): SqliteStatement<Row>;
    close(): void;
}

type SqliteDatabaseConstructor = new (path: string) => SqliteDatabase;

/**
 * SQLite-backed storage provider for high-frequency learning writes.
 * Uses better-sqlite3 when available, otherwise falls back to AppendOnlyAdapter.
 */
export class SQLiteLearningStore implements IStorageProvider {
    private static signalHandlersRegistered = false; // FIX: prevent duplicate handler registration
    private static readonly TOOL_PERFORMANCE_LOG_KEY = 'tool_performance.log';
    private static readonly GENERATED_TOOL_AUDIT_LOG_KEY = 'generated_tool_audit.log';
    private db: SqliteDatabase | null = null;
    private readonly dbPath: string;
    private readonly fallback: AppendOnlyAdapter;
    private readonly allowFallback: boolean;
    private readonly databaseClass?: SqliteDatabaseConstructor;

    constructor(config: { dbPath?: string; fallbackDir?: string; allowFallback?: boolean; databaseClass?: SqliteDatabaseConstructor } = {}) {
        this.dbPath = config.dbPath || path.join(process.cwd(), 'data', 'memory', 'eidolon_learning.db');
        this.fallback = new AppendOnlyAdapter({ baseDir: config.fallbackDir });
        this.allowFallback = config.allowFallback !== false;
        this.databaseClass = config.databaseClass;

        // 🛡️ Safety: Ensure WAL is flushed on exit (only register once across all instances)
        if (!SQLiteLearningStore.signalHandlersRegistered) {
            SQLiteLearningStore.signalHandlersRegistered = true;
            process.on('exit', () => this.close());
            process.on('SIGINT', () => { this.close(); process.exit(0); });
            process.on('SIGTERM', () => { this.close(); process.exit(0); });
        }
    }

    async init(): Promise<void> {
        try {
            // Use injected class or dynamic import to avoid hard require in linted TS.
            const Database = this.databaseClass || (await import('better-sqlite3')).default as unknown as SqliteDatabaseConstructor;
            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('secure_delete = ON'); // FIX: Overwrite deleted data with zeros
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS kv_store (
                    k TEXT PRIMARY KEY,
                    v TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS append_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    k TEXT NOT NULL,
                    ts INTEGER NOT NULL,
                    v TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_append_logs_k_id ON append_logs(k, id);
                CREATE TABLE IF NOT EXISTS user_profiles (
                    user_id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memory_entries (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    embedding TEXT NOT NULL,
                    stability REAL NOT NULL,
                    last_accessed INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    importance REAL NOT NULL,
                    tags TEXT,
                    source TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_memory_entries_last_accessed ON memory_entries(last_accessed);
                CREATE TABLE IF NOT EXISTS semantic_nodes (
                    id TEXT PRIMARY KEY,
                    concept TEXT NOT NULL,
                    embedding TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS semantic_edges (
                    from_id TEXT NOT NULL,
                    to_id TEXT NOT NULL,
                    relation TEXT NOT NULL,
                    weight REAL NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (from_id, to_id, relation)
                );
                CREATE INDEX IF NOT EXISTS idx_semantic_edges_from ON semantic_edges(from_id);
                CREATE TABLE IF NOT EXISTS tool_performance (
                    tool_name TEXT PRIMARY KEY,
                    call_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL DEFAULT 0,
                    fallback_count INTEGER NOT NULL DEFAULT 0,
                    success_rate REAL NOT NULL,
                    avg_latency_ms REAL NOT NULL,
                    latency_p50_ms REAL NOT NULL DEFAULT 0,
                    latency_p95_ms REAL NOT NULL DEFAULT 0,
                    fallback_rate REAL NOT NULL DEFAULT 0,
                    user_satisfaction REAL NOT NULL,
                    last_called INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS reasoning_traces (
                    id TEXT PRIMARY KEY,
                    created_at INTEGER NOT NULL,
                    mode TEXT NOT NULL,
                    final_score REAL NOT NULL,
                    iterations INTEGER NOT NULL,
                    trace TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS generated_tool_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tool_name TEXT NOT NULL,
                    need TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    metadata TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_generated_tool_audit_created_at ON generated_tool_audit(created_at DESC);
            `);
            this.ensureTelemetrySchema();
        } catch (err) {
            if (!this.allowFallback) throw err;
            this.db = null;
            await this.fallback.init();
            console.warn('⚠️ SQLiteLearningStore unavailable, falling back to AppendOnlyAdapter');
        }
    }

    async save<T = unknown>(key: string, data: T): Promise<void> {
        if (!this.db) return this.fallback.save(key, data);
        const stmt = this.db.prepare(`
            INSERT INTO kv_store (k, v, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at
        `);
        stmt.run(key, JSON.stringify(data), Date.now());
    }

    async load<T>(key: string): Promise<T | null> {
        if (!this.db) return this.fallback.load<T>(key);
        const stmt = this.db.prepare<{ v: string }>('SELECT v FROM kv_store WHERE k = ?');
        const row = stmt.get(key) as { v: string } | undefined;
        if (!row) return null;
        try {
            return JSON.parse(row.v) as T;
        } catch {
            return null;
        }
    }

    async list(): Promise<string[]> {
        if (!this.db) return this.fallback.list();
        const rows = this.db.prepare<{ k: string }>('SELECT k FROM kv_store').all();
        return rows.map((r) => String(r.k));
    }

    async append<T = unknown>(key: string, data: T): Promise<void> {
        if (!this.db) return this.fallback.append(key, data);
        const stmt = this.db.prepare('INSERT INTO append_logs (k, ts, v) VALUES (?, ?, ?)');
        stmt.run(key, Date.now(), JSON.stringify(data));
    }

    async readLog<T = unknown>(key: string, limit: number = 0, offset: number = 0): Promise<T[]> {
        if (!this.db) return this.fallback.readLog(key, limit, offset);

        // Standard: Head (Oldest First)
        let sql = 'SELECT v FROM append_logs WHERE k = ? ORDER BY id ASC';
        const params: unknown[] = [key];

        if (limit > 0 && offset === 0) {
            // Memory Optimization: Only fetch the tail (Latest N)
            // This preserves the original behavior of "limit" meaning "keep last N"
            sql = 'SELECT v FROM append_logs WHERE k = ? ORDER BY id DESC LIMIT ?';
            params.push(limit);
        } else {
            // Standard Pagination (Head-based or skipping from start)
            if (limit > 0) {
                sql += ' LIMIT ?';
                params.push(limit);
            }
            if (offset > 0) {
                sql += ' OFFSET ?';
                params.push(offset);
            }
        }

        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params) as Array<{ v: string }>;

        if (limit > 0 && offset === 0) {
            // We fetched DESC (Tail), so reverse to get ASC
            rows.reverse();
        }

        const out: T[] = [];
        for (const row of rows) {
            try {
                out.push(JSON.parse(row.v) as T);
            } catch {
                // skip corrupted entry
            }
        }
        return out;
    }

    async saveUserProfile(profile: UserSensory): Promise<void> {
        if (!this.db) {
            return this.fallback.save(`user_profile_${profile.user_id}.json`, profile);
        }
        const stmt = this.db.prepare(`
            INSERT INTO user_profiles (user_id, data, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
        `);
        stmt.run(profile.user_id, JSON.stringify(profile), Date.now());
    }

    async loadUserProfile(userId: string): Promise<UserSensory | null> {
        if (!this.db) return this.fallback.load<UserSensory>(`user_profile_${userId}.json`);
        const stmt = this.db.prepare<{ data: string }>('SELECT data FROM user_profiles WHERE user_id = ?');
        const row = stmt.get(userId);
        if (!row) return null;
        try {
            return JSON.parse(row.data) as UserSensory;
        } catch {
            return null;
        }
    }

    async upsertMemoryEntry(entry: MemoryEntry): Promise<void> {
        if (!this.db) {
            await this.fallback.save(`memory_entry_${entry.id}.json`, entry);
            return;
        }
        const stmt = this.db.prepare(`
            INSERT INTO memory_entries
                (id, content, embedding, stability, last_accessed, created_at, importance, tags, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                content = excluded.content,
                embedding = excluded.embedding,
                stability = excluded.stability,
                last_accessed = excluded.last_accessed,
                created_at = excluded.created_at,
                importance = excluded.importance,
                tags = excluded.tags,
                source = excluded.source
        `);
        stmt.run(
            entry.id,
            entry.content,
            JSON.stringify(entry.embedding),
            entry.stability,
            entry.last_accessed,
            entry.created_at,
            entry.importance,
            JSON.stringify(entry.tags ?? []),
            entry.source ?? 'unknown'
        );
    }

    async listMemoryEntries(limit = 5000): Promise<MemoryEntry[]> {
        if (!this.db) return [];
        const stmt = this.db.prepare<{
            id: string;
            content: string;
            embedding: string;
            stability: number;
            last_accessed: number;
            created_at: number;
            importance: number;
            tags: string | null;
            source: string | null;
        }>('SELECT * FROM memory_entries ORDER BY last_accessed DESC LIMIT ?');
        const rows = stmt.all(limit);
        return rows.map((row) => ({
            id: row.id,
            content: row.content,
            embedding: this.safeParseArray(row.embedding),
            stability: Number(row.stability),
            last_accessed: Number(row.last_accessed),
            created_at: Number(row.created_at),
            importance: Number(row.importance),
            tags: this.safeParseStringArray(row.tags),
            source: row.source ?? undefined,
        }));
    }

    async deleteMemoryEntries(ids: string[]): Promise<number> {
        if (!this.db || ids.length === 0) return 0;
        const stmt = this.db.prepare('DELETE FROM memory_entries WHERE id = ?');
        let count = 0;
        for (const id of ids) {
            stmt.run(id);
            count++;
        }
        return count;
    }

    async upsertSemanticNode(node: MemoryNode): Promise<void> {
        if (!this.db) return;
        const stmt = this.db.prepare(`
            INSERT INTO semantic_nodes (id, concept, embedding, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                concept = excluded.concept,
                embedding = excluded.embedding,
                updated_at = excluded.updated_at
        `);
        stmt.run(node.id, node.concept, JSON.stringify(node.embedding), node.updated_at ?? Date.now());
    }

    async listSemanticNodes(limit = 1000): Promise<MemoryNode[]> {
        if (!this.db) return [];
        const nodeRows = this.db.prepare<{
            id: string;
            concept: string;
            embedding: string;
            updated_at: number;
        }>('SELECT * FROM semantic_nodes ORDER BY updated_at DESC LIMIT ?').all(limit);
        const edgeRows = this.db.prepare<{
            from_id: string;
            to_id: string;
            relation: string;
            weight: number;
        }>('SELECT from_id, to_id, relation, weight FROM semantic_edges').all();

        const edgesByFrom = new Map<string, Array<{ to: string; relation: string; weight: number }>>();
        for (const edge of edgeRows) {
            const list = edgesByFrom.get(edge.from_id) ?? [];
            list.push({ to: edge.to_id, relation: edge.relation, weight: Number(edge.weight) });
            edgesByFrom.set(edge.from_id, list);
        }

        return nodeRows.map((row) => ({
            id: row.id,
            concept: row.concept,
            embedding: this.safeParseArray(row.embedding),
            updated_at: Number(row.updated_at),
            connections: edgesByFrom.get(row.id) ?? [],
        }));
    }

    async deleteSemanticNode(id: string): Promise<void> {
        if (!this.db) return;
        this.db.prepare('DELETE FROM semantic_edges WHERE from_id = ? OR to_id = ?').run(id, id);
        this.db.prepare('DELETE FROM semantic_nodes WHERE id = ?').run(id);
    }

    async upsertSemanticEdge(fromId: string, toId: string, relation: string, weight: number): Promise<void> {
        if (!this.db) return;
        const stmt = this.db.prepare(`
            INSERT INTO semantic_edges (from_id, to_id, relation, weight, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(from_id, to_id, relation) DO UPDATE SET
                weight = excluded.weight,
                updated_at = excluded.updated_at
        `);
        stmt.run(fromId, toId, relation, weight, Date.now());
    }

    async upsertToolPerformance(record: ToolPerformanceRecord): Promise<void> {
        if (!this.db) {
            await this.fallback.append(SQLiteLearningStore.TOOL_PERFORMANCE_LOG_KEY, record);
            return;
        }
        const stmt = this.db.prepare(`
            INSERT INTO tool_performance
                (tool_name, call_count, error_count, fallback_count, success_rate, avg_latency_ms, latency_p50_ms, latency_p95_ms, fallback_rate, user_satisfaction, last_called)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tool_name) DO UPDATE SET
                call_count = excluded.call_count,
                error_count = excluded.error_count,
                fallback_count = excluded.fallback_count,
                success_rate = excluded.success_rate,
                avg_latency_ms = excluded.avg_latency_ms,
                latency_p50_ms = excluded.latency_p50_ms,
                latency_p95_ms = excluded.latency_p95_ms,
                fallback_rate = excluded.fallback_rate,
                user_satisfaction = excluded.user_satisfaction,
                last_called = excluded.last_called
        `);
        stmt.run(
            record.tool_name,
            record.call_count,
            record.error_count ?? 0,
            record.fallback_count ?? 0,
            record.success_rate,
            record.avg_latency_ms,
            record.latency_p50_ms ?? 0,
            record.latency_p95_ms ?? 0,
            record.fallback_rate ?? 0,
            record.user_satisfaction,
            record.last_called
        );
    }

    async getToolPerformance(toolName: string): Promise<ToolPerformanceRecord | null> {
        if (!this.db) {
            const records = await this.fallback.readLog<unknown>(SQLiteLearningStore.TOOL_PERFORMANCE_LOG_KEY, 10_000);
            for (let i = records.length - 1; i >= 0; i--) {
                const normalized = this.normalizeToolPerformanceRecord(records[i]);
                if (normalized && normalized.tool_name === toolName) {
                    return normalized;
                }
            }
            return null;
        }
        const row = this.db.prepare<{
            tool_name: string;
            call_count: number;
            error_count: number;
            fallback_count: number;
            success_rate: number;
            avg_latency_ms: number;
            latency_p50_ms: number;
            latency_p95_ms: number;
            fallback_rate: number;
            user_satisfaction: number;
            last_called: number;
        }>('SELECT * FROM tool_performance WHERE tool_name = ?').get(toolName);
        if (!row) return null;
        return {
            ...row,
            call_count: Number(row.call_count),
            error_count: Number(row.error_count),
            fallback_count: Number(row.fallback_count),
            success_rate: Number(row.success_rate),
            avg_latency_ms: Number(row.avg_latency_ms),
            latency_p50_ms: Number(row.latency_p50_ms),
            latency_p95_ms: Number(row.latency_p95_ms),
            fallback_rate: Number(row.fallback_rate),
            user_satisfaction: Number(row.user_satisfaction),
            last_called: Number(row.last_called),
        };
    }

    async listToolPerformance(): Promise<ToolPerformanceRecord[]> {
        if (!this.db) {
            const records = await this.fallback.readLog<unknown>(SQLiteLearningStore.TOOL_PERFORMANCE_LOG_KEY, 10_000);
            const latestByTool = new Map<string, ToolPerformanceRecord>();
            for (const record of records) {
                const normalized = this.normalizeToolPerformanceRecord(record);
                if (!normalized) continue;
                const existing = latestByTool.get(normalized.tool_name);
                if (!existing || normalized.last_called >= existing.last_called) {
                    latestByTool.set(normalized.tool_name, normalized);
                }
            }
            return Array.from(latestByTool.values()).sort((a, b) => b.last_called - a.last_called);
        }
        const rows = this.db.prepare<{
            tool_name: string;
            call_count: number;
            error_count: number;
            fallback_count: number;
            success_rate: number;
            avg_latency_ms: number;
            latency_p50_ms: number;
            latency_p95_ms: number;
            fallback_rate: number;
            user_satisfaction: number;
            last_called: number;
        }>('SELECT * FROM tool_performance ORDER BY last_called DESC').all();
        return rows.map((row) => ({
            ...row,
            call_count: Number(row.call_count),
            error_count: Number(row.error_count),
            fallback_count: Number(row.fallback_count),
            success_rate: Number(row.success_rate),
            avg_latency_ms: Number(row.avg_latency_ms),
            latency_p50_ms: Number(row.latency_p50_ms),
            latency_p95_ms: Number(row.latency_p95_ms),
            fallback_rate: Number(row.fallback_rate),
            user_satisfaction: Number(row.user_satisfaction),
            last_called: Number(row.last_called),
        }));
    }

    async appendReasoningTrace(trace: ReasoningTraceRecord): Promise<void> {
        if (!this.db) return this.fallback.append('reasoning_traces.log', trace);
        const stmt = this.db.prepare(`
            INSERT INTO reasoning_traces (id, created_at, mode, final_score, iterations, trace)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                created_at = excluded.created_at,
                mode = excluded.mode,
                final_score = excluded.final_score,
                iterations = excluded.iterations,
                trace = excluded.trace
        `);
        stmt.run(
            trace.id,
            trace.created_at,
            trace.mode,
            trace.final_score,
            trace.iterations,
            JSON.stringify(trace.trace)
        );
    }

    async appendGeneratedToolAudit(record: GeneratedToolAuditRecord): Promise<void> {
        if (!this.db) return this.fallback.append(SQLiteLearningStore.GENERATED_TOOL_AUDIT_LOG_KEY, record);
        const stmt = this.db.prepare(`
            INSERT INTO generated_tool_audit (tool_name, need, status, reason, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            record.tool_name,
            record.need,
            record.status,
            record.reason,
            JSON.stringify(record.metadata ?? {}),
            record.created_at
        );
    }

    async listGeneratedToolAudits(limit = 200): Promise<GeneratedToolAuditRecord[]> {
        if (!this.db) {
            const records = await this.fallback.readLog<unknown>(SQLiteLearningStore.GENERATED_TOOL_AUDIT_LOG_KEY, 10_000);
            const normalized: GeneratedToolAuditRecord[] = [];
            for (const record of records) {
                const parsed = this.normalizeGeneratedToolAuditRecord(record);
                if (parsed) normalized.push(parsed);
            }
            normalized.sort((a, b) => b.created_at - a.created_at);
            return normalized.slice(0, Math.max(0, limit));
        }
        const rows = this.db.prepare<{
            tool_name: string;
            need: string;
            status: string;
            reason: string;
            metadata: string | null;
            created_at: number;
        }>('SELECT tool_name, need, status, reason, metadata, created_at FROM generated_tool_audit ORDER BY created_at DESC LIMIT ?')
            .all(limit);
        return rows.map((row) => ({
            tool_name: row.tool_name,
            need: row.need,
            status: row.status === 'accepted' ? 'accepted' : 'rejected',
            reason: row.reason,
            metadata: this.safeParseObject(row.metadata),
            created_at: Number(row.created_at),
        }));
    }

    private safeParseArray(raw: string): number[] {
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((v) => Number(v)).filter((v) => Number.isFinite(v));
        } catch {
            return [];
        }
    }

    private safeParseStringArray(raw: string | null): string[] {
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((v) => String(v));
        } catch {
            return [];
        }
    }

    private safeParseObject(raw: string | null): Record<string, unknown> | undefined {
        if (!raw) return undefined;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
            return parsed as Record<string, unknown>;
        } catch {
            return undefined;
        }
    }

    private normalizeToolPerformanceRecord(raw: unknown): ToolPerformanceRecord | null {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const record = raw as Partial<ToolPerformanceRecord>;
        if (typeof record.tool_name !== 'string' || !record.tool_name.trim()) return null;
        const numberOr = (value: unknown, fallback: number): number => {
            const num = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(num) ? num : fallback;
        };
        return {
            tool_name: record.tool_name,
            call_count: numberOr(record.call_count, 0),
            error_count: numberOr(record.error_count, 0),
            fallback_count: numberOr(record.fallback_count, 0),
            success_rate: numberOr(record.success_rate, 0),
            avg_latency_ms: numberOr(record.avg_latency_ms, 0),
            latency_p50_ms: numberOr(record.latency_p50_ms, 0),
            latency_p95_ms: numberOr(record.latency_p95_ms, 0),
            fallback_rate: numberOr(record.fallback_rate, 0),
            user_satisfaction: numberOr(record.user_satisfaction, 0),
            last_called: numberOr(record.last_called, 0),
        };
    }

    private normalizeGeneratedToolAuditRecord(raw: unknown): GeneratedToolAuditRecord | null {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const record = raw as Partial<GeneratedToolAuditRecord>;
        if (typeof record.tool_name !== 'string' || !record.tool_name.trim()) return null;
        if (typeof record.need !== 'string') return null;
        if (typeof record.reason !== 'string') return null;
        const status = record.status === 'accepted' ? 'accepted' : (record.status === 'rejected' ? 'rejected' : null);
        if (!status) return null;
        const created = typeof record.created_at === 'number' ? record.created_at : Number(record.created_at);
        return {
            tool_name: record.tool_name,
            need: record.need,
            status,
            reason: record.reason,
            metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
                ? record.metadata as Record<string, unknown>
                : undefined,
            created_at: Number.isFinite(created) ? created : Date.now(),
        };
    }

    private ensureTelemetrySchema(): void {
        if (!this.db) return;
        const requiredColumns: Array<{ column: string; definition: string }> = [
            { column: 'error_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { column: 'fallback_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { column: 'latency_p50_ms', definition: 'REAL NOT NULL DEFAULT 0' },
            { column: 'latency_p95_ms', definition: 'REAL NOT NULL DEFAULT 0' },
            { column: 'fallback_rate', definition: 'REAL NOT NULL DEFAULT 0' },
        ];
        const rows = this.db.prepare<{ name: string }>('PRAGMA table_info(tool_performance)').all();
        const existing = new Set(rows.map((row) => row.name));
        for (const { column, definition } of requiredColumns) {
            if (existing.has(column)) continue;
            this.db.exec(`ALTER TABLE tool_performance ADD COLUMN ${column} ${definition}`);
        }
    }

    public close(): void {
        if (this.db) {
            try {
                console.log('🛑 Closing SQLiteLearningStore...');
                this.db.pragma('wal_checkpoint(TRUNCATE)'); // Force WAL flush
                this.db.close();
                console.log('✅ SQLiteLearningStore closed safely.');
            } catch (e) {
                console.error('Failed to close SQLite DB cleanly', e);
            }
            this.db = null;
        }
    }
}
