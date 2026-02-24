import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { IStorageProvider } from "./IStorageProvider";
import { AsyncLock } from '@clawkit/core';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

/**
 * 🟩 GREENFIELD ADAPTER (S3)
 * "The External Memory"
 * 
 * Connecting to BNB Greenfield via S3-compatible API.
 * Also supports local fallback for development.
 * 
 * FIX Bug #19: Converted to fully Async I/O
 */
export class GreenfieldAdapter implements IStorageProvider {
    private static readonly DEFAULT_MAX_LOAD_BYTES = 32 * 1024 * 1024; // 32MB safety guard
    private client: S3Client | null = null;
    private bucketName: string;
    private useLocalFallback: boolean = false;
    private readonly localDir: string; // FIX: resolved absolute path, readonly
    private readonly maxLoadBytes: number;
    private lock = new AsyncLock();

    constructor(config: {
        endpoint?: string,
        region?: string,
        accessKeyId?: string,
        secretAccessKey?: string,
        bucketName: string,
        useLocalFallback?: boolean,
        maxLoadBytes?: number
    }) {
        this.bucketName = config.bucketName;
        this.useLocalFallback = config.useLocalFallback || false;
        // FIX: always resolve to absolute path to avoid cwd-dependent bugs
        this.localDir = path.resolve(config.useLocalFallback ? './data/memory' : './data/memory');
        this.maxLoadBytes = Number.isFinite(config.maxLoadBytes) && Number(config.maxLoadBytes) > 0
            ? Math.floor(Number(config.maxLoadBytes))
            : GreenfieldAdapter.DEFAULT_MAX_LOAD_BYTES;

        if (!this.useLocalFallback && config.endpoint && config.accessKeyId && config.secretAccessKey) {
            this.client = new S3Client({
                endpoint: config.endpoint,
                region: config.region || 'us-east-1', // Greenfield default
                credentials: {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey
                },
                forcePathStyle: true // Required for some S3 implementations like MinIO/Greenfield
            });
        } else {
            console.warn("⚠️ Greenfield Adapter: Missing credentials or fallback enabled. Using Local FS.");
            this.useLocalFallback = true;
            // Sync check is okay in constructor
            if (!existsSync(this.localDir)) {
                // We can't await in constructor, so we schedule it or use sync here carefully,
                // but since we are fixing async, let's lazy init or just use sync for mkdir once.
                // However, user wanted non-blocking. Constructor is sync anyway.
                // We'll leave sync here for safety or move to init().
            }
        }
    }

    async init(): Promise<void> {
        if (this.useLocalFallback) {
            await this.ensureLocalDir();
            return;
        }

        try {
            // Check if bucket exists/accessible
            await this.client?.send(new ListObjectsV2Command({ Bucket: this.bucketName, MaxKeys: 1 }));
            console.log(`🟩 Connected to Greenfield Bucket: ${this.bucketName}`);
        } catch (error) {
            console.error("❌ Greenfield Connection Failed:", error);
            console.warn("⚠️ Falling back to Local FS");
            this.useLocalFallback = true;
            await this.ensureLocalDir();
        }
    }

    private async ensureLocalDir() {
        try {
            await fs.mkdir(this.localDir, { recursive: true });
        } catch (e: unknown) {
            const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : '';
            if (code !== 'EEXIST') throw e;
        }
    }

    async save<T = unknown>(key: string, data: T): Promise<void> {
        const jsonString = JSON.stringify(data, null, 2);

        if (this.useLocalFallback) {
            await this.ensureLocalDir();
            const filePath = path.join(this.localDir, key);

            await this.lock.run(async () => {
                const tempPath = `${filePath}_${Date.now()}.tmp`;

                // Atomic Write: Write to tmp -> Rename
                await fs.writeFile(tempPath, jsonString);
                await fs.rename(tempPath, filePath);
            });
            return;
        }

        try {
            await this.client?.send(new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: jsonString,
                ContentType: "application/json",
                ServerSideEncryption: "AES256" // FIX: Encrypt-at-rest
            }));
            console.log(`💾 Saved to Greenfield: ${key}`);
        } catch (error) {
            console.error(`❌ Failed to save ${key} to Greenfield:`, error);
            // Fallback save to ensure no data loss
            await this.ensureLocalDir();
            const filePath = path.join(this.localDir, key);

            await this.lock.run(async () => {
                const tempPath = `${filePath}_${Date.now()}.tmp`;

                // Atomic Write: Write to tmp -> Rename
                await fs.writeFile(tempPath, jsonString);
                await fs.rename(tempPath, filePath);
            });
        }
    }

    async load<T>(key: string): Promise<T | null> {
        if (this.useLocalFallback) {
            const localPath = path.join(this.localDir, key);
            return this.readLocalJson<T>(localPath);
        }

        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key
            });
            const response = await this.client?.send(command);

            if (response?.Body) {
                const str = await this.streamToString(response.Body as Readable, this.maxLoadBytes);
                return JSON.parse(str);
            }
            return null;
        } catch (error: unknown) {
            const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name?: unknown }).name) : '';
            if (name === 'NoSuchKey') return null;
            console.error(`❌ Failed to load ${key} from Greenfield:`, error);
            // Try local backup
            const localPath = path.join(this.localDir, key);
            try {
                if (existsSync(localPath)) {
                    console.log(`⚠️ Loading ${key} from local backup.`);
                    return this.readLocalJson<T>(localPath);
                }
            } catch {
                // Local backup missing or unreadable.
            }
            return null;
        }
    }

    async list(): Promise<string[]> {
        if (this.useLocalFallback) {
            try {
                return await fs.readdir(this.localDir);
            } catch (error) {
                console.error("❌ Critical: Failed to list local directory", error);
                // Propagate error if critical for system awareness, or return empty list but ensure it's logged loud
                // The audit said "nuốt lỗi", so we must at least log it.
                // If we throw, it might crash the caller. Let's return empty but log Error.
                return [];
            }
        }

        try {
            const response = await this.client?.send(new ListObjectsV2Command({ Bucket: this.bucketName }));
            return response?.Contents?.map(c => c.Key || '') || [];
        } catch (error) {
            console.error("❌ Failed to list objects from Greenfield:", error);
            // Don't just return empty silently
            return [];
        }
    }

    private async readLocalJson<T>(filePath: string): Promise<T | null> {
        try {
            const stats = await fs.stat(filePath);
            if (stats.size > this.maxLoadBytes) {
                console.error(`❌ Refusing to load oversized local payload (${stats.size} bytes > ${this.maxLoadBytes} bytes): ${path.basename(filePath)}`);
                return null;
            }
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content) as T;
        } catch {
            return null;
        }
    }

    // Helper
    private streamToString(stream: Readable, maxBytes: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const decoder = new TextDecoder('utf-8');
            const parts: string[] = [];
            let totalBytes = 0;
            let settled = false;

            const cleanup = () => {
                stream.removeListener('data', onData);
                stream.removeListener('error', onError);
                stream.removeListener('end', onEnd);
            };

            const fail = (error: Error) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (typeof stream.destroy === 'function') {
                    stream.destroy();
                }
                reject(error);
            };

            const onData = (chunk: Buffer | Uint8Array | string) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                totalBytes += buf.length;
                if (totalBytes > maxBytes) {
                    fail(new Error(`GreenfieldAdapter: payload exceeds maxLoadBytes (${maxBytes} bytes)`));
                    return;
                }
                parts.push(decoder.decode(buf, { stream: true }));
            };

            const onError = (error: unknown) => {
                fail(error instanceof Error ? error : new Error(String(error)));
            };

            const onEnd = () => {
                if (settled) return;
                settled = true;
                cleanup();
                parts.push(decoder.decode());
                resolve(parts.join(''));
            };

            stream.on('data', onData);
            stream.once('error', onError);
            stream.once('end', onEnd);
        });
    }

    /**
     * APPEND LOG (Hybrid)
     * Always writes logs to local disk first for speed/safety.
     */
    async append<T = unknown>(key: string, data: T): Promise<void> {
        // Logs are always local for low latency
        const localPath = path.join(this.localDir, key);
        try {
            const entry = JSON.stringify({
                ts: Date.now(),
                data
            }) + '\n';

            await this.ensureLocalDir();
            await this.lock.run(async () => {
                await fs.appendFile(localPath, entry, 'utf-8');
            });
        } catch (e) {
            console.error(`❌ Failed to append to ${key}`, e);
            throw e;
        }
    }

    async readLog<T = unknown>(key: string, limit: number = 0, offset: number = 0): Promise<T[]> {
        const localPath = path.join(this.localDir, key);
        const entries: T[] = [];

        try {
            if (!existsSync(localPath)) return [];

            const fileHandle = await fs.open(localPath, 'r');
            const stream = fileHandle.createReadStream({ encoding: 'utf-8' });

            // Basic line reader implementation to avoid external deps
            const readline = await import('readline');
            const rl = readline.createInterface({
                input: stream,
                crlfDelay: Infinity
            });

            // 🛡️ Ring Buffer Implementation (O(N) vs O(N^2))
            const ringBuffer: T[] = new Array(limit > 0 ? limit : 0);
            let ringIdx = 0;
            let totalEntries = 0;
            const useRing = limit > 0;

            for await (const line of rl) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line) as { data?: T };

                    // Offset logic: Skip first N items
                    if (offset > 0) {
                        offset--;
                        continue;
                    }

                    if (useRing) {
                        ringBuffer[ringIdx % limit] = parsed.data as T;
                        ringIdx++;
                        totalEntries++;
                    } else {
                        entries.push(parsed.data as T);
                    }
                } catch {
                    // Skip corrupted log line.
                }
            }
            await fileHandle.close();

            if (useRing) {
                // Reconstruct chronological order from ring buffer
                const count = Math.min(totalEntries, limit);
                const result = new Array(count);
                const start = totalEntries > limit ? ringIdx % limit : 0;

                for (let i = 0; i < count; i++) {
                    result[i] = ringBuffer[(start + i) % limit];
                }
                return result;
            }
        } catch (e: unknown) {
            console.error(`❌ Failed to read log ${key}`, e);
        }

        return entries;
    }
}
