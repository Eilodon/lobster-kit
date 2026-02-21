import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PythAdapter } from '../src/oracles/PythAdapter';
import axios from 'axios';

vi.mock('axios');

class MockWebSocket {
    public static readonly OPEN = 1;
    public readyState = MockWebSocket.OPEN;
    public onopen: (() => void) | null = null;
    public onmessage: ((event: { data: unknown }) => void) | null = null;
    public onerror: ((error: unknown) => void) | null = null;
    public onclose: (() => void) | null = null;

    constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
    }

    public send(_msg: string): void { }
    public close(): void {
        this.onclose?.();
    }
}

describe('PythAdapter', () => {
    let adapter: PythAdapter;
    const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

    beforeEach(() => {
        vi.resetAllMocks();
        (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket as unknown as typeof WebSocket;
        adapter = new PythAdapter();
    });

    it('should fetch and parse BNB price correctly', async () => {
        const mockResponse = {
            data: {
                parsed: [{
                    price: {
                        price: "30550000000",
                        expo: -8
                    }
                }]
            }
        };

        vi.mocked(axios.get).mockResolvedValue(mockResponse);

        const price = await adapter.getPrice('BNB');
        expect(price).toBe(305.50);
        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/v2/updates/price/latest'), expect.any(Object));
    });

    it('should throw error on API failure', async () => {
        vi.mocked(axios.get).mockRejectedValue(new Error('Network Error'));

        await expect(adapter.getPrice('BNB')).rejects.toThrow('Network Error');
    });

    it('should throw error on invalid response format', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: {} });

        await expect(adapter.getPrice('BNB')).rejects.toThrow('Invalid Pyth response format');
    });

    it('should parse price_update websocket payload and cache value', async () => {
        (adapter as any).handleWsMessage(JSON.stringify({
            type: 'price_update',
            price_feed: {
                id: '2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f',
                price: {
                    price: '30550000000',
                    expo: -8
                }
            }
        }));

        const price = await adapter.getPrice('BNB');
        expect(price).toBe(305.5);
        expect(axios.get).not.toHaveBeenCalled();
    });

    afterEach(() => {
        adapter.dispose();
        (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
    });
});
