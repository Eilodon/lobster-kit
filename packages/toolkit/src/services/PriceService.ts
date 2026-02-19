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
 *   4. Binance API (primary)
 *   5. Binance API (mirror endpoint)
 *   6. Stale cache fallback (last known good)
 *   7. Configured fallback price
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
        if (entry && Date.now() < entry.expiresAt && this.isSanePrice(entry.value)) return entry.value;
        return undefined;
    }

    private getStaleCached(key: string): number | undefined {
        const entry = this.cache.get(key);
        if (entry && this.isSanePrice(entry.value)) return entry.value;
        return undefined;
    }

    private setCached(key: string, value: number): void {
        if (!this.isSanePrice(value)) return;
        this.cache.set(key, { value, expiresAt: Date.now() + this.TTL_MS });
    }

    private isSanePrice(value: unknown): value is number {
        return typeof value === 'number'
            && Number.isFinite(value)
            && value > 0
            && value <= 100_000;
    }

    private getConfiguredFallbackBNBPrice(): number | undefined {
        const fallback = this.config.fallbackBNBPrice;
        if (this.isSanePrice(fallback)) return fallback;
        return undefined;
    }

    // ── BNB Price ───────────────────────────────────────────────────────────────

    async getBNBPrice(): Promise<number> {
        const key = 'BNB';
        const cached = this.getCached(key);
        if (cached !== undefined) return cached;
        const staleCached = this.getStaleCached(key);

        // Try oracle first
        if (this.oracle) {
            try {
                const prices = await this.oracle.fetchTokenPrices();
                const price = prices['BNB'] ?? prices['WBNB'];
                if (this.isSanePrice(price)) {
                    this.setCached(key, price);
                    return price;
                }
            } catch { /* fall through */ }
        }

        const configuredFallback = this.getConfiguredFallbackBNBPrice();
        const isStrict = this.config.privacyMode === 'strict';
        if (isStrict) {
            if (staleCached !== undefined) {
                console.warn(`⚠️ [PriceService] Strict mode using stale BNB cache: $${staleCached.toFixed(2)}`);
                return staleCached;
            }
            if (configuredFallback !== undefined) {
                console.warn(`⚠️ [PriceService] Strict mode using configured BNB fallback: $${configuredFallback.toFixed(2)}`);
                this.setCached(key, configuredFallback);
                return configuredFallback;
            }
            throw new Error('🔒 Cannot fetch BNB price: strict privacy mode requires an internal oracle.');
        }

        const gateway = getGateway(this.config);

        // CoinGecko
        try {
            const data = await gateway.get<{ binancecoin?: { usd?: number } }>(
                'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd'
            );
            const price = data?.binancecoin?.usd;
            if (this.isSanePrice(price)) {
                this.setCached(key, price);
                console.info(`✅ [PriceService] BNB from CoinGecko: $${price.toFixed(2)}`);
                return price;
            }
        } catch { /* fall through to Binance */ }

        // Binance primary fallback
        try {
            const data = await gateway.get<{ price?: string }>(
                'https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT'
            );
            const price = Number.parseFloat(data?.price ?? '');
            if (this.isSanePrice(price)) {
                this.setCached(key, price);
                console.info(`✅ [PriceService] BNB from Binance: $${price.toFixed(2)}`);
                return price;
            }
        } catch { /* fall through */ }

        // Binance mirror fallback (often survives regional/API hiccups)
        try {
            const data = await gateway.get<{ price?: string }>(
                'https://data-api.binance.vision/api/v3/ticker/price?symbol=BNBUSDT'
            );
            const price = Number.parseFloat(data?.price ?? '');
            if (this.isSanePrice(price)) {
                this.setCached(key, price);
                console.info(`✅ [PriceService] BNB from Binance Vision: $${price.toFixed(2)}`);
                return price;
            }
        } catch { /* fall through */ }

        if (staleCached !== undefined) {
            console.warn(`⚠️ [PriceService] Using stale BNB cache after live-source failure: $${staleCached.toFixed(2)}`);
            return staleCached;
        }

        if (configuredFallback !== undefined) {
            console.warn(`⚠️ [PriceService] Using configured BNB fallback: $${configuredFallback.toFixed(2)}`);
            this.setCached(key, configuredFallback);
            return configuredFallback;
        }

        // 🛡️ Pyth Network (Hermes) - Real-time Oracle
        try {
            // Price ID for BNB/USD: 2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f
            const pythPrice = await this.fetchPythPrice('2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f');
            if (this.isSanePrice(pythPrice)) {
                this.setCached(key, pythPrice);
                console.info(`✅ [PriceService] BNB from Pyth Hermes: $${pythPrice.toFixed(2)}`);
                return pythPrice;
            }
        } catch (err: any) {
            console.warn(`[PriceService] Pyth Hermes failed: ${err.message}`);
        }

        throw new Error('PriceService: All BNB price sources failed');
    }

    // ── Pyth Network Integration ───────────────────────────────────────────────

    private async fetchPythPrice(priceId: string): Promise<number> {
        const gateway = getGateway(this.config);
        const data = await gateway.get<any>(
            `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${priceId}`
        );

        // Hermes V2 structure: { parsed: [ { price: { price: "...", expo: -8 } } ] }
        const priceData = data?.parsed?.[0]?.price;
        if (!priceData) throw new Error('No price data from Pyth');

        const rawPrice = Number(priceData.price);
        const expo = priceData.expo;
        return rawPrice * Math.pow(10, expo);
    }

    // ── Address-based Price (DexScreener) ──────────────────────────────────────

    /**
     * Fetch token price by contract address using DexScreener
     * Essential for long-tail tokens not on CoinGecko.
     */
    async getTokenPriceByAddress(address: string): Promise<number> {
        const key = `addr:${address.toLowerCase()}`;
        const cached = this.getCached(key);
        if (cached !== undefined) return cached;

        const isStrict = this.config.privacyMode === 'strict';
        if (isStrict) return 0; // Strict mode: no external calls

        // Try internal oracle first (stub for now, assuming oracle uses symbols mostly)

        // DexScreener
        try {
            const gateway = getGateway(this.config);
            const data = await gateway.get<{ pairs?: [{ priceUsd?: string }] }>(
                `https://api.dexscreener.com/latest/dex/tokens/${address}`
            );

            // Get the first pair (usually highest liquidity)
            const priceStr = data?.pairs?.[0]?.priceUsd;
            const price = priceStr ? parseFloat(priceStr) : 0;

            if (this.isSanePrice(price)) {
                this.setCached(key, price);
                // Also cache by symbol if possble, but we don't have symbol here easily without parsing
                return price;
            }
        } catch (err) {
            console.warn(`[PriceService] DexScreener failed for ${address}:`, err);
        }

        return 0;
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
