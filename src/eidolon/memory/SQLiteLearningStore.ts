import * as path from 'path';
import { IStorageProvider } from './IStorageProvider';
import { AppendOnlyAdapter } from './AppendOnlyAdapter';

/**
 * SQLite-backed storage provider for high-frequency learning writes.
 * Uses better-sqlite3 when available, otherwise falls back to AppendOnlyAdapter.
 */
export class SQLiteLearningStore implements IStorageProvider {
    private db: any = null;
    private readonly dbPath: string;
    private readonly fallback: AppendOnlyAdapter;
    private readonly allowFallback: boolean;

    constructor(config: { dbPath?: string; fallbackDir?: string; allowFallback?: boolean } = {}) {
        this.dbPath = config.dbPath || path.join(process.cwd(), 'data', 'memory', 'eidolon_learning.db');
        this.fallback = new AppendOnlyAdapter({ baseDir: config.fallbackDir });
        this.allowFallback = config.allowFallback !== false;
    }

    async init(): Promise<void> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Database = require('better-sqlite3');
            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
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
            `);
        } catch (err) {
            if (!this.allowFallback) throw err;
            this.db = null;
            await this.fallback.init();
            console.warn('⚠️ SQLiteLearningStore unavailable, falling back to AppendOnlyAdapter');
        }
    }

    async save(key: string, data: any): Promise<void> {
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
        const stmt = this.db.prepare('SELECT v FROM kv_store WHERE k = ?');
        const row = stmt.get(key);
        if (!row) return null;
        try {
            return JSON.parse(row.v) as T;
        } catch {
            return null;
        }
    }

    async list(): Promise<string[]> {
        if (!this.db) return this.fallback.list();
        const rows = this.db.prepare('SELECT k FROM kv_store').all();
        return rows.map((r: any) => String(r.k));
    }

    async append(key: string, data: any): Promise<void> {
        if (!this.db) return this.fallback.append(key, data);
        const stmt = this.db.prepare('INSERT INTO append_logs (k, ts, v) VALUES (?, ?, ?)');
        stmt.run(key, Date.now(), JSON.stringify(data));
    }

    async readLog(key: string): Promise<any[]> {
        if (!this.db) return this.fallback.readLog(key);
        const stmt = this.db.prepare('SELECT v FROM append_logs WHERE k = ? ORDER BY id ASC');
        const rows = stmt.all(key);
        const out: any[] = [];
        for (const row of rows) {
            try {
                out.push(JSON.parse(row.v));
            } catch {
                // skip corrupted entry
            }
        }
        return out;
    }
}
