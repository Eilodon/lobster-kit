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

// Emotional Core (Thermodynamic)
export {
  EmotionalCore,
  type EmotionalState
} from './EmotionalCore';

// Persistence
export { GreenfieldAdapter } from './memory/GreenfieldAdapter';
export { IStorageProvider } from './memory/IStorageProvider'; // Export interface
