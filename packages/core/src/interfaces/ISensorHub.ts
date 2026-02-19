/**
 * 🌡️ SENSOR HUB — The Input / Perception Interface
 *
 * Responsible for reading from the world: on-chain data, market prices,
 * external API feeds, file system, websockets, etc.
 *
 * Any module that only needs to *read* should depend on ISensorHub,
 * not the full IClawKit. This minimizes coupling.
 */

import { PublicClient } from 'viem';
import { WorldState } from '../types/WorldState';

export interface ISensorHub {
    /** Low-level blockchain read client (viem PublicClient). */
    readonly publicClient: PublicClient;

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
