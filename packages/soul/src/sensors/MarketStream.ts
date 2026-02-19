import { EidolonBus, EidolonEventType } from '@clawkit/core';
import { EventEmitter } from 'events';

interface WebSocketLike {
    close(): void;
    on?(event: string, handler: (...args: unknown[]) => void): void;
    addEventListener?(event: string, handler: EventListener): void;
    ping?(): void;
    terminate?(): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;

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
    private ws: WebSocketLike | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private isAlive = false;

    private readonly wsUrl: string;
    private readonly symbol: string;
    private readonly whaleThreshold: number;
    private bus: EidolonBus;

    constructor(config: {
        wsUrl?: string,
        symbol?: string,
        whaleThreshold?: number
    } = {}) {
        super();
        this.symbol = (config.symbol || 'BNBUSDT').toLowerCase();
        this.wsUrl = config.wsUrl || `wss://stream.binance.com:9443/ws/${this.symbol}@trade`;
        this.whaleThreshold = config.whaleThreshold || 10000; // $10k default
        this.bus = EidolonBus.getInstance();
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
        const WebSocketCtor = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
        if (!WebSocketCtor) {
            console.warn('🌊 MarketStream: WebSocket is unavailable in this runtime.');
            return;
        }

        try {
            this.ws = new WebSocketCtor(this.wsUrl);
            const on = (event: string, handler: (...args: unknown[]) => void) => {
                if (!this.ws) return;
                if (typeof this.ws.on === 'function') {
                    this.ws.on(event, handler);
                    return;
                }
                if (typeof this.ws.addEventListener === 'function') {
                    this.ws.addEventListener(event, handler as EventListener);
                }
            };

            on('open', () => {
                console.log(`🌊 MarketStream: Connected to ${this.wsUrl}`);
                this.isAlive = true;

                // 💓 HEARTBEAT LOOP (30s)
                this.heartbeatInterval = setInterval(() => {
                    if (!this.isAlive) {
                        console.warn('🌊 MarketStream: Heartbeat failed (Zombie Connection), reconnecting...');
                        if (typeof this.ws?.terminate === 'function') {
                            this.ws.terminate();
                        } else {
                            this.ws?.close();
                        }
                        return;
                    }
                    this.isAlive = false; // Expect 'pong' to set this back to true
                    if (typeof this.ws?.ping === 'function') {
                        this.ws.ping();
                    } else {
                        // Browser-style WS has no ping API; keep connection alive via reads.
                        this.isAlive = true;
                    }
                }, 30000);
            });

            on('pong', () => {
                this.isAlive = true;
            });

            on('message', (dataOrEvent: unknown) => {
                try {
                    const payload = (dataOrEvent && typeof dataOrEvent === 'object' && 'data' in dataOrEvent)
                        ? (dataOrEvent as { data?: unknown }).data
                        : dataOrEvent;
                    const raw = JSON.parse(
                        typeof payload === 'string'
                            ? payload
                            : payload?.toString?.() ?? ''
                    );
                    // Binance Trade Stream Format:
                    // {
                    //   "e": "trade",     // Event type
                    //   "E": 123456789,   // Event time
                    //   "s": "BNBUSDT",   // Symbol
                    //   "t": 12345,       // Trade ID
                    //   "p": "0.001",     // Price
                    //   "q": "100",       // Quantity
                    //   "m": true         // Is the buyer the market maker?
                    // }
                    const price = parseFloat(raw.p);
                    const qty = parseFloat(raw.q);

                    if (!Number.isFinite(price) || price <= 0) return; // 🛡️ Validate Price

                    // 1. Emit Local Event
                    this.emit('price', {
                        symbol: this.symbol.toUpperCase(),
                        price: price,
                        time: raw.E
                    });

                    // 2. Bridge to EidolonBus (Gap Fix)
                    this.bus.emitEvent({
                        type: EidolonEventType.PRICE_UPDATE,
                        timestamp: raw.E,
                        payload: {
                            symbol: this.symbol.toUpperCase(),
                            price: price,
                            source: 'BINANCE_WS'
                        }
                    });

                    // 3. Whale Detection
                    const amountUSD = price * qty;
                    if (amountUSD >= this.whaleThreshold) {
                        const isBuyerMaker = raw.m;
                        // If Buyer is Maker -> Taker is Seller -> SELL Action
                        // If Buyer is Taker -> BUY Action
                        const action = isBuyerMaker ? 'SELL' : 'BUY';

                        this.bus.emitEvent({
                            type: EidolonEventType.WHALE_MOVEMENT,
                            timestamp: raw.E,
                            payload: {
                                symbol: this.symbol.toUpperCase(),
                                action,
                                amountUSD,
                                price,
                                txId: raw.t
                            }
                        });
                        console.log(`🐋 WHALE ALERT: ${action} $${amountUSD.toFixed(0)} @ ${price}`);
                    }

                } catch {
                    // Ignore parse errors
                }
            });

            on('close', () => {
                console.warn('🌊 MarketStream: Disconnected');
                this.isAlive = false;
                if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                this.scheduleReconnect();
            });

            on('error', (err: unknown) => {
                const message = (err && typeof err === 'object' && 'message' in err)
                    ? String((err as { message?: unknown }).message)
                    : String(err);
                console.error('🌊 MarketStream Error:', message);
                if (typeof this.ws?.terminate === 'function') {
                    this.ws.terminate();
                } else {
                    this.ws?.close();
                }
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
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}
