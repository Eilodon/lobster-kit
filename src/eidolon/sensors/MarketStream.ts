import { PublicClient, WatchBlocksParameters, Block } from 'viem';
import { MarketState } from '../EidolonTypes';

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

    // State buffer
    private lastGasPrices: bigint[] = [];
    private lastTxCounts: number[] = [];

    constructor(client: PublicClient) {
        this.client = client;
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
        // 1. Extract Metrics
        const gasUsed = block.gasUsed;
        const gasLimit = block.gasLimit;
        const baseFee = block.baseFeePerGas || 0n;
        const txCount = block.transactions.length;

        // 2. Update Buffers (Rolling Window of ~10 blocks)
        if (baseFee > 0n) this.lastGasPrices.push(baseFee);
        this.lastTxCounts.push(txCount);

        if (this.lastGasPrices.length > 10) this.lastGasPrices.shift();
        if (this.lastTxCounts.length > 10) this.lastTxCounts.shift();

        // 3. Derive Market State
        const newState: MarketState = {
            gasPrice: this.deriveGasState(),
            whaleFlow: 'NEUTRAL', // Need DEX indexer for real flow
            sentiment: this.deriveSentiment(txCount), // Activity = Excitement?
            liquidityDepth: 'DEEP', // Placeholder
            priceAction: 'RANGING' // Placeholder
        };

        // 4. Notify Listeners
        this.notify(newState);
    }

    private deriveGasState(): 'LOW' | 'MEDIUM' | 'HIGH' {
        if (this.lastGasPrices.length < 2) return 'MEDIUM';

        const current = this.lastGasPrices[this.lastGasPrices.length - 1];
        const avg = this.lastGasPrices.reduce((a, b) => a + b, 0n) / BigInt(this.lastGasPrices.length);

        if (current > avg * 120n / 100n) return 'HIGH'; // +20% surge
        if (current < avg * 80n / 100n) return 'LOW';   // -20% drop
        return 'MEDIUM';
    }

    private deriveSentiment(txCount: number): 'EUPHORIC' | 'FEAR' | 'NEUTRAL' {
        if (this.lastTxCounts.length < 5) return 'NEUTRAL';

        const avgTx = this.lastTxCounts.reduce((a, b) => a + b, 0) / this.lastTxCounts.length;

        if (txCount > avgTx * 2) return 'EUPHORIC'; // Double leverage activity
        if (txCount < avgTx * 0.5) return 'FEAR';   // Dead chain
        return 'NEUTRAL';
    }

    private notify(state: MarketState) {
        this.callbacks.forEach(cb => cb(state));
    }
}
