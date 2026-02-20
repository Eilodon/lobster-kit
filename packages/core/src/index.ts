/**
 * @clawkit/core — Shared foundation for all ClawKit packages
 *
 * Events, memory, types, utilities, and interfaces.
 */

// Interfaces
export { IClawKit } from './interfaces/IClawKit';
export type { ISensorHub, IReadClient } from './interfaces/ISensorHub';
export type { IActuatorHub, IWriteClient } from './interfaces/IActuatorHub';
export type { IMemoryHub } from './interfaces/IMemoryHub';

// Types
export * from './types/EidolonTypes';
export * from './types/WorldState';
export * from './types/CapabilityAction';


// Events
export { EidolonBus, EidolonEventType } from './events/EidolonBus';
export type { EidolonEvent, TradeExecutedEvent, WhaleEvent } from './events/EidolonBus';
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
// Moved to @clawkit/soul


// Utilities
export { AsyncLock } from './utils/AsyncLock';
export { Logger } from './utils/Logger';
export { withRetry, withTimeout, CircuitBreaker, type RetryConfig, type CircuitBreakerOptions } from './utils/Resilience';
export { BigMath, WAD, RAY, HALF_WAD, HALF_RAY } from './utils/BigMath';
export { BioParametersConfig, RiskConfigPreset, type BioParameters, type RiskConfig } from './config';

