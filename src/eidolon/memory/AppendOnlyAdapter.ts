import * as fs from 'fs/promises';
import * as path from 'path';
import { IStorageProvider } from './IStorageProvider';

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
    async save(key: string, data: any): Promise<void> {
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
        } catch (e: any) {
            if (e.code === 'ENOENT') return null;
            console.error(`❌ Failed to load ${key}`, e);
            return null;
        }
    }

    async list(): Promise<string[]> {
        try {
            return await fs.readdir(this.baseDir);
        } catch (e) {
            return [];
        }
    }

    /**
     * APPEND LOG (The Black Box)
     * Appends a JSON line to the file.
     * Format: NDJSON (Newline Delimited JSON)
     */
    async append(key: string, data: any): Promise<void> {
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
            } catch (e) {
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
    }

    /**
     * READ LOG (Memory Safe)
     * Replays the log file line by line using streams.
     * @param limit Max number of recent entries to return (0 = all)
     */
    async readLog(key: string, limit: number = 0): Promise<any[]> {
        const filePath = path.join(this.baseDir, key);
        const entries: any[] = [];

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

            // If limit > 0, we need a sliding window.
            // But if we just want "all" but memory safe, we can populate.
            // If the file is HUGE, "all" will still OOM key[], but avoiding readFile() helps.
            // For "tail" functionality (last N), a circular buffer is needed.

            for await (const line of rl) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    entries.push(parsed.data);
                    if (limit > 0 && entries.length > limit) {
                        entries.shift(); // Remove oldest
                    }
                } catch (e) {
                    // skip corrupted
                }
            }

            await fileHandle.close();
        } catch (e: any) {
            if (e.code !== 'ENOENT') {
                console.error(`❌ Failed to read log ${key}`, e);
            }
        }

        return entries;
    }

    /**
     * READ LOG TAIL (Optimized)
     * Alias for readLog with limit
     */
    async readLogTail(key: string, limit: number = 1000): Promise<any[]> {
        return this.readLog(key, limit);
    }

    public getBaseDir(): string {
        return this.baseDir;
    }
}
