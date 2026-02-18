
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface TickerData {
    symbol: string;
    price: number;
    time: number;
}

export declare interface MarketStream {
    on(event: 'price', listener: (data: TickerData) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
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

    public start(): void {
        this.connect();
    }

    private connect(): void {
        try {
            this.ws = new WebSocket(this.WS_URL);

            this.ws.on('open', () => {
                console.log('🌊 MarketStream: Connected to Binance WS');
                this.isAlive = true;
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const raw = JSON.parse(data.toString());
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
                } catch (e) {
                    // Ignore parse errors
                }
            });

            this.ws.on('close', () => {
                console.warn('🌊 MarketStream: Disconnected');
                this.isAlive = false;
                this.scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                console.error('🌊 MarketStream Error:', err.message);
                this.ws?.terminate();
            });

        } catch (e: any) {
            console.error('🌊 MarketStream Connection Failed:', e.message);
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
