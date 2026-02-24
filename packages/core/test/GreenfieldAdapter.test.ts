import { afterEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'stream';
import { GreenfieldAdapter } from '../src/memory/GreenfieldAdapter';

describe('GreenfieldAdapter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('loads JSON payload when stream size is within limit', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const adapter = new GreenfieldAdapter({
            endpoint: 'https://example.test',
            accessKeyId: 'a',
            secretAccessKey: 'b',
            bucketName: 'bucket',
            maxLoadBytes: 1024,
        });

        (adapter as unknown as { client: unknown }).client = {
            send: async () => ({
                Body: Readable.from([JSON.stringify({ ok: true })]),
            }),
        };

        const loaded = await adapter.load<{ ok: boolean }>('memory.json');
        expect(loaded).toEqual({ ok: true });
    });

    it('returns null when stream payload exceeds configured max size', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const adapter = new GreenfieldAdapter({
            endpoint: 'https://example.test',
            accessKeyId: 'a',
            secretAccessKey: 'b',
            bucketName: 'bucket',
            maxLoadBytes: 64,
        });

        (adapter as unknown as { client: unknown }).client = {
            send: async () => ({
                Body: Readable.from([JSON.stringify({ payload: 'x'.repeat(256) })]),
            }),
        };

        const loaded = await adapter.load<{ payload: string }>('oversized.json');
        expect(loaded).toBeNull();
        expect(errorSpy).toHaveBeenCalled();
    });
});
