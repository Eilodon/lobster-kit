/**
 * 🤜 ACTUATOR HUB — The Output / Execution Interface
 *
 * Responsible for writing to the world: signing transactions, calling APIs,
 * writing files, sending messages, etc.
 *
 * Any module that only needs to *act* should depend on IActuatorHub,
 * not the full IClawKit. This enables safe, testable actuator mocking.
 */

import { CapabilityAction, ActionResult } from '../types/CapabilityAction';

export type WriteClientArgs = Record<string, unknown>;

/**
 * Generic transaction signing / write client.
 * viem's WalletClient satisfies this interface automatically.
 */
export interface IWriteClient {
    getAddresses(): Promise<string[]>;
    getChainId(): Promise<number>;
    signTypedData?(args: WriteClientArgs): Promise<string>;
    writeContract?(args: WriteClientArgs): Promise<string>;
    sendTransaction?(args: WriteClientArgs): Promise<string>;
    [key: string]: unknown; // Allow domain-specific extensions
}

export interface IActuatorHub {
    /** Generic write client — any signer that implements IWriteClient. */
    readonly writeClient: IWriteClient;

    /**
     * @deprecated Use `writeClient` instead. Kept for backward compatibility.
     * Alias for writeClient — returns the same underlying client.
     */
    readonly walletClient?: IWriteClient;

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
     * Equivalent to `writeClient.getAddresses()[0]`.
     */
    getAddress(): Promise<string>;
}
