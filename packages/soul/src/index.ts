/**
 * @clawkit/soul — AI Consciousness & Emotional Engine
 *
 * The "ghost in the machine" — thermodynamic emotions,
 * causal reasoning, breath rhythm, and trauma memory.
 */

// Core AI
export { BreathEngine, BreathPhase, type PhaseDurations } from './ai/BreathEngine';
export { ThermodynamicEngine, type ThermoConfig, DEFAULT_THERMO_CONFIG } from './ai/ThermodynamicEngine';
export { Vector, Matrix } from './ai/LinearAlgebra';
export { DeepSeekOracle, type DeepSeekConfig } from './ai/DeepSeekOracle';
export { CausalBrain, CausalEdge, type SentinelVariable } from '@clawkit/core';
export { type IOracle, type MarketContext, type OracleGenerationOptions, type OracleInsight } from './ai/IOracle';
export { ClawOracle } from './sensors/ClawOracle';

// Emotional Core
export { EmotionalCore, type EmotionalState } from './eidolon/EmotionalCore';
export { TraumaRegistry } from './eidolon/TraumaRegistry';
export { EidolonGuard, type ValidationResult, type RiskParameters, type GuardConfig } from './eidolon/EidolonGuard';

// Brain & Consciousness
export { ActiveLearning, type TradeOutcome } from './eidolon/ActiveLearning';
export { DivineTransparency } from '@clawkit/core';
export * from './eidolon/EidolonTypes';

// WASM
export { WasmAdapter } from './WasmAdapter';

// Sensors, Oracles, Simulation, Swarm
export { MarketStream } from './sensors/MarketStream';
export { PriceAggregator } from './sensors/PriceAggregator';
export { GoPlusSecurity } from './oracles/GoPlusSecurity';
export { PythAdapter } from './oracles/PythAdapter';
export type { PythConfig } from './config/PythConfig';
export { EidolonSimulator, type ShadowTransaction, type SimulationResult, type RiskMatrixResult } from './simulation/EidolonSimulator';
export { EidolonSwarm, type SwarmMessage, type SwarmBandwidthSnapshot } from './swarm/EidolonSwarm';

// Events and Metrics
export {
    EidolonBus,
    EidolonEventType,
    type EidolonEvent,
    type TradeExecutedEvent
} from '@clawkit/core';
export { KpiTracker, type KpiSnapshot } from './metrics/KpiTracker';
// Cognitive Core (Phase 1 & 2)
export { CognitiveArbiter } from './eidolon/CognitiveArbiter';
export * from './eidolon/CognitiveTypes';
export { ConversationSimulator } from './simulation/ConversationSimulator';
export { ReasoningChain, CriticModule, TreeOfThoughts, VerifierLoop } from './eidolon/ReasoningChain';
export { ContextCompressor, ContextRouter } from './eidolon/ContextCompressor';
export { SwarmOrchestrator } from './swarm/SwarmOrchestrator';
export { CausalDiscoveryPipeline, type CausalHypothesis, type VerificationResult, type DiscoveryReport } from './eidolon/CausalDiscoveryPipeline';
export { MetaCognitiveOrchestrator, RoutingStrategy, type OrchestrationContext, type RoutingDecision } from './eidolon/MetaCognitiveOrchestrator';
