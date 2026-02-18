
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MarketStream } from '../../src/eidolon/sensors/MarketStream';
import WebSocket from 'ws';

// Mock WebSocket
const mockWs = {
    on: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    send: vi.fn()
};

// We need to intercept the WebSocket constructor
vi.mock('ws', () => {
    return {
        default: vi.fn(() => mockWs)
    };
});

describe('MarketStream', () => {
    let stream: MarketStream;

    beforeEach(() => {
        vi.clearAllMocks();
        stream = new MarketStream();
    });

    afterEach(() => {
        stream.stop();
    });

    it('should connect to WebSocket on start', () => {
        stream.start();
        expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('stream.binance.com'));
    });

    it('should emit PRICE updates on message', () => {
        stream.start();

        // Get the 'message' handler
        // ws.on calls: [0]: 'open', [1]: 'message', [2]: 'close', [3]: 'error'
        // We need to find the call for 'message'
        const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];

        const mockPayload = JSON.stringify({
            e: 'trade',
            E: 123456789,
            s: 'BNBUSDT',
            p: '600.50',
            q: '1.0'
        });

        const emitSpy = vi.spyOn(stream, 'emit');

        messageHandler(mockPayload);

        expect(emitSpy).toHaveBeenCalledWith('price', {
            symbol: 'BNB',
            price: 600.50,
            time: 123456789
        });
    });

    it('should attempt reconnect on close', () => {
        vi.useFakeTimers();
        stream.start();

        const closeHandler = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];

        // Trigger close
        closeHandler();

        // Fast forward time
        vi.advanceTimersByTime(5000);

        // Expect new connection (constructor called again)
        expect(WebSocket).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });
});
