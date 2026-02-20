/**
 * 🌡️ SENSOR HUB — The Input / Perception Interface
 *
 * Responsible for reading from the world: on-chain data, market prices,
 * external API feeds, file system, websockets, etc.
 *
 * Any module that only needs to *read* should depend on ISensorHub,
 * not the full IClawKit. This minimizes coupling.
 */

/**
 * Generic read-only client for world state queries.
 * viem's PublicClient satisfies this interface automatically.
 */
export interface IReadClient {
    readContract(args: unknown): Promise<unknown>;
    getBlock?(args?: unknown): Promise<unknown>;
    getBalance?(args: unknown): Promise<bigint>;
    getChainId?(): Promise<number>;
    [key: string]: unknown; // Allow domain-specific extensions
}

import { WorldState } from '../types/WorldState';

export interface ISensorHub {
    /** Generic read client — any provider that implements IReadClient. */
    readonly readClient: IReadClient;

    /**
     * @deprecated Use `readClient` instead. Kept for backward compatibility.
     * Alias for readClient — returns the same underlying client.
     */
    readonly publicClient?: IReadClient;

    /** Runtime configuration. */
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

    /**
     * Generic world perception query.
     * Implementations may delegate to domain-specific sensors.
     *
     * @param query - Domain-specific query descriptor.
     * @returns A WorldState snapshot for the requested domain/query.
     *
     * @example
     * const defiState = await hub.sense<MarketState>('defi:market');
     */
    sense?<T extends Record<string, unknown>>(query: string): Promise<WorldState<T>>;
}
