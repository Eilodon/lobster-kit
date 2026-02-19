import { IClawKit, EidolonBus, EidolonEventType, PythConfig } from '@clawkit/core';
import type { EidolonEvent } from '@clawkit/core';
import { MarketState } from '@clawkit/core';
import { PythAdapter } from '../oracles/PythAdapter';
import { PriceAggregator } from './PriceAggregator';
import { BigMath } from '@clawkit/core';
import { getTokenDecimals } from '@clawkit/core';

/**
 * 👁️ CLAW ORACLE (The Eye)
 * Real-time market sensing using IClawKit's analytics
 */
export class ClawOracle {
    private aggregator: PriceAggregator;
    private pyth: PythAdapter;
    private bus: EidolonBus;

    // 🌊 Sensory Memory
    private readonly LIQUIDITY_IMPACT_THRESHOLD = 0.02; // 2%
    private whaleMemory: { time: number; amount: number; action: 'BUY' | 'SELL' }[] = [];
    private priceHistory: { time: number; price: number }[] = [];
    private readonly MEMORY_TTL = 300000; // 5 minutes

    constructor(private kit: IClawKit) {
        const maybePythConfig = kit.config.pythConfig;
        const pythConfig = (maybePythConfig && typeof maybePythConfig === 'object')
            ? maybePythConfig as PythConfig
            : undefined;
        this.pyth = new PythAdapter(pythConfig);
        this.aggregator = new PriceAggregator(kit, this.pyth);
        this.bus = EidolonBus.getInstance();

        // 🎧 Listen for Whales
        this.bus.subscribe(EidolonEventType.WHALE_MOVEMENT, (event: EidolonEvent) => {
            if (event.type !== EidolonEventType.WHALE_MOVEMENT) return;
            if (!event.payload || typeof event.payload !== 'object') return;
            const payload = event.payload as { amountUSD?: unknown; action?: unknown };
            const amountUSD = typeof payload.amountUSD === 'number' ? payload.amountUSD : NaN;
            const action = payload.action === 'BUY' || payload.action === 'SELL' ? payload.action : null;
            if (!Number.isFinite(amountUSD) || !action) return;
            this.whaleMemory.push({
                time: event.timestamp,
                amount: amountUSD,
                action
            });
            this.pruneMemory();
        });
    }

    private pruneMemory() {
        const now = Date.now();
        this.whaleMemory = this.whaleMemory.filter(m => (now - m.time) < this.MEMORY_TTL);
        this.priceHistory = this.priceHistory.filter(h => (now - h.time) < this.MEMORY_TTL);
    }

    private normalizeToWad(raw: bigint, decimals: number): bigint {
        if (decimals === 18) return raw;
        if (decimals < 18) return raw * (10n ** BigInt(18 - decimals));
        return raw / (10n ** BigInt(decimals - 18));
    }

    private extractAmountOutMin(quote: Record<string, unknown>): bigint | null {
        const value = quote.amountOutMin;
        return typeof value === 'bigint' ? value : null;
    }

    public async getBNBPrice(): Promise<number> {
        try {
            return await this.aggregator.getPrice('BNB');
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error('❌ CRITICAL: SENSORY FAILURE. Unable to fetch BNB price.', e);
            throw new Error(`SENSORY BLACKOUT: ${message}`); // Panic Mode
        }
    }

    /**
     * 💧 ACTIVE LIQUIDITY PROBING
     * Compares execution price of $100 vs $10,000 to detect thin books.
     */
    private async probeLiquidity(bnbPrice: number): Promise<'THIN' | 'DEEP'> {
        try {
            if (!Number.isFinite(bnbPrice) || bnbPrice <= 0) {
                return 'THIN';
            }
            const wbnb = 'WBNB';
            const usdt = 'USDT';

            // ~$100 USD in WBNB
            const amountSmall = BigInt(Math.floor((100 / bnbPrice) * 1e18));

            // ~$10,000 USD in WBNB
            const amountLarge = BigInt(Math.floor((10000 / bnbPrice) * 1e18));

            // Run probes in parallel
            if (!this.kit.defi.getRealQuote) return 'THIN';
            const [quoteSmall, quoteLarge] = await Promise.all([
                this.kit.defi.getRealQuote(wbnb, usdt, amountSmall, 0),
                this.kit.defi.getRealQuote(wbnb, usdt, amountLarge, 0)
            ]);
            const quoteSmallOut = quoteSmall ? this.extractAmountOutMin(quoteSmall) : null;
            const quoteLargeOut = quoteLarge ? this.extractAmountOutMin(quoteLarge) : null;
            if (!quoteSmallOut || !quoteLargeOut) {
                return 'THIN';
            }

            // Calculate Price per WBNB
            const usdtDecimals = getTokenDecimals(usdt);
            const quoteSmallWad = this.normalizeToWad(quoteSmallOut, usdtDecimals);
            const quoteLargeWad = this.normalizeToWad(quoteLargeOut, usdtDecimals);

            // Human price ratio: (USDT out) / (WBNB in), both normalized to WAD.
            const priceSmall = BigMath.unitsToNumber(
                BigMath.divWad(quoteSmallWad, amountSmall),
                18
            );
            const priceLarge = BigMath.unitsToNumber(
                BigMath.divWad(quoteLargeWad, amountLarge),
                18
            );
            if (!Number.isFinite(priceSmall) || !Number.isFinite(priceLarge) || priceSmall <= 0 || priceLarge <= 0) {
                return 'THIN';
            }

            // Calculate Impact: (Small - Large) / Small
            const impact = (priceSmall - priceLarge) / priceSmall;

            // console.log(`💧 Liquidity Probe: impact=${(impact * 100).toFixed(2)}% ($100 vs $10k)`);

            if (impact > this.LIQUIDITY_IMPACT_THRESHOLD) return 'THIN'; // > 2% impact is dangerous
            return 'DEEP';

        } catch {
            // console.warn('Liquidity probe failed, assuming THIN for safety', e);
            return 'THIN';
        }
    }

    private getWhaleFlow(): 'ACCUMULATING' | 'DUMPING' | 'NEUTRAL' {
        this.pruneMemory();
        if (this.whaleMemory.length === 0) return 'NEUTRAL';

        let netFlow = 0;
        for (const m of this.whaleMemory) {
            if (m.action === 'BUY') netFlow += m.amount;
            else netFlow -= m.amount;
        }

        if (netFlow > 100000) return 'ACCUMULATING'; // > +$100k
        if (netFlow < -100000) return 'DUMPING';     // < -$100k
        return 'NEUTRAL';
    }

    private getPriceAction(currentPrice: number): 'PUMPING' | 'DUMPING' | 'RANGING' {
        this.priceHistory.push({ time: Date.now(), price: currentPrice });
        this.pruneMemory();

        if (this.priceHistory.length < 2) return 'RANGING';

        const oldPrice = this.priceHistory[0].price; // Oldest in window (max 5m)
        const change = (currentPrice - oldPrice) / oldPrice;

        if (change > 0.02) return 'PUMPING'; // > +2%
        if (change < -0.02) return 'DUMPING'; // < -2%
        return 'RANGING';
    }

    public async sense(): Promise<MarketState> {
        // 1. Get Base Data
        const bnbPrice = await this.getBNBPrice();

        // 2. Parallel Sense
        const [gasState, liquidityDepth] = await Promise.all([
            this.getGasState(),
            this.probeLiquidity(bnbPrice)
        ]);

        return {
            gasPrice: gasState,
            whaleFlow: this.getWhaleFlow(),
            sentiment: 'NEUTRAL', // Still requires social API
            liquidityDepth,
            priceAction: this.getPriceAction(bnbPrice)
        };
    }

    private async getGasState(): Promise<'LOW' | 'MEDIUM' | 'HIGH'> {
        try {
            if (!this.kit.gas.getOptimalExecutionTime) return 'MEDIUM';
            const gas = await this.kit.gas.getOptimalExecutionTime();
            const currentGasPrice = typeof gas.currentGasPrice === 'string' || typeof gas.currentGasPrice === 'number'
                ? String(gas.currentGasPrice)
                : '';
            if (!currentGasPrice) return 'MEDIUM';
            // Heuristic: < 3 gwei is LOW, < 5 is MEDIUM, > 5 is HIGH on opBNB
            const price = parseFloat(currentGasPrice);
            if (price < 3) return 'LOW';  // < 3 Gwei = cheap on opBNB
            if (price < 5) return 'MEDIUM'; // 3-5 Gwei = moderate
            return 'HIGH';
        } catch {
            return 'MEDIUM'; // Fallback
        }
    }

    public async getTokenData(symbol: string): Promise<{ action: 'PUMPING' | 'DUMPING' | 'RANGING' }> {
        // FIX Bug #22: Real Token Data Analysis (Simplified)
        try {
            // For now, return global price action as proxy if it's BNB, otherwise RANGING.
            // Future: Maintain per-token history
            if (symbol === 'BNB' || symbol === 'WBNB') {
                // We don't have price here easily without fetching, so just return default.
                // Ideally we'd fetch price and compare.
                return { action: 'RANGING' };
            }
            return { action: 'RANGING' };
        } catch {
            return { action: 'RANGING' };
        }
    }
}
