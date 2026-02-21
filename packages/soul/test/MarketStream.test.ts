import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MarketStream } from '../src/sensors/MarketStream';

type Listener = (event?: unknown) => void;

class MockWebSocket {
    public static instances: MockWebSocket[] = [];
    private listeners = new Map<string, Listener[]>();

    constructor(public readonly url: string) {
        MockWebSocket.instances.push(this);
    }

    public addEventListener(event: string, listener: Listener): void {
        const bucket = this.listeners.get(event) ?? [];
        bucket.push(listener);
        this.listeners.set(event, bucket);
    }

    public emit(event: string, payload?: unknown): void {
        const bucket = this.listeners.get(event) ?? [];
        for (const listener of bucket) listener(payload);
    }

    public close(): void {
        this.emit('close');
    }
}

describe('MarketStream', () => {
    let stream: MarketStream;
    const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

    beforeEach(() => {
        vi.clearAllMocks();
        MockWebSocket.instances = [];
        (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket as unknown as typeof WebSocket;
        stream = new MarketStream();
    });

    afterEach(() => {
        stream.stop();
        (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
        vi.useRealTimers();
    });

    it('should connect to WebSocket on start', () => {
        stream.start();
        expect(MockWebSocket.instances.length).toBe(1);
        expect(MockWebSocket.instances[0].url).toContain('stream.binance.com');
    });

    it('should emit PRICE updates on message', () => {
        stream.start();
        const ws = MockWebSocket.instances[0];

        const payload = JSON.stringify({
            e: 'trade',
            E: 123456789,
            s: 'BNBUSDT',
            p: '600.50',
            q: '1.0'
        });

        const emitSpy = vi.spyOn(stream, 'emit');
        ws.emit('message', { data: payload });

        expect(emitSpy).toHaveBeenCalledWith('price', {
            symbol: 'BNB',
            price: 600.50,
            time: 123456789
        });
    });

    it('should attempt reconnect on close', () => {
        vi.useFakeTimers();
        stream.start();
        const ws = MockWebSocket.instances[0];
        ws.emit('close');

        vi.advanceTimersByTime(5000);
        expect(MockWebSocket.instances.length).toBe(2);
    });
});
