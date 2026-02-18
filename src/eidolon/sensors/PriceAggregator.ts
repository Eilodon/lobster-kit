import axios from 'axios';
import { PythAdapter } from '../oracles/PythAdapter';
import { ClawKit } from '../../index';
import { getTokenDecimals } from '../../types';
import { formatUnits } from 'viem';

export interface PriceSource {
    name: string;
    price: number;
    weight: number; // 0-1 confidence
}

export class PriceAggregator {
    constructor(
        private kit: ClawKit,
        private pyth: PythAdapter
    ) { }

    /**
     * Get the consensus price from multiple sources.
     * Sources:
     * 1. Pyth (Oracle) - Primary, High confidence
     * 2. Binance (CEX) - Secondary, High liquidity reference
     * 3. On-Chain (DEX) - Reality check
     */
    public async getPrice(symbol: 'BNB' | 'USDT'): Promise<number> {
        const results = await Promise.allSettled([
            this.getPythPrice(symbol),
            this.getBinancePrice(symbol),
            this.getDexPrice(symbol)
        ]);

        const sources: PriceSource[] = [];

        // Parse Pyth
        if (results[0].status === 'fulfilled') {
            sources.push({ name: 'Pyth', price: results[0].value, weight: 1.0 });
        } else {
            console.warn(`⚠️ PriceAggregator: Pyth failed for ${symbol}`, results[0].reason);
        }

        // Parse Binance
        if (results[1].status === 'fulfilled') {
            sources.push({ name: 'Binance', price: results[1].value, weight: 0.8 });
        } else {
            console.warn(`⚠️ PriceAggregator: Binance failed for ${symbol}`, results[1].reason);
        }

        // Parse DEX
        if (results[2].status === 'fulfilled') {
            sources.push({ name: 'DEX', price: results[2].value, weight: 0.5 }); // Lower weight due to manipulation risk
        } else {
            console.warn(`⚠️ PriceAggregator: DEX failed for ${symbol}`, results[2].reason);
        }

        if (sources.length === 0) {
            throw new Error(`CRITICAL: All price sources failed for ${symbol}`);
        }

        return this.calculateConsensus(sources);
    }

    private async getPythPrice(symbol: 'BNB' | 'USDT'): Promise<number> {
        return this.pyth.getPrice(symbol);
    }

    private async getBinancePrice(symbol: 'BNB' | 'USDT'): Promise<number> {
        // Mapping format: BNB -> BNBUSDT
        let pair = `${symbol}USDT`;
        if (symbol === 'USDT') return 1.0; // Base

        try {
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, { timeout: 3000 });
            return parseFloat(res.data.price);
        } catch (e: any) {
            throw new Error(`Binance API error: ${e.message}`);
        }
    }

    private async getDexPrice(symbol: 'BNB' | 'USDT'): Promise<number> {
        if (symbol === 'USDT') return 1.0;

        // 1 WBNB -> USDT
        const oneUnit = 1000000000000000000n; // 1e18
        const wbnb = 'WBNB';
        const usdt = 'USDT';

        const quote = await this.kit.defi.getRealQuote(wbnb, usdt, oneUnit, 0);
        if (!quote?.amountOutMin) throw new Error('No DEX liquidity');

        const usdtDecimals = getTokenDecimals('USDT');
        return Number(formatUnits(quote.amountOutMin, usdtDecimals));
    }

    private calculateConsensus(sources: PriceSource[]): number {
        // 1. Sort by price
        const sorted = sources.sort((a, b) => a.price - b.price);

        // 2. Median calculation
        let medianPrice = 0;
        if (sorted.length % 2 === 1) {
            medianPrice = sorted[Math.floor(sorted.length / 2)].price;
        } else {
            const mid = sorted.length / 2;
            medianPrice = (sorted[mid - 1].price + sorted[mid].price) / 2;
        }

        // 3. Divergence Check
        // If any source deviates > 5% from median, flag it.
        // If > 20%, KILL SWITCH.
        const MAX_DEV = 0.05;
        const CRITICAL_DEV = 0.20;

        for (const s of sources) {
            const dev = Math.abs(s.price - medianPrice) / medianPrice;
            if (dev > CRITICAL_DEV) {
                throw new Error(`CRITICAL_ORACLE_DIVERGENCE: Source ${s.name} ($${s.price}) deviates ${(dev * 100).toFixed(1)}% from median ($${medianPrice})`);
            }
            if (dev > MAX_DEV) {
                console.warn(`⚠️ PRICE DIVERGENCE: Source ${s.name} ($${s.price}) deviates ${(dev * 100).toFixed(1)}% from median ($${medianPrice})`);
            }
        }

        // 4. Weighted Average as backup? No, Median is safer against flash loan attacks.
        // However, if we only have 2 sources and they differ, we trust the one with higher weight.
        if (sources.length === 2 && Math.abs(sources[0].price - sources[1].price) / sources[0].price > MAX_DEV) {
            // Trust higher weight
            const winner = sources.reduce((prev, current) => (prev.weight > current.weight) ? prev : current);
            console.warn(`⚠️ Trusting ${winner.name} due to divergence`);
            return winner.price;
        }

        return medianPrice;
    }
}
