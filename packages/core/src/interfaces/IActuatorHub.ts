/**
 * 🤜 ACTUATOR HUB — The Output / Execution Interface
 *
 * Responsible for writing to the world: signing transactions, calling APIs,
 * writing files, sending messages, etc.
 *
 * Any module that only needs to *act* should depend on IActuatorHub,
 * not the full IClawKit. This enables safe, testable actuator mocking.
 */

import { WalletClient } from 'viem';
import { CapabilityAction, ActionResult } from '../types/CapabilityAction';

export interface IActuatorHub {
    /** Low-level transaction signing client (viem WalletClient). */
    readonly walletClient: WalletClient;

    /**
     * Execute a generic domain action.
     * Implementations route to the appropriate adapter based on `action.domain`.
     *
     * @param action - The action to execute.
     * @returns An `ActionResult` describing success/failure.
     *
     * @example
     * const result = await hub.act(createTradeAction('BUY', { tokenIn: 'WBNB' }));
     */
    act?<T = unknown, R = unknown>(action: CapabilityAction<T>): Promise<ActionResult<R>>;

    /**
     * Returns the primary wallet address associated with this hub.
     * Equivalent to `walletClient.getAddresses()[0]`.
     */
    getAddress(): Promise<string>;
}
