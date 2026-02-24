/**
 * ⚡ CAPABILITY ACTION — The Universal Actuation Layer
 *
 * A domain-agnostic description of "what the agent wants to do next."
 * DeFi agents emit `TradeAction`. Coding agents emit `PullRequestAction`.
 * The actuator layer executes `CapabilityAction<T>` regardless of domain.
 */

import type { ActionType } from './EidolonTypes';

let actionCounter = 0;

/**
 * Generic action intent.
 *
 * @template T - Domain-specific payload shape.
 *
 * @example
 * // DeFi domain
 * const action: CapabilityAction<{ side: ActionType; tokenIn: string }> = {
 *   id: 'trade-001',
 *   domain: 'defi',
 *   priority: 'HIGH',
 *   payload: { side: 'BUY', tokenIn: 'WBNB' },
 * };
 *
 * @example
 * // GitHub domain
 * const action: CapabilityAction<{ repo: string; branch: string }> = {
 *   id: 'pr-merge-002',
 *   domain: 'github',
 *   priority: 'NORMAL',
 *   payload: { repo: 'clawkit-bnb', branch: 'main' },
 * };
 */
export interface CapabilityAction<T = unknown> {
    /** Unique action instance identifier (e.g. uuid or timestamp-based). */
    readonly id: string;
    /** Domain this action targets. Must match an active `IActuatorHub`. */
    readonly domain: string;
    /**
     * Execution priority.
     * - `EMERGENCY` — skip queues, execute immediately (e.g. stop-loss).
     * - `HIGH` — execute next tick.
     * - `NORMAL` — normal scheduled execution.
     * - `LOW` — background / can be deferred.
     */
    readonly priority: 'LOW' | 'NORMAL' | 'HIGH' | 'EMERGENCY';
    /** Domain-specific action payload. */
    readonly payload: T;
    /** Optional ISO-8601 deadline. Action should be aborted past this. */
    readonly expiresAt?: number;
}

/**
 * Result returned by an actuator after executing a `CapabilityAction`.
 */
export interface ActionResult<R = unknown> {
    readonly actionId: string;
    readonly success: boolean;
    readonly result?: R;
    readonly error?: string;
    readonly executedAt: number;
    /** Optional on-chain tx hash (DeFi, NFT, etc.). */
    readonly txHash?: string;
}

/**
 * Convenience factory — creates a CapabilityAction with a timestamp-based id.
 */
export function createAction<T>(
    domain: string,
    payload: T,
    priority: CapabilityAction['priority'] = 'NORMAL',
    expiresAt?: number
): CapabilityAction<T> {
    const nextId = actionCounter++;
    return {
        id: `${domain}-${Date.now()}-${nextId}`,
        domain,
        priority,
        payload,
        expiresAt,
    };
}

// ---------------------------------------------------------------------------
// DeFi concrete aliases — backward-compatible, zero migration needed
// ---------------------------------------------------------------------------

/** Payload for a DeFi trading action. */
export interface TradePayload {
    side: ActionType;
    tokenIn?: string;
    tokenOut?: string;
    amount?: bigint;
    slippage?: number;
}

/** DeFi trade action. Alias of `CapabilityAction<TradePayload>`. */
export type TradeAction = CapabilityAction<TradePayload>;

/** Factory for DeFi trade actions. */
export function createTradeAction(
    side: ActionType,
    opts?: Omit<TradePayload, 'side'>,
    priority: CapabilityAction['priority'] = 'NORMAL'
): TradeAction {
    return createAction('defi', { side, ...opts }, priority);
}
