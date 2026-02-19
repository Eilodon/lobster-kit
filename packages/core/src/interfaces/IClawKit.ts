import { PublicClient, WalletClient } from 'viem';

/**
 * IClawKit — Abstract interface for ClawKit dependency injection.
 *
 * Breaks the circular dependency: eidolon modules (PriceAggregator,
 * ClawOracle, EidolonSimulator, EidolonGuard) need ClawKit for
 * analytics/defi access, but ClawKit lives in the adapter package.
 * This interface lives in @clawkit/core so soul modules can depend
 * on it without importing the adapter directly.
 */
export interface IClawKit {
    readonly publicClient: PublicClient;
    readonly walletClient: WalletClient;
    readonly config: {
        rpcUrl?: string;
        privacyMode?: 'strict' | 'balanced';
        deepSeekConfig?: {
            baseUrl?: string;
            apiKey?: string;
            model?: string;
            timeout?: number;
        };
        [key: string]: unknown;
    };
    readonly analytics: {
        getPrice?(symbol: string): Promise<number>;
        portfolioHealth?(address?: string): Promise<any>;
        getHistoricalValue?(days?: number, address?: string): Promise<any[]>;
    };
    readonly defi: {
        getRealQuote?(tokenIn: string, tokenOut: string, amount: bigint, slippage: number): Promise<any>;
        swap?(params: any): Promise<any>;
    };
    readonly security: {
        scanContract?(address: string): Promise<any>;
    };
    readonly gas: {
        estimateGas?(params: any): Promise<any>;
        getOptimalExecutionTime?(): Promise<any>;
    };
    getAddress(): Promise<string>;
}
