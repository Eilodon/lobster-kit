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
export { CausalBrain, CausalEdge, type SentinelVariable } from './ai/CausalBrain';
export { type IOracle, type MarketContext, type OracleInsight } from './ai/IOracle';
export { ClawOracle } from './sensors/ClawOracle';

// Emotional Core
export { EmotionalCore, type EmotionalState } from './EmotionalCore';
export { TraumaRegistry } from './TraumaRegistry';
export { EidolonGuard, type ValidationResult, type RiskParameters, type GuardConfig } from './EidolonGuard';

// WASM
export { WasmAdapter } from './WasmAdapter';
