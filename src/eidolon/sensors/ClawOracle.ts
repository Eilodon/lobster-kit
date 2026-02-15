import { ClawKit } from '../../index';
import { MarketState } from '../EidolonTypes';
import { PythAdapter } from '../oracles/PythAdapter';

/**
 * 👁️ CLAW ORACLE (The Eye)
 * Real-time market sensing using ClawKit's analytics
 */
export class ClawOracle {
    private pyth: PythAdapter;

    constructor(private kit: ClawKit) {
        this.pyth = new PythAdapter(kit.config.pythConfig);
    }

    public async getBNBPrice(): Promise<number> {
        try {
            const price = await this.pyth.getPrice('BNB');
            return price;
        } catch (e) {
            console.error('❌ CRITICAL: SENSORY FAILURE. Unable to fetch BNB price.', e);
            throw new Error('SENSORY BLACIOUT: Cannot operate without price feed.'); // Panic Mode
        }
    }


    /**
     * 💧 ACTIVE LIQUIDITY PROBING
     * Compares execution price of $100 vs $10,000 to detect thin books.
     */
    private async probeLiquidity(bnbPrice: number): Promise<'THIN' | 'DEEP'> {
        try {
            const wbnb = 'WBNB';
            const usdt = 'USDT';

            // ~$100 USD in WBNB (approx 0.16 BNB at $600)
            const amountSmall = BigInt(Math.floor((100 / bnbPrice) * 1e18));

            // ~$10,000 USD in WBNB (approx 16.6 BNB at $600)
            const amountLarge = BigInt(Math.floor((10000 / bnbPrice) * 1e18));

            // Run probes in parallel
            const [quoteSmall, quoteLarge] = await Promise.all([
                this.kit.defi.getRealQuote(wbnb, usdt, amountSmall, 1.0),
                this.kit.defi.getRealQuote(wbnb, usdt, amountLarge, 2.0)
            ]);

            // Calculate Price per WBNB
            const priceSmall = Number(quoteSmall) / Number(amountSmall); // USDT per Wei
            const priceLarge = Number(quoteLarge) / Number(amountLarge);

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
            if (price < 0.00003) return 'LOW'; // opBNB is very cheap, adjusting scale
            if (price < 0.00005) return 'MEDIUM';
            return 'HIGH';
        } catch {
            return 'MEDIUM'; // Fallback
        }
    }

    private async getTokenData(symbol: string): Promise<{ action: 'PUMPING' | 'DUMPING' | 'RANGING' }> {
        return { action: 'RANGING' };
    }
}
