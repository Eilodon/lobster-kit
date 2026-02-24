/**
 * @eidolon/core — Shared foundation for all Eidolon packages
 *
 * Events, memory, types, utilities, and interfaces.
 */

// Interfaces
export { IEidolon } from './interfaces/IEidolon';
export type { ISensorHub, IReadClient, ReadClientArgs } from './interfaces/ISensorHub';
export type { IActuatorHub, IWriteClient, WriteClientArgs } from './interfaces/IActuatorHub';
export type { IMemoryHub } from './interfaces/IMemoryHub';

// Types
export * from './types/EidolonTypes';
export * from './types/WorldState';
export * from './types/CapabilityAction';
export * from './types/CognitiveTypes';


// Events
export { EidolonBus, EidolonEventType } from './events/EidolonBus';
export type { EidolonEvent, TradeExecutedEvent, WhaleEvent } from './events/EidolonBus';
export { EventRingBuffer } from './events/EventRingBuffer';
export { ConversationEventType, OrchestrationEventType, ReasoningEventType } from './events/CognitiveEventTypes';

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

// Cognitive Modules
export * from './cognitive';

// AI contracts
export type { IOracle, MarketContext, OracleGenerationOptions, OracleInsight } from './ai/IOracle';

// Consciousness Modules
// Moved to @eidolon/soul


// Utilities
export { AsyncLock } from './utils/AsyncLock';
export { Logger } from './utils/Logger';
export { withRetry, withTimeout, CircuitBreaker, type RetryConfig, type CircuitBreakerOptions } from './utils/Resilience';
export { BigMath, WAD, RAY, HALF_WAD, HALF_RAY } from './utils/BigMath';
export { BioParametersConfig, RiskConfigPreset, type BioParameters, type RiskConfig } from './config';

export { DivineTransparency } from './DivineTransparency';

export { CausalBrain, CausalEdge, type SentinelVariable } from './ai/CausalBrain';
