/**
 * 🦞 EIDOLON SENTINEL FRAMEWORK
 * 
 * A consciousness-inspired architecture for autonomous blockchain agents
 * 
 * Public modules with basic implementations
 * Production-optimized parameters available in ClawKit Pro
 * 
 * @see https://github.com/clawkit/bnb for full documentation
 */

// Core modules
export { SentinelHeart, HEART_CONFIG, type HeartMode, type HeartMetrics } from './SentinelHeart';
export { 
  DivineTransparency, 
  REASONING_WEIGHTS,
  type MarketState, 
  type ActionType,
  type DecisionLog,
  type CausalFactor
} from './DivineTransparency';
export {
  ActiveLearning,
  LEARNING_CONFIG,
  type TradeOutcome,
  type LearningMetrics
} from './ActiveLearning';
export {
  EmotionalCore,
  EMOTIONAL_CONFIG,
  type EmotionalState,
  type EmotionalProfile,
  type RiskParameters
} from './EmotionalCore';

// Master orchestrator
export {
  EidolonAgent,
  type EidolonConfig
} from './EidolonAgent';

/**
 * Quick start example:
 * 
 * ```typescript
 * import { EidolonAgent } from '@clawkit/bnb/eidolon';
 * import { createPublicClient, createWalletClient } from 'viem';
 * 
 * const agent = new EidolonAgent(publicClient, walletClient, {
 *   minConfidenceToTrade: 70,
 *   basePositionSize: 5,
 *   maxDrawdown: 10
 * });
 * 
 * await agent.start();
 * ```
 */
