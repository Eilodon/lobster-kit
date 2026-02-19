
import { EventEmitter } from 'events';

export interface TickerData {
    symbol: string;
    price: number;
    time: number;
}

/**
 * 🌊 MARKET STREAM (The Nervous System)
 * Connects to Binance WebSocket for sub-second price updates.
 * Used for Reflex actions (e.g. Panic Sell on crash).
 */
export class MarketStream extends EventEmitter {
    private ws: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private isAlive = false;
    private readonly WS_URL = 'wss://stream.binance.com:9443/ws/bnbusdt@trade';

    constructor() {
        super();
    }

    public override on(event: 'price', listener: (data: TickerData) => void): this;
    public override on(event: string | symbol, listener: (...args: unknown[]) => void): this;
    public override on(
        event: string | symbol,
        listener: ((data: TickerData) => void) | ((...args: unknown[]) => void)
    ): this {
        return super.on(event, listener as (...args: unknown[]) => void);
    }

    public start(): void {
        this.connect();
    }

    private connect(): void {
        if (typeof WebSocket === 'undefined') {
            console.warn('🌊 MarketStream: WebSocket is unavailable in this runtime.');
            return;
        }

        try {
            this.ws = new WebSocket(this.WS_URL);

            this.ws.addEventListener('open', () => {
                console.log('🌊 MarketStream: Connected to Binance WS');
                this.isAlive = true;
            });

            this.ws.addEventListener('message', (event: MessageEvent) => {
                try {
                    const raw = JSON.parse(String(event.data));
                    // Binance Trade Stream Format:
                    // {
                    //   "e": "trade",     // Event type
                    //   "E": 123456789,   // Event time
                    //   "s": "BNBUSDT",   // Symbol
                    //   "t": 12345,       // Trade ID
                    //   "p": "0.001",     // Price
                    //   "q": "100",       // Quantity
                    //   ...
                    // }
                    const price = parseFloat(raw.p);
                    this.emit('price', {
                        symbol: 'BNB',
                        price: price,
                        time: raw.E
                    });
                } catch {
                    // Ignore parse errors
                }
            });

            this.ws.addEventListener('close', () => {
                console.warn('🌊 MarketStream: Disconnected');
                this.isAlive = false;
                this.scheduleReconnect();
            });

            this.ws.addEventListener('error', (err: Event) => {
                console.error('🌊 MarketStream Error:', err);
                this.ws?.close();
            });

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error('🌊 MarketStream Connection Failed:', message);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        console.log('🌊 MarketStream: Reconnecting in 5s...');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 5000);
    }

    public stop(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
