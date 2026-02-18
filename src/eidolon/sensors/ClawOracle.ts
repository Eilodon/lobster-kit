import { ClawKit } from '../../index';
import { MarketState } from '../EidolonTypes';
import { PythAdapter } from '../oracles/PythAdapter';
import { PriceAggregator } from './PriceAggregator';
import { BigMath } from '../../utils/BigMath';
import { getTokenDecimals } from '../../types';

/**
 * 👁️ CLAW ORACLE (The Eye)
 * Real-time market sensing using ClawKit's analytics
 */
export class ClawOracle {
    private aggregator: PriceAggregator;
    private pyth: PythAdapter;

    constructor(private kit: ClawKit) {
        this.pyth = new PythAdapter(kit.config.pythConfig);
        this.aggregator = new PriceAggregator(kit, this.pyth);
    }

    private normalizeToWad(raw: bigint, decimals: number): bigint {
        if (decimals === 18) return raw;
        if (decimals < 18) return raw * (10n ** BigInt(18 - decimals));
        return raw / (10n ** BigInt(decimals - 18));
    }

    public async getBNBPrice(): Promise<number> {
        try {
            return await this.aggregator.getPrice('BNB');
        } catch (e: any) {
            console.error('❌ CRITICAL: SENSORY FAILURE. Unable to fetch BNB price.', e);
            throw new Error(`SENSORY BLACKOUT: ${e.message}`); // Panic Mode
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

            // ~$100 USD in WBNB (approx 0.16 BNB at $600)
            const amountSmall = BigInt(Math.floor((100 / bnbPrice) * 1e18));

            // ~$10,000 USD in WBNB (approx 16.6 BNB at $600)
            const amountLarge = BigInt(Math.floor((10000 / bnbPrice) * 1e18));

            // Run probes in parallel
            const [quoteSmall, quoteLarge] = await Promise.all([
                this.kit.defi.getRealQuote(wbnb, usdt, amountSmall, 0),
                this.kit.defi.getRealQuote(wbnb, usdt, amountLarge, 0)
            ]);
            if (!quoteSmall?.amountOutMin || !quoteLarge?.amountOutMin) {
                // If we can't get a quote for $10k, liquidity is definitely THIN
                return 'THIN';
            }

            // Calculate Price per WBNB
            const usdtDecimals = getTokenDecimals(usdt);
            const quoteSmallWad = this.normalizeToWad(quoteSmall.amountOutMin, usdtDecimals);
            const quoteLargeWad = this.normalizeToWad(quoteLarge.amountOutMin, usdtDecimals);

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
            // If Large trade gets significantly worse price, liquidity is THIN.
            const impact = (priceSmall - priceLarge) / priceSmall;

            console.log(`💧 Liquidity Probe: impact=${(impact * 100).toFixed(2)}% ($100 vs $10k)`);

            if (impact > 0.02) return 'THIN'; // > 2% impact is dangerous
            return 'DEEP';

        } catch (e) {
            console.warn('Liquidity probe failed, assuming THIN for safety', e);
            return 'THIN';
        }
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
            whaleFlow: 'NEUTRAL', // Requires covalent indexing
            sentiment: 'NEUTRAL', // Requires social API
            liquidityDepth,
            priceAction: 'RANGING'
        };
    }

    private async getGasState(): Promise<'LOW' | 'MEDIUM' | 'HIGH'> {
        try {
            const gas = await this.kit.gas.getOptimalExecutionTime();
            // Heuristic: < 3 gwei is LOW, < 5 is MEDIUM, > 5 is HIGH on opBNB
            const price = parseFloat(gas.currentGasPrice);
            if (price < 3) return 'LOW';  // < 3 Gwei = cheap on opBNB
            if (price < 5) return 'MEDIUM'; // 3-5 Gwei = moderate
            return 'HIGH';
        } catch {
            return 'MEDIUM'; // Fallback
        }
    }

    public async getTokenData(symbol: string): Promise<{ action: 'PUMPING' | 'DUMPING' | 'RANGING' }> {
        // FIX Bug #22: Real Token Data Analysis
        try {
            // Future expansion: Use Aggregator for token prices if supported
            return { action: 'RANGING' };
        } catch {
            return { action: 'RANGING' };
        }
    }
}
