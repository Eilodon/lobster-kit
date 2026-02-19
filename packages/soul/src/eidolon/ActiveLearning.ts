import { DecisionLog, DEFAULT_WEIGHTS as REASONING_WEIGHTS, QTable, Q_CONFIG, MarketState, ActionType, QStateHash } from './EidolonTypes';
import { IStorageProvider, AppendOnlyAdapter } from '@clawkit/core';
import { CausalBrain, SentinelVariable } from '../ai/CausalBrain';
import { RollingHistoryBuffer } from '../events/RollingHistoryBuffer';
import { WasmAdapter, LiquidBrain, HyperMemory } from '../WasmAdapter';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 🧠 ACTIVE LEARNING MODULE
 * Self-Improvement Engine - "Skin in the Game" Learning
 * 
 * FIXED: Added weight persistence to disk
 * Agent now has "memory" - weights survive restarts!
 * 
 * Learns from actual trading outcomes to adjust decision weights
 * Architecture: Public framework with simplified learning rates
 * Production rates: Optimized through meta-learning (ClawKit Pro)
 */

export interface TradeOutcome {
  decisionId: number; // timestamp from DecisionLog
  profitLoss: number; // Actual P&L in USD
  capitalAtRisk: number; // Added for ROI calculation
  slippage: number;   // Actual vs expected slippage
  gasUsed: number;    // Actual gas cost
  success: boolean;   // Transaction succeeded
}

export interface LearningMetrics {
  totalTrades: number;
  winRate: number;
  totalPL: number;
  avgProfit: number;
  avgLoss: number;
  sharpeRatio: number;
  adjustmentsMade: number;
}

export interface LearningConfig {
  BASE_LEARNING_RATE: number;
  DECAY_RATE: number;
  MIN_LEARNING_RATE: number;
  REWARD_MULTIPLIER: number;
  PENALTY_MULTIPLIER: number;
  GAMMA: number;
}

interface StoredWeights {
  weights: typeof REASONING_WEIGHTS;
  learningRate: number;
  adjustmentCount: number;
  adamM?: Record<string, number>;
  adamV?: Record<string, number>;
  adamT?: number;
  savedAt?: string;
  version?: string;
}

interface StoredQTable {
  qTable: QTable;
}

interface QDeltaEntry {
  updates?: Record<string, Partial<Record<ActionType, number>>>;
}

// 🧠 ADAM OPTIMIZER CONFIG
// Adam (Adaptive Moment Estimation) hyperparameters.
// Replaces simple gradient descent for faster convergence in volatile markets.
export const LEARNING_CONFIG: LearningConfig = {
  BASE_LEARNING_RATE: 0.001,      // Adam alpha (lower than SGD is correct)
  DECAY_RATE: 0.995,              // Learning rate decay per update
  MIN_LEARNING_RATE: 0.0001,      // Minimum learning rate floor
  REWARD_MULTIPLIER: 1.0,         // Positive reinforcement strength
  PENALTY_MULTIPLIER: 1.2,        // Negative reinforcement strength (learn faster from pain)
  GAMMA: 0.9,                     // Discount factor for future rewards
};

// Adam Optimizer constants (standard values from original paper)
const ADAM_BETA1 = 0.9;    // Exponential decay for 1st moment (momentum)
const ADAM_BETA2 = 0.999;  // Exponential decay for 2nd moment (velocity)
const ADAM_EPSILON = 1e-8; // Numerical stability constant

export class ActiveLearning {
  private weights = { ...REASONING_WEIGHTS }; // @deprecated: Keeping for backward compatibility
  private qTable: QTable = {}; // 🧠 The Brain 2.0
  private cognitiveBrain: CausalBrain; // 🧠 The Brain 3.0 (Bayesian)
  private replayBuffer: RollingHistoryBuffer<DecisionLog>; // 🧠 The Brain 3.5 (Memory)
  private liquidBrain?: LiquidBrain;   // 🧠 The Brain 4.0 (Liquid)
  private hyperMemory?: HyperMemory;   // 🧠 The Brain 5.0 (Holographic)
  private lastIntuition: Float32Array | null = null; // [NEW] Introspection
  private learningRate = Q_CONFIG.ALPHA;
  private config: LearningConfig;

  // 🧠 ADAM OPTIMIZER STATE
  // Per-weight momentum (m) and velocity (v) vectors.
  // Key format: "category.key" e.g. "whaleFlow.ACCUMULATING"
  private adamM: Record<string, number> = {}; // 1st moment
  private adamV: Record<string, number> = {}; // 2nd moment
  private adamT = 0; // Global timestep (for bias correction)

  private tradeHistory!: RollingHistoryBuffer<TradeOutcome>;
  private readonly TRADE_HISTORY_CAPACITY = 2000;
  private adjustmentCount = 0;

  // Persistence
  private storage: IStorageProvider;
  private readonly WEIGHTS_KEY = 'active_learning_weights.json';
  private readonly Q_TABLE_KEY = 'active_learning_q_table.json'; // New Brain Memory
  private readonly CAUSAL_KEY = 'active_learning_causal.json'; // Synaptic Map
  private readonly Q_DELTA_KEY = 'active_learning_q_delta.log';
  private readonly HISTORY_KEY = 'active_learning_history.log';
  private autoSaveEnabled = true;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInFlight: Promise<void> | null = null;
  private pendingUpdates = 0;
  private dirtyQStates = new Set<string>();
  private updatesSinceSnapshot = 0;
  private readonly SAVE_DEBOUNCE_MS = 30000;
  private readonly SAVE_BATCH_SIZE = 50;
  private readonly SNAPSHOT_EVERY_UPDATES = 500;
  private readonly debugEnabled = process.env.EIDOLON_DEBUG === '1';

  // FIX A4: Q-Table Versioning to handle state space evolution
  // v1: gas:whale:sentiment:liq:price (Current)
  private readonly Q_VERSION = 'v1';

  constructor(
    initialWeights?: typeof REASONING_WEIGHTS,
    config: LearningConfig = LEARNING_CONFIG,
    storage?: IStorageProvider
  ) {
    if (initialWeights) {
      this.weights = { ...initialWeights };
    }
    this.config = config;

    // Default to AppendOnly (Local) for Phase 1
    this.storage = storage ?? new AppendOnlyAdapter();
    this.cognitiveBrain = new CausalBrain();
    this.tradeHistory = new RollingHistoryBuffer<TradeOutcome>(this.TRADE_HISTORY_CAPACITY);
    this.replayBuffer = new RollingHistoryBuffer<DecisionLog>(2000); // 🧠 Memory Capacity
  }

  /**
   * Initialize the brain (load weights from disk)
   * Must be called before start()
   */
  public async init(): Promise<void> {
    // FIXED: Load saved weights on startup (awaited)
    await this.rotateLogFile(); // Check log size before loading

    // 🧠 NEURAL WIRING: Connect Liquid Brain
    const adapter = WasmAdapter.getInstance();
    await adapter.init();
    // Input: 5 (Gas, Whale, Sentiment, Liq, Price) | Hidden: 20
    this.liquidBrain = adapter.createLiquidBrain(5, 20);
    this.hyperMemory = adapter.createHyperMemory(5);
    this.debug('🧠 LIQUID BRAIN & HYPER MEMORY CONNECTED');

    await this.loadFromDisk().catch(() => {
      this.debug('🆕 No saved weights found, starting with fresh brain');
    });
  }

  /**
   * Learn from actual trading outcome
   * This is where "Skin in the Game" happens
   * 
   * FIXED: Now auto-saves weights after learning
   * 
   * @param decision The decision that was made
   * @param outcome The actual result of that decision
   */
  public async learnFromOutcome(decision: DecisionLog, outcome: TradeOutcome): Promise<void> {
    this.debug('\n╔════════════════════════════════════════════════════════════╗');
    this.debug('║   🧠 ACTIVE LEARNING - PROCESSING OUTCOME                  ║');
    this.debug('╠════════════════════════════════════════════════════════════╣');

    this.tradeHistory.push(outcome);

    // 🧠 FIXED: Append to log immediately
    if (this.autoSaveEnabled) {
      await this.rotateLogFile(); // Ensure file size is managed before append
      await this.storage.append(this.HISTORY_KEY, outcome);
    }

    // 🧠 NEURAL LINK: Auto-Archival
    // Instead of deleting history (Memory Loss), we archive it to long-term storage.
    if (this.tradeHistory.length > 2000) {
      await this.archiveHistory();
    }

    // Calculate reward signal
    const reward = this.calculateReward(outcome);

    // 🧠 LIQUID PLASTICITY (Backprop-like)
    if (this.liquidBrain) {
      this.liquidBrain.optimize(reward);
      this.debug(`    🌊 LIQUID LEARNING: Synapses adjusted (R=${reward.toFixed(4)})`);
    }

    const rewardEmoji = reward > 0 ? '✅' : '❌';
    this.debug(`║ ${rewardEmoji} Outcome: ${reward > 0 ? 'PROFIT' : 'LOSS'} | P & L: $${outcome.profitLoss.toFixed(2)} `.padEnd(61) + '║');
    this.debug(`║    Reward Signal: ${reward.toFixed(4)} `.padEnd(61) + '║');

    // Update Q-Values (The Brain 2.0)
    // For continuous Q-learning, we SHOULD use the current market state as 'nextState'
    // This allows the agent to learn chains of decisions.
    // If nextState is not provided, we effectively treat it as a terminal state (Gamma=0 for this step)
    // FIX Bug #16: Allow passing nextState for Temporal Difference learning
    this.updateQValue(decision.marketState, decision.action, reward, decision.marketState); // Using current state as next state approximate

    // 🧠 THE BRAIN 3.0: Bayesian Causal Learning
    // We verify if our "Priors" held true.
    // 1. Whale Flow -> Price Delta
    if (decision.marketState.whaleFlow === 'ACCUMULATING') {
      // If Whales bought, did we profit? (Proxy for Price went up)
      this.cognitiveBrain.learn('WhaleNetFlow', 'PriceDelta', outcome.profitLoss > 0);
    } else if (decision.marketState.whaleFlow === 'DUMPING') {
      // If Whales sold, did we lose? (Proxy for Price went down)
      // Actually, if we SOLD, we profited if price went down.
      // If we BOUGHT and Whales Dumped, we likely lost.
      // Causal Link: Whale Dumping -> Price Down.
      // If we BOUGHT, profit < 0 means Price Down.
      // So if Whale=Dumping AND Profit < 0 (Price Down), then Whale->PriceDelta check passes (Price did go down).
      // Wait, 'PriceDelta' usually means Positive Delta.
      // If Price Down, PriceDelta is False?
      // Let's assume PriceDelta = "Price Increased".
      // CAUSE: Whale Dumping. EFFECT: Price Increased?
      // we expect this to be FALSE.
      // If we have Profit < 0 (on Buy), then Price Decreased. So Effect (Price Increase) did NOT happen.
      // So OutcomePositive = false.
      // this.cognitiveBrain.learn('WhaleNetFlow', 'PriceDelta', false);
      // Correct.
      if (decision.action === 'BUY') {
        this.cognitiveBrain.learn('WhaleNetFlow', 'PriceDelta', outcome.profitLoss > 0);
      }
    }

    // 2. Sentiment -> Price Delta
    // If Sentiment is Greed, did price go up?
    if (decision.marketState.sentiment === 'EUPHORIC' && decision.action === 'BUY') {
      this.cognitiveBrain.learn('Sentiment', 'PriceDelta', outcome.profitLoss > 0);
    }

    // Legacy Weight Update (Keep for compatibility until full migration)
    if (outcome.success) {
      this.updateWeights(decision, reward);
    } else {
      this.debug('║    ⚠️ Transaction failed - no weight update               ║');
    }

    // Decay learning rate over time
    this.decayLearningRate();

    this.debug(`║    Current Learning Rate: ${this.learningRate.toFixed(4)} `.padEnd(61) + '║');
    this.debug(`║    Total Adjustments: ${this.adjustmentCount} `.padEnd(61) + '║');
    this.debug('╚════════════════════════════════════════════════════════════╝\n');

    if (this.autoSaveEnabled) {
      this.scheduleAutoSave();
    }
  }

  // ... (keeping intervening methods unchanged) ...



  /**
   * 🧠 QUANTUM BRAIN: State Quantization
   * Converts complex market reality into a distinct state key.
   */
  private getMarketStateHash(state: MarketState): QStateHash {
    // Format: "v1:GAS:WHALE:SENTIMENT:LIQUIDITY:PRICE"
    return `${this.Q_VERSION}:${state.gasPrice}:${state.whaleFlow}:${state.sentiment}:${state.liquidityDepth}:${state.priceAction}`;
  }

  /**
   * 🧠 QUANTUM BRAIN: Bellman Update
   * Q(s,a) = Q(s,a) + alpha * (R + gamma * max(Q(s',a')) - Q(s,a))
   * FIX Bug #16: Implemented correct Q-Learning equation
   */
  private updateQValue(state: MarketState, action: ActionType, reward: number, nextState?: MarketState): void {
    const stateHash = this.getMarketStateHash(state);

    // Initialize state if new
    if (!this.qTable[stateHash]) {
      this.qTable[stateHash] = {
        BUY: 0, SELL: 0, HOLD: 0, EMERGENCY_EXIT: 0
      };
      // FIX H5: Prevent unbounded memory growth
      this.pruneMemory();
    }

    const currentQ = this.qTable[stateHash][action] || 0;

    // Calculate max Q for next state
    let maxNextQ = 0;
    if (nextState) {
      const nextHash = this.getMarketStateHash(nextState);
      const nextActions = this.qTable[nextHash];
      if (nextActions) {
        // Find max Q in next state
        maxNextQ = Math.max(...Object.values(nextActions));
      }
    }

    // Bellman Equation (Temporal Difference)
    // NewQ = OldQ + Alpha * (Reward + Gamma * MaxNextQ - OldQ)
    // FIX L4: Use Q_CONFIG.GAMMA consistently
    const gamma = Q_CONFIG.GAMMA;
    const newQ = currentQ + this.learningRate * (reward + gamma * maxNextQ - currentQ);

    this.qTable[stateHash][action] = newQ;
    this.dirtyQStates.add(stateHash);
    this.pendingUpdates++;
    this.debug(`    🧠 Q - UPDATE[${stateHash}][${action}]: ${currentQ.toFixed(4)} -> ${newQ.toFixed(4)} (R: ${reward.toFixed(4)}, MaxNext: ${maxNextQ.toFixed(4)})`);
  }

  /**
   * 🧠 HYPER MEMORY: Store current state
   */
  public async memorize(state: MarketState, decisionId: number): Promise<void> {
    if (!this.hyperMemory) return;
    const vec = this.vectorizeMarketState(state);
    this.hyperMemory.insert(String(decisionId), vec);
  }

  /**
   * 🧠 HYPER MEMORY: Recall similar past states
   * Returns list of decision IDs that had similar market conditions.
   */
  public async recall(state: MarketState, k: number = 5): Promise<bigint[]> {
    if (!this.hyperMemory) return [];
    const vec = this.vectorizeMarketState(state);
    // Returns [{id: string, score: number}]
    const results = this.hyperMemory.search(vec, k);
    return results.map((r: any) => BigInt(r.id));
  }

  /**
   * 🧠 LIQUIDITY SENSOR: Vectorize Market State for Liquid Brain
   */
  private vectorizeMarketState(state: MarketState): Float32Array {
    const vec = new Float32Array(5);

    // 1. Gas Price (Low=0, High=1)
    vec[0] = state.gasPrice === 'LOW' ? 0.0 : state.gasPrice === 'MEDIUM' ? 0.5 : 1.0;

    // 2. Whale Flow (Accumulating=1, Dumping=0)
    vec[1] = state.whaleFlow === 'ACCUMULATING' ? 1.0 : state.whaleFlow === 'NEUTRAL' ? 0.5 : 0.0;

    // 3. Sentiment (Fear=0, Euphoric=1)
    switch (state.sentiment) {
      case 'FEAR': vec[2] = 0.0; break;
      case 'NEUTRAL': vec[2] = 0.5; break;
      case 'EUPHORIC': vec[2] = 1.0; break;
      default: vec[2] = 0.5;
    }

    // 4. Liquidity (Deep=1, Thin=0)
    vec[3] = state.liquidityDepth === 'DEEP' ? 1.0 : 0.0;

    // 5. Price Action (Dumping=0, Pumping=1)
    switch (state.priceAction) {
      case 'DUMPING': vec[4] = 0.0; break;
      case 'RANGING': vec[4] = 0.5; break;
      case 'PUMPING': vec[4] = 1.0; break;
      default: vec[4] = 0.5;
    }

    return vec;
  }

  /**
   * 🧠 QUANTUM BRAIN: Action Recommendation (Epsilon-Greedy)
   */
  public recommendAction(state: MarketState): ActionType {
    // Exploration
    if (Math.random() < Q_CONFIG.EPSILON) {
      const actions: ActionType[] = ['BUY', 'SELL', 'HOLD'];
      return actions[Math.floor(Math.random() * actions.length)];
    }

    // Exploitation
    const stateHash = this.getMarketStateHash(state);

    // 🧠 LIQUID INUTITION (Forward Pass)
    if (this.liquidBrain) {
      const vec = this.vectorizeMarketState(state);
      const intuitionState = this.liquidBrain.forward(vec);
      // We log the intuition state - in future we can map this to an action bias
      // For now, let's just use the first neuron activity as a "Vibe Check"
      const vibe = intuitionState[0];
      this.debug(`    🌊 LIQUID INTUITION: Vibe=${vibe.toFixed(4)}`);
    }

    const actions = this.qTable[stateHash];

    if (!actions) return 'HOLD'; // Default safety

    // Find action with max Q-value
    let bestAction: ActionType = 'HOLD';
    let maxQ = -Infinity;

    for (const [action, q] of Object.entries(actions)) {
      if (q > maxQ) {
        maxQ = q;
        bestAction = action as ActionType;
      }
    }

    return bestAction;
  }

  /**
   * Calculate reward signal from outcome
   * Positive for profit, negative for loss
   */
  private calculateReward(outcome: TradeOutcome): number {
    if (!outcome.success) {
      return -1.0; // Max penalty for failed transaction
    }

    // Normalize P&L to [-1, 1] range
    // FIX A3: Use ROI (Profit / CapitalAtRisk) instead of raw PnL
    // If capitalAtRisk is 0 (shouldn't happen for trades), fallback to fixed divisor
    let roi = 0;
    if (outcome.capitalAtRisk > 0) {
      roi = outcome.profitLoss / outcome.capitalAtRisk;
    } else {
      roi = outcome.profitLoss / 50; // Fallback
    }

    // Sigmoid function to map ROI to reward
    // 5% ROI (0.05) * 10 = 0.5 -> tanh(0.5) = 0.46
    // 20% ROI (0.20) * 10 = 2.0 -> tanh(2.0) = 0.96
    const normalizedPL = Math.tanh(roi * 10);

    // Penalize high slippage
    const slippagePenalty = outcome.slippage > 2.0 ? -0.2 : 0;

    // Penalize high gas costs
    const gasPenalty = outcome.gasUsed > 10 ? -0.1 : 0;

    return normalizedPL + slippagePenalty + gasPenalty;
  }

  /**
   * 🧠 ADAM OPTIMIZER: Adaptive weight update.
   * Replaces simple gradient descent.
   * Formula: w = w - alpha_t * m_hat / (sqrt(v_hat) + eps)
   * where m_hat and v_hat are bias-corrected moment estimates.
   */
  private updateWeights(decision: DecisionLog, reward: number): void {
    this.debug('    🔄 Updating neural pathways (Adam Optimizer)...');

    const multiplier = reward > 0
      ? this.config.REWARD_MULTIPLIER
      : this.config.PENALTY_MULTIPLIER;

    // Gradient = reward signal scaled by multiplier and causal factor impact
    decision.causalFactors.forEach(factor => {
      let category: keyof typeof this.weights | null = null;
      let key: string | null = null;

      if (factor.name === 'Whale Activity') {
        category = 'whaleFlow'; key = decision.marketState.whaleFlow;
      } else if (factor.name === 'Network Cost') {
        category = 'gasPrice'; key = decision.marketState.gasPrice;
      } else if (factor.name === 'Liquidity Risk' || factor.name === 'Liquidity Depth') {
        category = 'liquidityDepth'; key = decision.marketState.liquidityDepth;
      } else if (factor.name === 'Market Sentiment') {
        category = 'sentiment'; key = decision.marketState.sentiment;
      } else if (factor.name === 'Price Momentum') {
        category = 'priceAction'; key = decision.marketState.priceAction;
      }

      if (!category || !key) return;

      // Gradient: how much this factor contributed to the outcome
      const gradient = reward * multiplier * (factor.impact / 100);

      this.applyAdamUpdate(category, key, gradient);
    });

    this.adjustmentCount++;
  }

  /**
   * Apply a single Adam update step to a specific weight.
   * @param category - Weight category (e.g. 'whaleFlow')
   * @param key - Weight key (e.g. 'ACCUMULATING')
   * @param gradient - The gradient signal for this step
   */
  private applyAdamUpdate(category: keyof typeof this.weights, key: string, gradient: number): void {
    // FIX: NaN Poisoning Guard
    if (!Number.isFinite(gradient) || Number.isNaN(gradient)) {
      console.warn(`⚠️ Adam: Ignored NaN/Infinity gradient for ${category}.${key}`);
      return;
    }

    const categoryWeights = this.weights[category];
    // Normalize key
    const resolvedKey = key in categoryWeights ? key
      : key.toUpperCase() in categoryWeights ? key.toUpperCase()
        : null;

    if (!resolvedKey) {
      console.warn(`⚠️ Adam: Key '${key}' not found in '${category}'. Skipping.`);
      return;
    }

    const stateKey = `${category}.${resolvedKey}`;

    // Increment global timestep
    this.adamT += 1;

    // Get or initialize moment vectors
    const m = this.adamM[stateKey] ?? 0;
    const v = this.adamV[stateKey] ?? 0;

    // Update biased 1st moment estimate (momentum)
    const mNew = ADAM_BETA1 * m + (1 - ADAM_BETA1) * gradient;
    // Update biased 2nd moment estimate (velocity)
    const vNew = ADAM_BETA2 * v + (1 - ADAM_BETA2) * gradient * gradient;

    // Store updated moments
    this.adamM[stateKey] = mNew;
    this.adamV[stateKey] = vNew;

    // Compute bias-corrected estimates
    const mHat = mNew / (1 - Math.pow(ADAM_BETA1, this.adamT));
    const vHat = vNew / (1 - Math.pow(ADAM_BETA2, this.adamT));

    // Adam update rule
    const weightUpdate = this.learningRate * mHat / (Math.sqrt(vHat) + ADAM_EPSILON);

    const oldVal = categoryWeights[resolvedKey] ?? 0;
    categoryWeights[resolvedKey] = oldVal + weightUpdate;
    this.debug(`       Adam[${stateKey}]: ${oldVal.toFixed(4)} -> ${categoryWeights[resolvedKey].toFixed(4)} (g=${gradient.toFixed(4)}, m̂=${mHat.toFixed(4)}, v̂=${vHat.toFixed(4)})`);
  }

  /**
   * Decay learning rate over time (prevents over-fitting)
   */
  private decayLearningRate(): void {
    this.learningRate = Math.max(
      this.config.MIN_LEARNING_RATE,
      this.learningRate * this.config.DECAY_RATE
    );
  }

  /**
   * Get current learned weights
   */
  public getWeights(): typeof REASONING_WEIGHTS {
    return { ...this.weights };
  }

  /**
   * Get learning performance metrics
   */
  public getMetrics(): LearningMetrics {
    if (this.tradeHistory.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        totalPL: 0,
        avgProfit: 0,
        avgLoss: 0,
        sharpeRatio: 0,
        adjustmentsMade: this.adjustmentCount
      };
    }

    const history = this.tradeHistory.toArray();
    const successfulTrades = history.filter(t => t.success);
    const wins = successfulTrades.filter(t => t.profitLoss > 0);
    const losses = successfulTrades.filter(t => t.profitLoss < 0);

    const totalPL = successfulTrades.reduce((sum, t) => sum + t.profitLoss, 0);
    const avgProfit = wins.length > 0
      ? wins.reduce((sum, t) => sum + t.profitLoss, 0) / wins.length
      : 0;
    const avgLoss = losses.length > 0
      ? losses.reduce((sum, t) => sum + t.profitLoss, 0) / losses.length
      : 0;

    // Simple Sharpe approximation
    const returns = successfulTrades.map(t => t.profitLoss);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev !== 0 ? avgReturn / stdDev : 0;

    return {
      totalTrades: this.tradeHistory.length,
      winRate: successfulTrades.length > 0 ? wins.length / successfulTrades.length : 0,
      totalPL,
      avgProfit,
      avgLoss,
      sharpeRatio,
      adjustmentsMade: this.adjustmentCount
    };
  }

  /**
   * Print learning summary
   */
  public printSummary(): void {
    const metrics = this.getMetrics();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   📊 LEARNING METRICS SUMMARY                              ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Trades:       ${metrics.totalTrades.toString().padEnd(38)}║`);
    console.log(`║ Win Rate:           ${(metrics.winRate * 100).toFixed(1)}% `.padEnd(61) + '║');
    console.log(`║ Total P & L:          $${metrics.totalPL.toFixed(2)} `.padEnd(61) + '║');
    console.log(`║ Avg Profit:         $${metrics.avgProfit.toFixed(2)} `.padEnd(61) + '║');
    console.log(`║ Avg Loss:           $${metrics.avgLoss.toFixed(2)} `.padEnd(61) + '║');
    console.log(`║ Sharpe Ratio:       ${metrics.sharpeRatio.toFixed(2)} `.padEnd(61) + '║');
    console.log(`║ Weight Adjustments: ${metrics.adjustmentsMade} `.padEnd(61) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  }

  /**
   * Export weights for backup or transfer
   */
  public exportWeights(): string {
    return JSON.stringify(this.weights, null, 2);
  }

  /**
   * Import pre-trained weights
   */
  public importWeights(weightsJson: string): void {
    try {
      this.weights = JSON.parse(weightsJson);
      console.log('✅ Weights imported successfully');
    } catch (error) {
      console.error('❌ Failed to import weights:', error);
    }
  }

  /**
   * Save weights and Adam optimizer state to disk.
   * Enables "Living Organism" - agent remembers what it learned AND how it was learning!
   */
  public async saveToDisk(forceSnapshot: boolean = false): Promise<void> {
    try {
      // Save weights + Adam optimizer state
      const weightsData = {
        weights: this.weights,
        learningRate: this.learningRate,
        adjustmentCount: this.adjustmentCount,
        // 🧠 ADAM STATE: Persist momentum so brain doesn't lose velocity on restart
        adamM: this.adamM,
        adamV: this.adamV,
        adamT: this.adamT,
        savedAt: new Date().toISOString(),
        version: '2.0' // Bumped: Adam optimizer
      };

      await this.storage.save(this.WEIGHTS_KEY, weightsData);

      // Save Causal Brain (Synaptic Map)
      await this.cognitiveBrain.saveSynapticMap(this.storage, this.CAUSAL_KEY);

      const shouldSnapshot = forceSnapshot || this.updatesSinceSnapshot >= this.SNAPSHOT_EVERY_UPDATES;
      if (shouldSnapshot) {
        const qData = {
          qTable: this.qTable,
          version: '2.0',
          savedAt: new Date().toISOString()
        };
        await this.storage.save(this.Q_TABLE_KEY, qData);
        this.updatesSinceSnapshot = 0;
      } else if (this.dirtyQStates.size > 0) {
        const updates: Record<string, Record<ActionType, number>> = {};
        for (const stateHash of this.dirtyQStates) {
          updates[stateHash] = { ...this.qTable[stateHash] };
        }
        await this.storage.append(this.Q_DELTA_KEY, {
          version: '2.1-delta',
          savedAt: new Date().toISOString(),
          updates
        });
        this.updatesSinceSnapshot += this.dirtyQStates.size;
      }
      this.dirtyQStates.clear();
      this.pendingUpdates = 0;

      this.debug('💾 Brain State (Weights + Adam + Q-Table) saved to local memory');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to save weights:', message);
      throw error;
    }
  }

  /**
   * Load weights, Adam state, and history from disk.
   * Called automatically on startup.
   */
  public async loadFromDisk(): Promise<void> {
    try {
      // Load weights + Adam state
      const saved = await this.storage.load<StoredWeights>(this.WEIGHTS_KEY);

      if (saved) {
        this.weights = saved.weights;
        this.learningRate = saved.learningRate;
        this.adjustmentCount = saved.adjustmentCount;
        // 🧠 RESTORE ADAM STATE: Brain retains its learning momentum
        if (saved.adamM) this.adamM = saved.adamM;
        if (saved.adamV) this.adamV = saved.adamV;
        if (typeof saved.adamT === 'number') this.adamT = saved.adamT;

        this.debug(`🧠 Loaded learned weights (v${saved.version || '1.0'}) from ${saved.savedAt}`);
        this.debug(`   Adjustments made: ${saved.adjustmentCount}, Adam t=${this.adamT}`);
      }

      // Load Q-Table
      const savedQ = await this.storage.load<StoredQTable>(this.Q_TABLE_KEY);
      if (savedQ) {
        this.qTable = savedQ.qTable;
        this.debug(`🧠 Loaded Q - Table(Size: ${Object.keys(this.qTable).length} states)`);
      }

      // Load Causal Brain
      await this.cognitiveBrain.loadSynapticMap(this.storage, this.CAUSAL_KEY);

      // Replay Q-Delta log on top of snapshot.
      // Replay Q-Delta log on top of snapshot.
      const qDeltas = (await this.storage.readLog(this.Q_DELTA_KEY)) as QDeltaEntry[];
      if (qDeltas.length > 0) {
        for (const delta of qDeltas) {
          if (!delta?.updates || typeof delta.updates !== 'object') continue;
          for (const [stateHash, actions] of Object.entries(delta.updates)) {
            const next = actions as Record<ActionType, number>;
            this.qTable[stateHash] = {
              BUY: Number.isFinite(next.BUY) ? next.BUY : 0,
              SELL: Number.isFinite(next.SELL) ? next.SELL : 0,
              HOLD: Number.isFinite(next.HOLD) ? next.HOLD : 0,
              EMERGENCY_EXIT: Number.isFinite(next.EMERGENCY_EXIT) ? next.EMERGENCY_EXIT : 0
            };
          }
        }
      }

      // Load history from AppendLog (Limit to last 1000 to prevent OOM)
      const logs = (await this.storage.readLog(this.HISTORY_KEY, 1000)) as TradeOutcome[];
      if (logs.length > 0) {
        // Keep bounded working-set in memory
        this.tradeHistory.clear();
        logs.forEach(log => this.tradeHistory.push(log));
        this.debug(`📊 Loaded ${this.tradeHistory.length} historical trades from AppendLog`);
      } else {
        this.debug('📊 No trade history found (starting fresh)');
      }
    } catch {
      // Not an error - just means no saved weights yet
      throw new Error('No saved weights found');
    }
  }

  /**
   * Enable/disable auto-save
   */
  public setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
    this.debug(`Auto - save ${enabled ? 'enabled' : 'disabled'} `);
    if (!enabled && this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Manually trigger save (if auto-save is disabled)
   */
  public async manualSave(): Promise<void> {
    await this.saveToDisk(true);
  }

  public async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flushAutoSave(true);
  }

  public reinitWasmGraphs(): void {
    this.cognitiveBrain.reinitWasmGraph();
  }

  /**
   * 🧠 NEURAL LINK: Archival Mechanism
   * Rotates log file if too large (Implementation for Phase 2)
   */
  private async archiveHistory(): Promise<void> {
    const archiveKey = `archive_history_${Date.now()}.json`;
    this.debug(`📦 Archiving ${this.tradeHistory.length} trades to ${archiveKey} `);

    // Save all current history to archive file
    await this.storage.save(archiveKey, this.tradeHistory.toArray());

    // NOTE: With RollingHistoryBuffer, we don't need to manually slice/prune memory.
    // The buffer automatically manages its size (1000).
    // The archiving here serves as a manual snapshot.
  }

  /**
   * 🛡️ MEMORY DEFENSE: Log Rotation
   * Prevents "Memory Bomb" by rotating execution logs when they exceed 5MB.
   */
  private async rotateLogFile(): Promise<void> {
    try {
      let baseDir = path.resolve(process.cwd(), 'data', 'memory');
      const storageWithBaseDir = this.storage as Partial<{
        getBaseDir: () => string;
      }>;
      if (typeof storageWithBaseDir.getBaseDir === 'function') {
        try {
          const resolvedBaseDir = storageWithBaseDir.getBaseDir();
          if (resolvedBaseDir) {
            baseDir = resolvedBaseDir;
          }
        } catch { /* ignore if method missing */ }
      }

      const logPath = path.resolve(baseDir, this.HISTORY_KEY);

      try {
        const stats = await fs.stat(logPath);
        if (stats.size > 5 * 1024 * 1024) { // 5MB Limit
          const archiveName = `archive_history_${Date.now()}.log`;
          const archivePath = path.resolve(baseDir, archiveName);
          console.log(`DEBUG: Rotating ${logPath} to ${archivePath}`);

          await fs.rename(logPath, archivePath);
          console.log(`📦 MEMORY DEFENSE: Rotated ${this.HISTORY_KEY} -> ${archiveName} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);

          // Initialize new empty file
          await fs.writeFile(logPath, '', 'utf-8');
        }
      } catch (e: unknown) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : '';
        if (code !== 'ENOENT') {
          const message = e instanceof Error ? e.message : String(e);
          console.warn('⚠️ Log rotation check failed:', message);
        }
      }
    } catch (error) {
      console.error('❌ Critical Memory Defense Error:', error);
    }
  }

  private scheduleAutoSave() {
    if (this.pendingUpdates >= this.SAVE_BATCH_SIZE) {
      void this.flushAutoSave(false);
      return;
    }

    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushAutoSave(false);
    }, this.SAVE_DEBOUNCE_MS);
  }

  private async flushAutoSave(forceSnapshot: boolean): Promise<void> {
    if (this.saveInFlight) {
      await this.saveInFlight;
      return;
    }

    this.saveInFlight = this.saveToDisk(forceSnapshot)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('⚠️ Failed to save weights:', message);
      })
      .finally(() => {
        this.saveInFlight = null;
      });

    await this.saveInFlight;
  }

  private debug(...args: unknown[]): void {
    if (!this.debugEnabled) return;
    console.log(...args);
  }

  /**
   * Runtime causal bias for decision confidence.
   * Converts synaptic probabilities into action-specific confidence deltas.
   */
  public getCausalSignal(
    state: MarketState,
    action: ActionType
  ): { confidenceDelta: number; explanations: string[] } {
    if (action === 'HOLD') {
      return { confidenceDelta: 0, explanations: [] };
    }

    const activeSignals: Array<{
      cause: SentinelVariable;
      effect: SentinelVariable;
      direction: number;
      label: string;
      weight: number;
    }> = [];

    if (state.whaleFlow === 'ACCUMULATING') {
      activeSignals.push({ cause: 'WhaleNetFlow', effect: 'PriceDelta', direction: 1, label: 'Whale accumulation', weight: 1.2 });
    } else if (state.whaleFlow === 'DUMPING') {
      activeSignals.push({ cause: 'WhaleNetFlow', effect: 'PriceDelta', direction: -1, label: 'Whale dumping', weight: 1.2 });
    }

    if (state.sentiment === 'EUPHORIC') {
      activeSignals.push({ cause: 'Sentiment', effect: 'PriceDelta', direction: 1, label: 'Euphoric sentiment', weight: 0.8 });
    } else if (state.sentiment === 'FEAR') {
      activeSignals.push({ cause: 'Sentiment', effect: 'PriceDelta', direction: -1, label: 'Fear sentiment', weight: 0.8 });
    }

    if (state.gasPrice === 'HIGH') {
      activeSignals.push({ cause: 'GasPriceGwei', effect: 'Volatility', direction: -1, label: 'High gas volatility pressure', weight: 0.6 });
    }


    if (activeSignals.length === 0) {
      return { confidenceDelta: 0, explanations: [] };
    }

    let weightedScore = 0;
    let weightTotal = 0;
    const explanations: string[] = [];

    for (const signal of activeSignals) {
      const prediction = this.cognitiveBrain.getPrediction(signal.cause, signal.effect);
      const centeredProb = (prediction.prob - 0.5) * 2; // [-1, +1]
      const signed = centeredProb * signal.direction * prediction.confidence * signal.weight;
      weightedScore += signed;
      weightTotal += Math.abs(signal.weight);
      explanations.push(
        `${signal.label}: P=${(prediction.prob * 100).toFixed(0)}% C=${(prediction.confidence * 100).toFixed(0)}%`
      );
    }

    if (weightTotal <= 0) {
      return { confidenceDelta: 0, explanations };
    }

    let normalized = weightedScore / weightTotal;
    if (action === 'SELL' || action === 'EMERGENCY_EXIT') {
      normalized = -normalized;
    }

    const confidenceDelta = Math.round(Math.max(-1, Math.min(1, normalized)) * 20);
    return { confidenceDelta, explanations };
  }

  /**
   * 🌙 DREAMING (Experience Replay)
   * Re-trains network on past experiences to break correlation
   */
  public async dream(): Promise<void> {
    const batchSize = 32;
    const samples = this.replayBuffer.sample(batchSize);

    if (samples.length < batchSize) return;

    this.debug(`🌙 DREAMING: Re-living ${samples.length} memories...`);

    // Train Causal Brain
    // In a real implementation, we'd update the Bayesian Network here
    // For now, we just log that we are reinforcing patterns
  }

  public getIntuition(): number[] {
    return this.lastIntuition ? Array.from(this.lastIntuition) : [];
  }

  /**
   * 🛡️ MEMORY DEFENSE: Prune Q-Table
   * Prevents memory leaks by randomly evicting old states if table grows too large.
   */
  private pruneMemory(): void {
    const MAX_STATES = 5000;
    const keys = Object.keys(this.qTable);
    if (keys.length <= MAX_STATES) return;

    this.debug(`🧹 Pruning memory (Size: ${keys.length} > ${MAX_STATES})...`);

    // Random eviction (approx 10% of table)
    // In a real system, we'd use LRU, but random is sufficient for robustness here.
    const target = Math.floor(keys.length * 0.9);
    while (Object.keys(this.qTable).length > target) {
      const idx = Math.floor(Math.random() * keys.length);
      const keyToDelete = keys[idx];
      if (this.qTable[keyToDelete]) {
        delete this.qTable[keyToDelete];
      }
    }
  }
}
