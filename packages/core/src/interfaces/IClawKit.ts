import { ISensorHub } from './ISensorHub';
import { IActuatorHub } from './IActuatorHub';
import { IMemoryHub } from './IMemoryHub';

/**
 * IClawKit — The Combined Agent Runtime Interface.
 *
 * Extends the three focused Hub interfaces:
 *   - ISensorHub  → reads from the world  (readClient, config, sense?)
 *   - IActuatorHub → writes to the world  (writeClient, act?, getAddress)
 *   - IMemoryHub  → maintains state       (remember?, recall?, forget?)
 *
 * Domain-specific capabilities (defi, gas, analytics) are now injected
 * via DomainAdapterRegistry, not hardcoded on this interface.
 */
export interface IClawKit extends ISensorHub, IActuatorHub, IMemoryHub {
    // ISensorHub provides: readClient, config, sense?
    // IActuatorHub provides: writeClient, act?, getAddress()
    // IMemoryHub provides: remember?, recall?, forget?

    /**
     * Optional domain capability bridges.
     * Populated at runtime when domain adapters are loaded.
     * Generic: any adapter can register arbitrary capabilities.
     */
    readonly capabilities?: Record<string, unknown>;
}
