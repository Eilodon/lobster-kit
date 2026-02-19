import { PublicClient, WalletClient } from 'viem';
import { ISensorHub } from './ISensorHub';
import { IActuatorHub } from './IActuatorHub';
import { IMemoryHub } from './IMemoryHub';

/**
 * IClawKit — The Combined Agent Runtime Interface.
 *
 * Extends the three focused Hub interfaces:
 *   - ISensorHub  → reads from the world  (publicClient, config, sense?)
 *   - IActuatorHub → writes to the world   (walletClient, act?, getAddress)
 *   - IMemoryHub  → maintains state        (remember?, recall?, forget?)
 *
 * All three are kept backward-compatible. Existing code that only needs
 * `publicClient` or `walletClient` can now accept the narrower hub types.
 *
 * Optional `defi` / `gas` stubs are preserved for soul sensor modules
 * (ClawOracle, PriceAggregator) that bridge the DeFi domain.
 */
export interface IClawKit extends ISensorHub, IActuatorHub, IMemoryHub {
    // ISensorHub already provides: publicClient, config, sense?
    // IActuatorHub already provides: walletClient, act?, getAddress()
    // IMemoryHub already provides: remember?, recall?, forget?

    /** Optional DeFi bridge — populated when ClawKit has a defi module loaded. */
    readonly defi?: {
        getRealQuote?(
            tokenIn: string,
            tokenOut: string,
            amount: bigint,
            slippage: number
        ): Promise<Record<string, unknown>>;
    };

    /** Optional gas bridge — populated when ClawKit has a gas module loaded. */
    readonly gas?: {
        getOptimalExecutionTime?(): Promise<Record<string, unknown>>;
    };

    /** Optional analytics bridge. */
    readonly analytics?: object;
}

