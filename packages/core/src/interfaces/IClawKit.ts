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
    readonly analytics: object;
    readonly defi: {
        getRealQuote?(
            tokenIn: string,
            tokenOut: string,
            amount: bigint,
            slippage: number
        ): Promise<Record<string, unknown>>;
    };
    readonly gas: {
        getOptimalExecutionTime?(): Promise<Record<string, unknown>>;
    };
    getAddress(): Promise<string>;
}
