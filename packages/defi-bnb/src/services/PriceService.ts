/**
 * 💰 SHARED PRICE SERVICE
 *
 * Single source of truth for token prices across all modules.
 * Replaces scattered CoinGecko/Binance calls in Gas, DeFi, Analytics, Security.
 *
 * Sources (in priority order):
 *   1. Internal oracle (for strict privacy mode)
 *   2. In-memory TTL cache (60s)
 *   3. CoinGecko API
 *   4. Binance API fallback
 *
 * Usage:
 *   import { getPriceService } from './PriceService';
 *   const svc = getPriceService(config);
 *   const bnbPrice = await svc.getBNBPrice();
 */

import { ClawKitConfig } from '../types';
import { getGateway } from '../utils/ApiGateway';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PriceOracle {
    fetchTokenPrices(): Promise<Record<string, number>>;
}

interface CacheEntry {
    value: number;
    expiresAt: number;
}

// ─── PriceService ─────────────────────────────────────────────────────────────

export class PriceService {
    private readonly TTL_MS = 60_000; // 60 second cache
    private cache = new Map<string, CacheEntry>();
    private oracle?: PriceOracle;

    constructor(private config: ClawKitConfig) { }

    // ── Oracle injection (for privacy mode / testing) ───────────────────────────

    setOracle(oracle: PriceOracle): void {
        this.oracle = oracle;
    }

    // ── Cache helpers ───────────────────────────────────────────────────────────

    private getCached(key: string): number | undefined {
        const entry = this.cache.get(key);
        if (entry && Date.now() < entry.expiresAt) return entry.value;
        return undefined;
    }

    private setCached(key: string, value: number): void {
        this.cache.set(key, { value, expiresAt: Date.now() + this.TTL_MS });
    }

    // ── BNB Price ───────────────────────────────────────────────────────────────

    async getBNBPrice(): Promise<number> {
        const key = 'BNB';
        const cached = this.getCached(key);
        if (cached !== undefined) return cached;

        // Try oracle first
        if (this.oracle) {
            try {
                const prices = await this.oracle.fetchTokenPrices();
                if (prices['BNB'] || prices['WBNB']) {
                    const price = prices['BNB'] ?? prices['WBNB'];
                    this.setCached(key, price);
                    return price;
                }
            } catch { /* fall through */ }
        }

        const isStrict = this.config.privacyMode === 'strict';
        if (isStrict) {
            throw new Error('🔒 Cannot fetch BNB price: strict privacy mode requires an internal oracle.');
        }

        const gateway = getGateway(this.config);

        // CoinGecko
        try {
            const data = await gateway.get<{ binancecoin: { usd: number } }>(
                'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd'
            );
            const price = data.binancecoin.usd;
            this.setCached(key, price);
            console.info(`✅ [PriceService] BNB from CoinGecko: $${price}`);
            return price;
        } catch { /* fall through to Binance */ }

        // Binance fallback
        try {
            const data = await gateway.get<{ price: string }>(
                'https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT'
            );
            const price = parseFloat(data.price);
            this.setCached(key, price);
            console.info(`✅ [PriceService] BNB from Binance: $${price.toFixed(2)}`);
            return price;
        } catch { /* fall through */ }

        throw new Error('PriceService: All BNB price sources failed');
    }

    // ── Multi-token prices ──────────────────────────────────────────────────────

    async fetchMultiplePrices(symbols: string[]): Promise<Record<string, number>> {
        const results: Record<string, number> = {};

        // Try oracle first
        if (this.oracle) {
            try {
                const oraclePrices = await this.oracle.fetchTokenPrices();
                for (const sym of symbols) {
                    if (oraclePrices[sym] !== undefined) results[sym] = oraclePrices[sym];
                }
                if (Object.keys(results).length === symbols.length) return results;
            } catch { /* fall through */ }
        }

        // CoinGecko IDs mapping
        const geckoIdMap: Record<string, string> = {
            BNB: 'binancecoin',
            WBNB: 'wbnb',
            USDT: 'tether',
            USDC: 'usd-coin',
            CAKE: 'pancakeswap-token',
            ETH: 'ethereum',
            BTC: 'bitcoin',
        };

        const missing = symbols.filter(s => !(s in results));
        if (missing.length === 0) return results;

        const ids = missing.map(s => geckoIdMap[s]).filter(Boolean).join(',');
        if (!ids) return results;

        const isStrict = this.config.privacyMode === 'strict';
        if (isStrict) return results; // Return partial results in strict mode

        const gateway = getGateway(this.config);

        try {
            const data = await gateway.get<Record<string, { usd: number }>>(
                `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
            );

            for (const sym of missing) {
                const id = geckoIdMap[sym];
                if (id && data[id]) {
                    const price = data[id].usd;
                    results[sym] = price;
                    this.setCached(sym, price);
                }
            }
        } catch (err) {
            console.warn('[PriceService] Multi-price fetch failed:', err);
        }

        return results;
    }

    // ── Single token ────────────────────────────────────────────────────────────

    async getTokenPrice(symbol: string): Promise<number> {
        const cached = this.getCached(symbol);
        if (cached !== undefined) return cached;

        const prices = await this.fetchMultiplePrices([symbol]);
        return prices[symbol] ?? 0;
    }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

const serviceCache = new WeakMap<ClawKitConfig, PriceService>();

export function getPriceService(config: ClawKitConfig): PriceService {
    if (!serviceCache.has(config)) {
        serviceCache.set(config, new PriceService(config));
    }
    return serviceCache.get(config)!;
}
