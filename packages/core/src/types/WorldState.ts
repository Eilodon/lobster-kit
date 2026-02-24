/**
 * 🌍 WORLD STATE — The Universal Perception Layer
 *
 * A domain-agnostic wrapper for any agent's sensory snapshot of the world.
 * DeFi agents use `MarketWorldState`. Coding agents use their own T.
 * The Brain sees `WorldState<T>` regardless of domain.
 */

import type { MarketState } from './EidolonTypes';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Generic world perception snapshot.
 *
 * @template T - The domain-specific sensory data shape.
 *
 * @example
 * // DeFi domain
 * const state: WorldState<MarketState> = {
 *   domain: 'defi',
 *   sensory: { gasPrice: 'LOW', whaleFlow: 'NEUTRAL', ... },
 *   timestamp: Date.now(),
 *   confidence: 0.95,
 * };
 *
 * @example
 * // GitHub/coding domain
 * const state: WorldState<{ openPRs: number; ciStatus: 'green' | 'red' }> = {
 *   domain: 'github',
 *   sensory: { openPRs: 3, ciStatus: 'green' },
 *   timestamp: Date.now(),
 *   confidence: 1.0,
 * };
 */
export interface WorldState<T extends object = Record<string, unknown>> {
    /** Domain identifier so routing logic can dispatch correctly. */
    readonly domain: string;
    /** The raw domain-specific sensory data. */
    readonly sensory: T;
    /** Unix epoch ms when this state was captured. */
    readonly timestamp: number;
    /**
     * Data freshness / sensor confidence [0–1].
     * 1.0 = live / freshly confirmed.
     * 0.0 = stale / estimated / unavailable.
     */
    readonly confidence: number;
    /** Optional metadata for debugging / tracing. */
    readonly meta?: Record<string, unknown>;
}

/**
 * Convenience factory — creates a WorldState with `timestamp = Date.now()`.
 */
export function createWorldState<T extends object>(
    domain: string,
    sensory: T,
    confidence = 1.0,
    meta?: Record<string, unknown>
): WorldState<T> {
    return { domain, sensory, timestamp: Date.now(), confidence, meta };
}

/**
 * Type guard — check if a value is a valid WorldState.
 */
export function isWorldState(value: unknown): value is WorldState {
    if (!isPlainRecord(value)) return false;
    if (typeof value.domain !== 'string' || value.domain.trim().length === 0) return false;
    if (!isPlainRecord(value.sensory)) return false;
    if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
    if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) return false;
    if (value.confidence < 0 || value.confidence > 1) return false;
    if (value.meta !== undefined && !isPlainRecord(value.meta)) return false;

    return (
        true
    );
}

// ---------------------------------------------------------------------------
// DeFi concrete alias — backward-compatible, zero migration needed
// ---------------------------------------------------------------------------

/** DeFi market perception snapshot. Alias of `WorldState<MarketState>`. */
export type MarketWorldState = WorldState<MarketState>;

/** Factory for DeFi market state (convenience wrapper). */
export function createMarketWorldState(
    sensory: MarketState,
    confidence = 0.9
): MarketWorldState {
    return {
        domain: 'defi',
        sensory,
        timestamp: Date.now(),
        confidence,
    };
}
