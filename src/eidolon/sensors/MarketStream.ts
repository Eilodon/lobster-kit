import { PublicClient, WatchBlocksParameters, Block } from 'viem';
import { MarketState } from '../EidolonTypes';
import { EidolonBus, EidolonEventType } from '../events/EidolonBus';

/**
 * 📡 MARKET STREAM SENSOR
 * "The Ears of the Citadel"
 * 
 * listens to the heartbeat of the blockchain (New Blocks).
 * Derives market state from block metrics in real-time.
 */

type MarketUpdateCallback = (state: MarketState) => void;

export class MarketStream {
    private client: PublicClient;
    private unwatch: (() => void) | null = null;
    private callbacks: MarketUpdateCallback[] = [];
    private bus: EidolonBus;

    // State buffer
    private lastGasPrices: bigint[] = [];
    private lastTxCounts: number[] = [];

    constructor(client: PublicClient) {
        this.client = client;
        this.bus = EidolonBus.getInstance();
    }

    /**
     * Start listening to the blockchain
     */
    public start() {
        if (this.unwatch) return; // Already watching

        console.log('📡 MarketStream: Connecting to block feed...');

        this.unwatch = this.client.watchBlocks({
            onBlock: (block) => this.processBlock(block),
            onError: (err) => console.error('MarketStream Error:', err)
        });
    }

    /**
     * Stop listening
     */
    public stop() {
        if (this.unwatch) {
            this.unwatch();
            this.unwatch = null;
            console.log('📡 MarketStream: Disconnected.');
        }
    }

    /**
     * Subscribe to updates
     */
    public subscribe(callback: MarketUpdateCallback) {
        this.callbacks.push(callback);
    }

    private processBlock(block: Block) {
        // 1. Emit Heartbeat Event
        this.bus.emitEvent({
            type: EidolonEventType.BLOCK_MINED,
            timestamp: Date.now(),
            payload: {
                blockNumber: block.number,
                hash: block.hash,
                timestamp: block.timestamp
            }
        });

        // 2. Extract Metrics
        const gasUsed = block.gasUsed;
        const gasLimit = block.gasLimit;
        const baseFee = block.baseFeePerGas || 0n;
        const txCount = block.transactions.length;

        // 3. Update Buffers (Rolling Window of ~10 blocks)
        if (baseFee > 0n) this.lastGasPrices.push(baseFee);
        else this.lastGasPrices.push(1000000000n); // Default 1 gwei if no baseFee (L2)

        this.lastTxCounts.push(txCount);

        if (this.lastGasPrices.length > 10) this.lastGasPrices.shift();
        if (this.lastTxCounts.length > 10) this.lastTxCounts.shift();

        // 4. Derive Market State
        // FIX Bug #20: Real Heuristics
        const gasState = this.deriveGasState();
        const priceAction = this.derivePriceAction(); // U2
        const whaleFlow = this.deriveWhaleFlow(block); // U2

        const newState: MarketState = {
            gasPrice: gasState,
            whaleFlow: whaleFlow,
            sentiment: this.deriveSentiment(txCount),
            liquidityDepth: 'DEEP', // Still hard to judge without Depth Chart
            priceAction: priceAction
        };

        // 5. Notify Listeners
        this.notify(newState);

        // FIX L13: Emit OPPORTUNITY event
        if (newState.sentiment === 'FEAR' || newState.sentiment === 'EUPHORIC') {
            this.bus.emitEvent({
                type: EidolonEventType.OPPORTUNITY,
                timestamp: Date.now(),
                payload: {
                    type: newState.sentiment === 'FEAR' ? 'BUY_DIP' : 'SELL_TOP',
                    reason: `Market Sentiment is ${newState.sentiment} (GasTrend: ${(this.getLastGasTrend() * 100).toFixed(1)}%)`,
                    confidence: 80
                }
            });
        }
    }

    private getLastGasTrend(): number {
        if (this.lastGasPrices.length < 5) return 0;
        const currentGas = this.lastGasPrices[this.lastGasPrices.length - 1];
        const prevGas = this.lastGasPrices[this.lastGasPrices.length - 5];
        return Number(currentGas - prevGas) / Number(prevGas);
    }

    private deriveGasState(): 'LOW' | 'MEDIUM' | 'HIGH' {
        if (this.lastGasPrices.length < 2) return 'MEDIUM';

        const current = this.lastGasPrices[this.lastGasPrices.length - 1];
        const avg = this.lastGasPrices.reduce((a, b) => a + b, 0n) / BigInt(this.lastGasPrices.length);

        // Fixed heuristic for opBNB (very cheap gas)
        if (current > avg * 120n / 100n) return 'HIGH'; // +20% surge
        if (current < avg * 80n / 100n) return 'LOW';   // -20% drop
        return 'MEDIUM';
    }

    // FIX U2: Implement Price Action from Gas/Activity Proxy (as requested)
    private derivePriceAction(): 'PUMPING' | 'DUMPING' | 'RANGING' {
        if (this.lastGasPrices.length < 5) return 'RANGING';

        // Proxy: Gas Price often correlates with Price Action volatility
        // Rising Gas + High Tx = Pumping or Dumping. 
        // We need a direction. Without price feed, we assume:
        // - Steady rise = Accumulation/Pumping
        // - Sharp spike = Panic/Dumping

        const current = Number(this.lastGasPrices[this.lastGasPrices.length - 1]);
        const prev = Number(this.lastGasPrices[this.lastGasPrices.length - 5]);
        const change = (current - prev) / (prev || 1);

        if (change > 0.50) return 'DUMPING'; // >50% Spike = Panic
        if (change > 0.10) return 'PUMPING'; // >10% Rise = Demand
        return 'RANGING';
    }

    // FIX U2: Whale Flow Proxy
    private deriveWhaleFlow(block: Block): 'ACCUMULATING' | 'DUMPING' | 'NEUTRAL' {
        // Heuristic: Gas Limit Usage Density
        // Whales use complex contracts (high gas)
        const gasUsed = Number(block.gasUsed);
        const gasLimit = Number(block.gasLimit);
        const density = gasUsed / gasLimit;

        if (density > 0.8) return 'ACCUMULATING'; // Congestion = High Value Activity?
        if (density < 0.2) return 'NEUTRAL';
        return 'NEUTRAL'; // Hard to say DUMPING without transfer logs
    }

    private deriveSentiment(txCount: number): 'EUPHORIC' | 'FEAR' | 'NEUTRAL' {
        if (this.lastTxCounts.length < 5 || this.lastGasPrices.length < 5) return 'NEUTRAL';

        const avgTx = this.lastTxCounts.reduce((a, b) => a + b, 0) / this.lastTxCounts.length;
        const currentGas = this.lastGasPrices[this.lastGasPrices.length - 1];
        const prevGas = this.lastGasPrices[this.lastGasPrices.length - 5]; // 5 blocks ago

        // Gas Trend: (Current - Prev) / Prev
        const gasTrend = Number(currentGas - prevGas) / Number(prevGas);

        // 1. High Activity Check
        if (txCount > avgTx * 1.5) {
            // High Activity + Rising Gas = EUPHORIA (FOMO)
            // REMOVED premature check > 0.1 here to allow > 0.5 check below

            // High Activity + Dumping Gas = FEAR (Panic Selling / Liquidation Cascade?)
            // Or just efficient block clearing. 
            // Often Panic Selling also spikes gas, but if price is crashing and gas is high, it's fear.
            // Without price, we assume High Activity + High Gas = EXTREME EMOTION.
            // Let's use Gas Acceleration as the differentiation.

            // If gas is skyrocketing (> 50% increase), it's EUPHORIC/MANIC.
            if (gasTrend > 0.5) return 'EUPHORIC';

            // High Activity + Rising Gas = EUPHORIA (FOMO)
            if (gasTrend > 0.1) return 'EUPHORIC'; // Lower threshold check AFTER higher one

            // If gas is stable but volume is huge, it might be a capitulation wick.
            return 'FEAR';
        }

        // 2. Low Activity
        if (txCount < avgTx * 0.5) {
            return 'FEAR'; // "Ghost Town" -> Uncertainty/Fear
        }

        return 'NEUTRAL';
    }

    private notify(state: MarketState) {
        this.callbacks.forEach(cb => cb(state));
    }
}
