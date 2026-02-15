import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { IStorageProvider } from "./IStorageProvider";
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🟩 GREENFIELD ADAPTER (S3)
 * "The External Memory"
 * 
 * Connecting to BNB Greenfield via S3-compatible API.
 * Also supports local fallback for development.
 */
export class GreenfieldAdapter implements IStorageProvider {
    private client: S3Client | null = null;
    private bucketName: string;
    private useLocalFallback: boolean = false;
    private localDir: string = './data/memory';

    constructor(config: {
        endpoint?: string,
        region?: string,
        accessKeyId?: string,
        secretAccessKey?: string,
        bucketName: string,
        useLocalFallback?: boolean
    }) {
        this.bucketName = config.bucketName;
        this.useLocalFallback = config.useLocalFallback || false;

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
            if (!fs.existsSync(this.localDir)) {
                fs.mkdirSync(this.localDir, { recursive: true });
            }
        }
    }

    async init(): Promise<void> {
        if (this.useLocalFallback) return;

        try {
            // Check if bucket exists/accessible
            await this.client?.send(new ListObjectsV2Command({ Bucket: this.bucketName, MaxKeys: 1 }));
            console.log(`🟩 Connected to Greenfield Bucket: ${this.bucketName}`);
        } catch (error) {
            console.error("❌ Greenfield Connection Failed:", error);
            console.warn("⚠️ Falling back to Local FS");
            this.useLocalFallback = true;
            if (!fs.existsSync(this.localDir)) {
                fs.mkdirSync(this.localDir, { recursive: true });
            }
        }
    }

    async save(key: string, data: any): Promise<void> {
        const jsonString = JSON.stringify(data, null, 2);

        if (this.useLocalFallback) {
            fs.writeFileSync(path.join(this.localDir, key), jsonString);
            return;
        }

        try {
            await this.client?.send(new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: jsonString,
                ContentType: "application/json"
            }));
            console.log(`💾 Saved to Greenfield: ${key}`);
        } catch (error) {
            console.error(`❌ Failed to save ${key} to Greenfield:`, error);
            // Fallback save to ensure no data loss
            fs.writeFileSync(path.join(this.localDir, key), jsonString);
        }
    }

    async load<T>(key: string): Promise<T | null> {
        if (this.useLocalFallback) {
            const localPath = path.join(this.localDir, key);
            if (fs.existsSync(localPath)) {
                return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
            }
            return null;
        }

        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key
            });
            const response = await this.client?.send(command);

            if (response?.Body) {
                const str = await this.streamToString(response.Body as Readable);
                return JSON.parse(str);
            }
            return null;
        } catch (error: any) {
            if (error.name === 'NoSuchKey') return null;
            console.error(`❌ Failed to load ${key} from Greenfield:`, error);
            // Try local backup
            const localPath = path.join(this.localDir, key);
            if (fs.existsSync(localPath)) {
                console.log(`⚠️ Loading ${key} from local backup.`);
                return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
            }
            return null;
        }
    }

    async list(): Promise<string[]> {
        if (this.useLocalFallback) {
            return fs.readdirSync(this.localDir);
        }

        try {
            const response = await this.client?.send(new ListObjectsV2Command({ Bucket: this.bucketName }));
            return response?.Contents?.map(c => c.Key || '') || [];
        } catch (error) {
            console.error("❌ Failed to list objects:", error);
            return [];
        }
    }

    // Helper
    private streamToString(stream: Readable): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on("error", (err) => reject(err));
            stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        });
    }
}
