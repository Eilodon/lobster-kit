/**
 * ⚡ EIDOLON AGENT FRAMEWORK
 * "The ghost in the machine"
 * 
 * A unified consciousness architecture for AI agents.
 * 
 * Components:
 * - Brain: Active Inference & Meta-Learning (ActiveLearning.ts)
 * - Heart: Biological Rhythm & Safety (SentinelHeart.ts)
 * - Soul: Homeostatic Regulation (EmotionalCore.ts)
 * - Mind: Explainable AI & Transparency (DivineTransparency.ts)
 */

// Core Identity
export { EidolonGuard } from './EidolonGuard';
export * from './EidolonTypes';

// Consciousness Modules
export { ActiveLearning } from './ActiveLearning';
export { DivineTransparency } from './DivineTransparency';
export { TraumaRegistry } from './TraumaRegistry';
export { CausalBrain } from './ai/CausalBrain';

// Emotional Core (Thermodynamic)
export {
  EmotionalCore,
  type EmotionalState
} from './EmotionalCore';

// Events + Swarm Perf Primitives
export { EventRingBuffer } from './events/EventRingBuffer';
export { DirtyTracker, DirtyMask, DirtyComponentMask } from './swarm/DirtyTracker';
export { KpiTracker, type KpiSnapshot } from './metrics/KpiTracker';
export { ChaosHarness, type ChaosHarnessDeps, type ChaosHarnessConfig, type ChaosAlarm, type ChaosReport, type ChaosScenario } from './testing/ChaosHarness';

// Persistence
export { GreenfieldAdapter } from './memory/GreenfieldAdapter';
export { SQLiteLearningStore } from './memory/SQLiteLearningStore';
export { IStorageProvider } from './memory/IStorageProvider'; // Export interface
