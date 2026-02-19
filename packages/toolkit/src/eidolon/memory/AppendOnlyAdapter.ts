import * as fs from 'fs/promises';
import * as path from 'path';
import { IStorageProvider } from './IStorageProvider';
import { AsyncLock } from '../../utils/AsyncLock';

/**
 * 💾 APPEND-ONLY ADAPTER (LOCAL)
 * "The Black Box Recorder"
 * 
 * Implements a robust storage mechanism using Write-Ahead Logs (WAL) concepts.
 * - Atomic Writes: Safe from partial file corruption.
 * - Append Streams: High-throughput logging without rewriting the whole file.
 */
export class AppendOnlyAdapter implements IStorageProvider {
    private baseDir: string;
    private lock = new AsyncLock();

    constructor(config: { baseDir?: string } = {}) {
        this.baseDir = config.baseDir || path.join(process.cwd(), 'data', 'memory');
        this.ensureBaseDir();
    }

    private async ensureBaseDir() {
        try {
            await fs.mkdir(this.baseDir, { recursive: true });
        } catch (e) {
            console.error('Failed to create memory directory', e);
        }
    }

    async init(): Promise<void> {
        await this.ensureBaseDir();
        console.log(`💾 Memory System Online: ${this.baseDir}`);
    }

    /**
     * ATOMIC SAVE
     * Writes to a temp file first, then renames it.
     * Prevents data corruption if process crashes during write.
     */
    async save<T = unknown>(key: string, data: T): Promise<void> {
        const filePath = path.join(this.baseDir, key);
        const tempPath = `${filePath}.tmp`;

        try {
            const json = JSON.stringify(data, null, 2);
            await fs.writeFile(tempPath, json, 'utf-8');
            await fs.rename(tempPath, filePath); // Atomic operation on POSIX
        } catch (e) {
            console.error(`❌ Failed to save ${key}`, e);
            throw e;
        }
    }

    async load<T>(key: string): Promise<T | null> {
        const filePath = path.join(this.baseDir, key);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as T;
        } catch (e: unknown) {
            const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : '';
            if (code === 'ENOENT') return null;
            console.error(`❌ Failed to load ${key}`, e);
            return null;
        }
    }

    async list(): Promise<string[]> {
        try {
            return await fs.readdir(this.baseDir);
        } catch {
            return [];
        }
    }

    /**
     * APPEND LOG (The Black Box)
     * Appends a JSON line to the file.
     * Format: NDJSON (Newline Delimited JSON)
     */
    async append<T = unknown>(key: string, data: T): Promise<void> {
        return this.lock.run(async () => {
            const filePath = path.join(this.baseDir, key);
            try {
                // FIX Bug #18: Log Rotation
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.size > 10 * 1024 * 1024) { // 10MB limit
                        const backupPath = `${filePath}.${Date.now()}.bak`;
                        await fs.rename(filePath, backupPath);
                        console.log(`📦 Log rotated: ${key} -> ${path.basename(backupPath)}`);
                    }
                } catch {
                    // File might not exist yet, ignore
                }

                const entry = JSON.stringify({
                    ts: Date.now(),
                    data
                }) + '\n';
                await fs.appendFile(filePath, entry, 'utf-8');
            } catch (e) {
                console.error(`❌ Failed to append to ${key}`, e);
                throw e;
            }
        });
    }

    /**
     * READ LOG (Memory Safe)
     * Replays the log file line by line using streams.
     * @param limit Max number of recent entries to return (0 = all)
     */
    async readLog<T = unknown>(key: string, limit: number = 0): Promise<T[]> {
        const filePath = path.join(this.baseDir, key);
        const entries: T[] = [];

        try {
            const fileHandle = await fs.open(filePath, 'r');
            const stream = fileHandle.createReadStream({ encoding: 'utf-8' });

            // Basic line reader implementation to avoid external deps
            // For production robustness with huge files, a specialized library or 'readline' module is better
            // But 'readline' with Node streams is standard.

            const readline = await import('readline');
            const rl = readline.createInterface({
                input: stream,
                crlfDelay: Infinity
            });

            for await (const line of rl) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line) as { data?: T };

                    // Memory Safety: If limiting, maintain only the window
                    if (limit > 0) {
                        entries.push(parsed.data as T);
                        if (entries.length > limit) {
                            entries.shift(); // Remove oldest to keep memory usage constant
                        }
                    } else {
                        entries.push(parsed.data as T);
                    }
                } catch {
                    // skip corrupted
                }
            }

            await fileHandle.close();
        } catch (e: unknown) {
            const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : '';
            if (code !== 'ENOENT') {
                console.error(`❌ Failed to read log ${key}`, e);
            }
        }

        return entries;
    }

    /**
     * READ LOG TAIL (Optimized)
     * Alias for readLog with limit
     */
    async readLogTail<T = unknown>(key: string, limit: number = 1000): Promise<T[]> {
        return this.readLog(key, limit);
    }

    public getBaseDir(): string {
        return this.baseDir;
    }
}
