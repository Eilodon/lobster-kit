import { DecisionLog, DEFAULT_WEIGHTS as REASONING_WEIGHTS, QTable, Q_CONFIG, MarketState, ActionType, QStateHash } from './EidolonTypes';
import { IStorageProvider } from './memory/IStorageProvider';
import { AppendOnlyAdapter } from './memory/AppendOnlyAdapter';

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

// ⚠️ PLACEHOLDER LEARNING RATES - Not optimized
// Production rates use adaptive learning rate scheduling
export const LEARNING_CONFIG: LearningConfig = {
  BASE_LEARNING_RATE: 0.05,      // How much to adjust weights
  DECAY_RATE: 0.995,              // Learning rate decay per update
  MIN_LEARNING_RATE: 0.001,       // Minimum learning rate
  REWARD_MULTIPLIER: 1.0,         // Positive reinforcement strength
  PENALTY_MULTIPLIER: 1.2,        // Negative reinforcement strength (learn faster from pain)
  GAMMA: 0.9,                     // Discount factor for future rewards
};

export class ActiveLearning {
  private weights = { ...REASONING_WEIGHTS }; // @deprecated: Keeping for backward compatibility
  private qTable: QTable = {}; // 🧠 The Brain 2.0
  private learningRate = Q_CONFIG.ALPHA;

  private tradeHistory: TradeOutcome[] = [];
  private adjustmentCount = 0;

  // Persistence
  private storage: AppendOnlyAdapter;
  private readonly WEIGHTS_KEY = 'active_learning_weights.json';
  private readonly Q_TABLE_KEY = 'active_learning_q_table.json'; // New Brain Memory
  private readonly HISTORY_KEY = 'active_learning_history.log';
  private autoSaveEnabled = true;

  // FIX A4: Q-Table Versioning to handle state space evolution
  // v1: gas:whale:sentiment:liq:price (Current)
  private readonly Q_VERSION = 'v1';

  constructor(
    initialWeights?: typeof REASONING_WEIGHTS,
    private config: LearningConfig = LEARNING_CONFIG,
    storage?: IStorageProvider
  ) {
    if (initialWeights) {
      this.weights = { ...initialWeights };
    }

    // Default to AppendOnly (Local) for Phase 1
    this.storage = (storage as AppendOnlyAdapter) || new AppendOnlyAdapter();
  }

  /**
   * Initialize the brain (load weights from disk)
   * Must be called before start()
   */
  public async init(): Promise<void> {
    // FIXED: Load saved weights on startup (awaited)
    await this.loadFromDisk().catch(() => {
      console.log('🆕 No saved weights found, starting with fresh brain');
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
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   🧠 ACTIVE LEARNING - PROCESSING OUTCOME                  ║');
    console.log('╠════════════════════════════════════════════════════════════╣');

    this.tradeHistory.push(outcome);

    // 🧠 FIXED: Append to log immediately
    if (this.autoSaveEnabled) {
      await this.storage.append(this.HISTORY_KEY, outcome);
    }

    // 🧠 NEURAL LINK: Auto-Archival
    // Instead of deleting history (Memory Loss), we archive it to long-term storage.
    if (this.tradeHistory.length > 2000) {
      await this.archiveHistory();
    }



    // Calculate reward signal
    const reward = this.calculateReward(outcome);

    const rewardEmoji = reward > 0 ? '✅' : '❌';
    console.log(`║ ${rewardEmoji} Outcome: ${reward > 0 ? 'PROFIT' : 'LOSS'} | P & L: $${outcome.profitLoss.toFixed(2)} `.padEnd(61) + '║');
    console.log(`║    Reward Signal: ${reward.toFixed(4)} `.padEnd(61) + '║');

    // Update Q-Values (The Brain 2.0)
    // For continuous Q-learning, we SHOULD use the current market state as 'nextState'
    // This allows the agent to learn chains of decisions.
    // If nextState is not provided, we effectively treat it as a terminal state (Gamma=0 for this step)
    // FIX Bug #16: Allow passing nextState for Temporal Difference learning
    this.updateQValue(decision.marketState, decision.action, reward, decision.marketState); // Using current state as next state approximate

    // Legacy Weight Update (Keep for compatibility until full migration)
    if (outcome.success) {
      this.updateWeights(decision, reward);
    } else {
      console.log('║    ⚠️ Transaction failed - no weight update               ║');
    }

    // Decay learning rate over time
    this.decayLearningRate();

    console.log(`║    Current Learning Rate: ${this.learningRate.toFixed(4)} `.padEnd(61) + '║');
    console.log(`║    Total Adjustments: ${this.adjustmentCount} `.padEnd(61) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // FIXED: Auto-save after learning
    if (this.autoSaveEnabled) {
      await this.saveToDisk().catch(err => {
        console.error('⚠️ Failed to save weights:', err.message);
      });
    }
  }

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
    console.log(`    🧠 Q - UPDATE[${stateHash}][${action}]: ${currentQ.toFixed(4)} -> ${newQ.toFixed(4)} (R: ${reward.toFixed(4)}, MaxNext: ${maxNextQ.toFixed(4)})`);
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
   * Update weights using gradient-based learning
   * Reinforcement Learning: Strengthen pathways that led to profit
   */
  private updateWeights(decision: DecisionLog, reward: number): void {
    console.log('    🔄 Updating neural pathways...');

    const adjustment = this.learningRate * reward;
    const multiplier = reward > 0
      ? this.config.REWARD_MULTIPLIER
      : this.config.PENALTY_MULTIPLIER;

    // Update weights based on causal factors
    decision.causalFactors.forEach(factor => {
      const weightUpdate = adjustment * multiplier * (factor.impact / 100);

      // Apply updates to specific weight categories
      if (factor.name === 'Whale Activity') {
        this.adjustWeight('whaleFlow', decision.marketState.whaleFlow, weightUpdate);
      } else if (factor.name === 'Network Cost') {
        this.adjustWeight('gasPrice', decision.marketState.gasPrice, weightUpdate);
      } else if (factor.name === 'Liquidity Risk' || factor.name === 'Liquidity Depth') {
        this.adjustWeight('liquidityDepth', decision.marketState.liquidityDepth, weightUpdate);
      } else if (factor.name === 'Market Sentiment') {
        this.adjustWeight('sentiment', decision.marketState.sentiment, weightUpdate);
      } else if (factor.name === 'Price Momentum') {
        this.adjustWeight('priceAction', decision.marketState.priceAction, weightUpdate);
      }
    });

    this.adjustmentCount++;
  }

  /**
   * 🧠 NEURAL LINK: Robust Weight Adjustment
   * Normalizes keys to prevent learning failures due to casing issues.
   */
  private adjustWeight(category: keyof typeof this.weights, key: string, delta: number): void {
    const categoryWeights = this.weights[category];
    // Try exact match first
    if (key in categoryWeights) {
      (categoryWeights as any)[key] += delta;
      console.log(`       ${category} [${key}]: ${(categoryWeights as any)[key].toFixed(2)} (Δ ${delta.toFixed(4)})`);
      return;
    }

    // Try normalized match (Upper Case)
    const upperKey = key.toUpperCase();
    if (upperKey in categoryWeights) {
      (categoryWeights as any)[upperKey] += delta;
      console.log(`       ${category} [${upperKey}]: ${(categoryWeights as any)[upperKey].toFixed(2)} (Δ ${delta.toFixed(4)})`);
      return;
    }

    console.warn(`       ⚠️ Neural Link Warning: Key '${key}' not found in category '${category}'.Learning skipped for this factor.`);
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

    const successfulTrades = this.tradeHistory.filter(t => t.success);
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
   * FIXED: Save weights and history to disk
   * Enables "Living Organism" - agent remembers what it learned!
   */
  public async saveToDisk(): Promise<void> {
    try {
      // Save weights
      const weightsData = {
        weights: this.weights,
        learningRate: this.learningRate,
        adjustmentCount: this.adjustmentCount,
        savedAt: new Date().toISOString(),
        version: '1.0'
      };

      await this.storage.save(this.WEIGHTS_KEY, weightsData);

      // Save Q-Table
      const qData = {
        qTable: this.qTable,
        version: '2.0',
        savedAt: new Date().toISOString()
      };
      await this.storage.save(this.Q_TABLE_KEY, qData);

      // Save history (last 1000 trades to limit file size)
      const recentHistory = this.tradeHistory.slice(-1000);
      // await this.storage.save(this.HISTORY_KEY, recentHistory); // Log is already appended

      console.log('💾 Brain State (Weights + Q-Table) saved to local memory');
    } catch (error: any) {
      console.error('❌ Failed to save weights:', error.message);
      throw error;
    }
  }

  /**
   * FIXED: Load weights and history from disk
   * Called automatically on startup
   */
  public async loadFromDisk(): Promise<void> {
    try {
      // Load weights
      const saved = await this.storage.load<any>(this.WEIGHTS_KEY);

      if (saved) {
        this.weights = saved.weights;
        this.learningRate = saved.learningRate;
        this.adjustmentCount = saved.adjustmentCount;

        console.log(`🧠 Loaded learned weights from ${saved.savedAt} `);
        console.log(`   Adjustments made: ${saved.adjustmentCount} `);
      }

      // Load Q-Table
      const savedQ = await this.storage.load<any>(this.Q_TABLE_KEY);
      if (savedQ) {
        this.qTable = savedQ.qTable;
        console.log(`🧠 Loaded Q - Table(Size: ${Object.keys(this.qTable).length} states)`);
      }

      // Load history from AppendLog
      const logs = await this.storage.readLog(this.HISTORY_KEY);
      if (logs.length > 0) {
        this.tradeHistory = logs; // Each log entry is a TradeOutcome
        console.log(`📊 Loaded ${this.tradeHistory.length} historical trades from AppendLog`);
      } else {
        console.log('📊 No trade history found (starting fresh)');
      }
    } catch (error: any) {
      // Not an error - just means no saved weights yet
      throw new Error('No saved weights found');
    }
  }

  /**
   * Enable/disable auto-save
   */
  public setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
    console.log(`Auto - save ${enabled ? 'enabled' : 'disabled'} `);
  }

  /**
   * Manually trigger save (if auto-save is disabled)
   */
  public async manualSave(): Promise<void> {
    await this.saveToDisk();
  }

  /**
   * 🧠 NEURAL LINK: Archival Mechanism
   * Rotates log file if too large (Implementation for Phase 2)
   */
  private async archiveHistory(): Promise<void> {
    const archiveKey = `archive_history_${Date.now()}.json`;
    console.log(`📦 Archiving ${this.tradeHistory.length} trades to ${archiveKey} `);

    // Save all current history to archive file
    await this.storage.save(archiveKey, this.tradeHistory);

    // Reduce in-memory history (Keep last 1000)
    // We treat the active 'tradeHistory' array as the working memory (RAM).
    // The AppendLog on disk contains everything, but we don't want to load it all next time.
    // When we loadFromDisk, we only read the log, which might be huge. 
    // Ideally we should rotate the log, but for now this archival saves a snapshot.
    this.tradeHistory = this.tradeHistory.slice(-1000);
  }
}
