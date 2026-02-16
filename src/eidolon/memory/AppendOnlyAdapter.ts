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
     * READ LOG
     * Replays the log file line by line.
     * Handles corrupted lines gracefully (skips them).
     */
    async readLog(key: string): Promise<any[]> {
        const filePath = path.join(this.baseDir, key);
        const entries: any[] = [];

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    entries.push(parsed.data);
                } catch (e) {
                    console.warn(`⚠️ Corrupted log entry in ${key}, skipping.`);
                }
            }
        } catch (e: any) {
            if (e.code !== 'ENOENT') {
                console.error(`❌ Failed to read log ${key}`, e);
            }
        }

        return entries;
    }
}
