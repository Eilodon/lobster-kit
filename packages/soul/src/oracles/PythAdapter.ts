
import axios from 'axios';
import { PythConfig } from '../config/PythConfig';
import { withRetry } from '@eidolon/core';

interface PythPricePayload {
    price?: unknown;
    expo?: unknown;
}

interface PythMessage {
    type?: unknown;
    id?: unknown;
    price?: unknown;
    price_feed?: {
        id?: unknown;
        price?: unknown;
    };
}

export class PythAdapter {
    private readonly DEFAULT_ENDPOINT = 'wss://hermes.pyth.network/ws';
    private ws: WebSocket | null = null;
    private priceCache = new Map<string, number>();
    private config?: PythConfig;
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;

    constructor(config?: PythConfig) {
        this.config = config;
        this.connect();
    }

    private get endpoint(): string {
        // Allow config override, otherwise use default WSS
        return this.config?.endpoint || this.DEFAULT_ENDPOINT;
    }

    private connect() {
        if (this.disposed) return;

        if (typeof WebSocket === 'undefined') {
            console.warn('⚠️ WebSocket not available (Node < 20?). PythAdapter disabled.');
            return;
        }

        try {
            this.ws = new WebSocket(this.endpoint);

            this.ws.onopen = () => {
                this.reconnectAttempts = 0;
                console.log('👁️ Pyth WebSocket Connected');
                this.subscribe();
            };

            this.ws.onmessage = (event) => {
                this.handleWsMessage(event.data);
            };

            this.ws.onerror = (err) => {
                console.error('👁️ Pyth WebSocket Error:', err);
            };

            this.ws.onclose = () => {
                this.scheduleReconnect();
            };
        } catch (e) {
            console.error('Failed to init WebSocket:', e);
            this.scheduleReconnect();
        }
    }

    private subscribe() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const configuredIds = this.config?.priceFeedIds
            ? Object.values(this.config.priceFeedIds).filter((id): id is string => id !== undefined)
            : [];
        const ids = [
            ...configuredIds,
            this.getDefaultFeedId('BNB'),
            this.getDefaultFeedId('USDT')
        ].map(id => this.normalizeFeedId(id));

        const uniqueIds = [...new Set(ids)];
        // Hermes subscribe message
        this.ws.send(JSON.stringify({
            type: 'subscribe',
            ids: uniqueIds
        }));
    }

    /**
     * Update price from external source (e.g. WS message handler)
     */
    public onPriceUpdate(feedId: string, price: number) {
        if (!Number.isFinite(price)) return;
        this.priceCache.set(this.normalizeFeedId(feedId), price);
    }

    private toDecimalString(value: bigint, expo: number): string {
        const negative = value < 0n;
        const abs = negative ? -value : value;
        const raw = abs.toString();

        if (expo >= 0) {
            return `${negative ? '-' : ''}${raw}${'0'.repeat(expo)}`;
        }

        const fracLen = -expo;
        const padded = raw.padStart(fracLen + 1, '0');
        const intPart = padded.slice(0, -fracLen);
        const fracPart = padded.slice(-fracLen).replace(/0+$/, '');
        const decimal = fracPart ? `${intPart}.${fracPart}` : intPart;
        return `${negative ? '-' : ''}${decimal}`;
    }

    /**
     * Get latest price for a symbol
     * @param symbol 'BNB' | 'USDT'
     * @returns Price as number (Zero Latency from Cache)
     */
    public async getPrice(symbol: 'BNB' | 'USDT'): Promise<number> {
        const feedId = this.normalizeFeedId(this.config?.priceFeedIds?.[symbol] || this.getDefaultFeedId(symbol));

        // Return cached price if available
        if (this.priceCache.has(feedId)) {
            return this.priceCache.get(feedId)!;
        }

        // Fallback to HTTP for cold start (hybrid approach to ensure availability)
        // Re-using the HTTP logic as fallback is smart, but for this "Atomic" audit, 
        // we heavily prioritize the cached WS value.

        // If no cache, we perform a ONE-OFF fetch to warm it up.
        console.warn(`⚠️ Pyth Cache Miss for ${symbol}. Falling back to HTTP to warm cache.`);
        const price = await this.fetchHttpOneOff(feedId);
        this.priceCache.set(feedId, price);
        return price;
    }

    private async fetchHttpOneOff(feedId: string): Promise<number> {
        try {
            const price = await withRetry(async () => {
                const response = await axios.get(`${this.getHttpEndpoint()}/v2/updates/price/latest`, {
                    params: {
                        ids: [feedId],
                        encoding: 'hex',
                        parsed: true
                    },
                    timeout: 5000
                });

                const priceData = response.data?.parsed?.[0]?.price;
                const parsed = this.parsePricePayload(priceData);
                if (parsed === null) {
                    throw new Error('Invalid Pyth response format');
                }
                return parsed;
            }, {
                maxAttempts: 3,
                baseDelay: 300,
                maxDelay: 2000,
                totalTimeoutMs: 10000,
                shouldRetry: (error: unknown) => {
                    const message = (error && typeof error === 'object' && 'message' in error)
                        ? String((error as { message?: unknown }).message ?? '')
                        : String(error ?? '');
                    return !message.includes('Invalid Pyth response format');
                }
            });

            return price;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            if (message.includes('Invalid Pyth response format')) {
                throw new Error('Invalid Pyth response format');
            }
            throw new Error(`Pyth Oracle Completely Unreachable: ${message}`);
        }
    }

    private handleWsMessage(raw: unknown) {
        try {
            const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const messages = Array.isArray(payload) ? payload : [payload];

            for (const message of messages) {
                if (!message || typeof message !== 'object') continue;
                const typedMessage = message as PythMessage;
                if (typedMessage.type === 'response' || typedMessage.type === 'ping') continue;
                if (typedMessage.type && typedMessage.type !== 'price_update') continue;

                const container = typedMessage.price_feed ?? typedMessage;
                const feedId = this.normalizeFeedId(String(container?.id ?? typedMessage.id ?? ''));
                const parsed = this.parsePricePayload(container?.price ?? typedMessage.price);
                if (!feedId || parsed === null) continue;
                this.priceCache.set(feedId, parsed);
            }
        } catch {
            // Ignore keepalive, malformed, or non-JSON payloads.
        }
    }

    private parsePricePayload(pricePayload: unknown): number | null {
        if (!pricePayload || typeof pricePayload !== 'object') return null;
        const payload = pricePayload as PythPricePayload;
        if (payload.price === undefined || payload.expo === undefined) return null;
        try {
            const priceBig = BigInt(String(payload.price));
            const expoNum = Number(payload.expo);
            if (!Number.isFinite(expoNum)) return null;
            const decimalPrice = this.toDecimalString(priceBig, expoNum);
            const parsed = Number(decimalPrice);
            return Number.isFinite(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    private getHttpEndpoint(): string {
        const endpoint = this.endpoint.replace(/^wss?:\/\//, 'https://');
        return endpoint.replace(/\/ws\/?$/, '');
    }

    private normalizeFeedId(feedId: string): string {
        return String(feedId).toLowerCase().replace(/^0x/, '');
    }

    private scheduleReconnect() {
        if (this.disposed || this.reconnectTimer) return;
        const baseDelayMs = 1000;
        const maxDelayMs = 30000;
        const expDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, this.reconnectAttempts)));
        const jitter = Math.floor(Math.random() * 500);
        const delay = expDelay + jitter;
        this.reconnectAttempts += 1;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);

        if (this.reconnectTimer && typeof (this.reconnectTimer as NodeJS.Timeout & { unref?: () => void }).unref === 'function') {
            (this.reconnectTimer as NodeJS.Timeout & { unref?: () => void }).unref?.();
        }
    }

    public dispose() {
        this.disposed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
    }

    private getDefaultFeedId(symbol: 'BNB' | 'USDT'): string {
        switch (symbol) {
            case 'BNB': return '2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f';
            case 'USDT': return '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b';
            default: throw new Error(`Unknown symbol for Pyth: ${symbol}`);
        }
    }
}
