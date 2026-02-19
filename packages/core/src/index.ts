/**
 * @clawkit/core — Shared foundation for all ClawKit packages
 *
 * Events, memory, types, utilities, and interfaces.
 */

// Interfaces
export { IClawKit } from './interfaces/IClawKit';

// Types
export * from './types/EidolonTypes';

// Events
export { EidolonBus, EidolonEventType } from './events/EidolonBus';
export type { TradeExecutedEvent, WhaleEvent } from './events/EidolonBus';
export { EventRingBuffer } from './events/EventRingBuffer';

// Memory / Storage
export { IStorageProvider } from './memory/IStorageProvider';
export { GreenfieldAdapter } from './memory/GreenfieldAdapter';
export { SQLiteLearningStore } from './memory/SQLiteLearningStore';
export { AppendOnlyAdapter } from './memory/AppendOnlyAdapter';

// Swarm Primitives
export { DirtyTracker, DirtyMask, DirtyComponentMask } from './swarm/DirtyTracker';

// Metrics
export { KpiTracker, type KpiSnapshot } from './metrics/KpiTracker';

// Testing
export { ChaosHarness, type ChaosHarnessDeps, type ChaosHarnessConfig, type ChaosAlarm, type ChaosReport, type ChaosScenario } from './testing/ChaosHarness';

// Consciousness Modules
export { ActiveLearning } from './ActiveLearning';
export type { TradeOutcome } from './ActiveLearning';
export { DivineTransparency } from './DivineTransparency';

// Utilities
export { AsyncLock } from './utils/AsyncLock';
export { Logger } from './utils/Logger';
export { withRetry, withTimeout, type RetryConfig } from './utils/Resilience';
export { BigMath } from './utils/BigMath';

// Token helpers (minimal stub — full implementation in @clawkit/defi-bnb)
export function getTokenDecimals(tokenOrSymbol: string): number {
    const decimals: Record<string, number> = {
        'USDT': 6, 'USDC': 6, 'BUSD': 18, 'WBNB': 18, 'BNB': 18,
        'CAKE': 18, 'ETH': 18, 'BTCB': 18, 'DAI': 18,
    };
    return decimals[tokenOrSymbol.toUpperCase()] ?? 18;
}
