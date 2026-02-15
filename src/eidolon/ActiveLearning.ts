import { DecisionLog, DEFAULT_WEIGHTS as REASONING_WEIGHTS } from './EidolonTypes';
import { IStorageProvider } from './memory/IStorageProvider';
import { GreenfieldAdapter } from './memory/GreenfieldAdapter';

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

// ⚠️ PLACEHOLDER LEARNING RATES - Not optimized
// Production rates use adaptive learning rate scheduling
export const LEARNING_CONFIG = {
  BASE_LEARNING_RATE: 0.05,      // How much to adjust weights
  DECAY_RATE: 0.995,              // Learning rate decay per update
  MIN_LEARNING_RATE: 0.001,       // Minimum learning rate
  REWARD_MULTIPLIER: 1.0,         // Positive reinforcement strength
  PENALTY_MULTIPLIER: 1.2,        // Negative reinforcement strength (learn faster from pain)
};

export class ActiveLearning {
  private weights = { ...REASONING_WEIGHTS };
  private learningRate = LEARNING_CONFIG.BASE_LEARNING_RATE;

  private tradeHistory: TradeOutcome[] = [];
  private adjustmentCount = 0;

  // Persistence
  private storage: IStorageProvider;
  private readonly WEIGHTS_KEY = 'active_learning_weights.json';
  private readonly HISTORY_KEY = 'active_learning_history.json';
  private autoSaveEnabled = true;

  constructor(
    initialWeights?: typeof REASONING_WEIGHTS,
    private config = LEARNING_CONFIG,
    storage?: IStorageProvider
  ) {
    if (initialWeights) {
      this.weights = { ...initialWeights };
    }

    // Default to Greenfield (with local fallback)
    this.storage = storage || new GreenfieldAdapter({
      bucketName: 'eidolon-memory-brain',
      useLocalFallback: !process.env.GREENFIELD_ENDPOINT
    });
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
    // FIX CRITICAL: Memory Leak Prevention
    if (this.tradeHistory.length > 2000) {
      this.tradeHistory = this.tradeHistory.slice(-1000);
    }


    // Calculate reward signal
    const reward = this.calculateReward(outcome);

    const rewardEmoji = reward > 0 ? '✅' : '❌';
    console.log(`║ ${rewardEmoji} Outcome: ${reward > 0 ? 'PROFIT' : 'LOSS'} | P&L: $${outcome.profitLoss.toFixed(2)}`.padEnd(61) + '║');
    console.log(`║    Reward Signal: ${reward.toFixed(4)}`.padEnd(61) + '║');

    // Update weights based on causal factors
    if (outcome.success) {
      this.updateWeights(decision, reward);
    } else {
      console.log('║    ⚠️ Transaction failed - no weight update               ║');
    }

    // Decay learning rate over time
    this.decayLearningRate();

    console.log(`║    Current Learning Rate: ${this.learningRate.toFixed(4)}`.padEnd(61) + '║');
    console.log(`║    Total Adjustments: ${this.adjustmentCount}`.padEnd(61) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // FIXED: Auto-save after learning
    if (this.autoSaveEnabled) {
      await this.saveToDisk().catch(err => {
        console.error('⚠️ Failed to save weights:', err.message);
      });
    }
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
    // Assuming typical trade is $10-100
    const normalizedPL = Math.tanh(outcome.profitLoss / 50);

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
        this.adjustWhaleWeights(decision.marketState.whaleFlow, weightUpdate);
      } else if (factor.name === 'Network Cost') {
        this.adjustGasWeights(decision.marketState.gasPrice, weightUpdate);
      } else if (factor.name === 'Liquidity Risk' || factor.name === 'Liquidity Depth') {
        this.adjustLiquidityWeights(decision.marketState.liquidityDepth, weightUpdate);
      } else if (factor.name === 'Market Sentiment') {
        this.adjustSentimentWeights(decision.marketState.sentiment, weightUpdate);
      } else if (factor.name === 'Price Momentum') {
        this.adjustPriceWeights(decision.marketState.priceAction, weightUpdate);
      }
    });

    this.adjustmentCount++;
  }

  private adjustWhaleWeights(flow: string, delta: number): void {
    if (flow in this.weights.whaleFlow) {
      const key = flow as keyof typeof this.weights.whaleFlow;
      const oldValue = this.weights.whaleFlow[key];
      this.weights.whaleFlow[key] += delta;
      console.log(`       Whale[${flow}]: ${oldValue.toFixed(2)} → ${this.weights.whaleFlow[key].toFixed(2)}`);
    }
  }

  private adjustGasWeights(gas: string, delta: number): void {
    if (gas in this.weights.gasPrice) {
      const key = gas as keyof typeof this.weights.gasPrice;
      const oldValue = this.weights.gasPrice[key];
      this.weights.gasPrice[key] += delta;
      console.log(`       Gas[${gas}]: ${oldValue.toFixed(2)} → ${this.weights.gasPrice[key].toFixed(2)}`);
    }
  }

  private adjustLiquidityWeights(depth: string, delta: number): void {
    if (depth in this.weights.liquidityDepth) {
      const key = depth as keyof typeof this.weights.liquidityDepth;
      const oldValue = this.weights.liquidityDepth[key];
      this.weights.liquidityDepth[key] += delta;
      console.log(`       Liquidity[${depth}]: ${oldValue.toFixed(2)} → ${this.weights.liquidityDepth[key].toFixed(2)}`);
    }
  }

  private adjustSentimentWeights(sentiment: string, delta: number): void {
    if (sentiment in this.weights.sentiment) {
      const key = sentiment as keyof typeof this.weights.sentiment;
      const oldValue = this.weights.sentiment[key];
      this.weights.sentiment[key] += delta;
      console.log(`       Sentiment[${sentiment}]: ${oldValue.toFixed(2)} → ${this.weights.sentiment[key].toFixed(2)}`);
    }
  }

  private adjustPriceWeights(action: string, delta: number): void {
    if (action in this.weights.priceAction) {
      const key = action as keyof typeof this.weights.priceAction;
      const oldValue = this.weights.priceAction[key];
      this.weights.priceAction[key] += delta;
      console.log(`       Price[${action}]: ${oldValue.toFixed(2)} → ${this.weights.priceAction[key].toFixed(2)}`);
    }
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
    console.log(`║ Win Rate:           ${(metrics.winRate * 100).toFixed(1)}%`.padEnd(61) + '║');
    console.log(`║ Total P&L:          $${metrics.totalPL.toFixed(2)}`.padEnd(61) + '║');
    console.log(`║ Avg Profit:         $${metrics.avgProfit.toFixed(2)}`.padEnd(61) + '║');
    console.log(`║ Avg Loss:           $${metrics.avgLoss.toFixed(2)}`.padEnd(61) + '║');
    console.log(`║ Sharpe Ratio:       ${metrics.sharpeRatio.toFixed(2)}`.padEnd(61) + '║');
    console.log(`║ Weight Adjustments: ${metrics.adjustmentsMade}`.padEnd(61) + '║');
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

      // Save history (last 1000 trades to limit file size)
      const recentHistory = this.tradeHistory.slice(-1000);
      await this.storage.save(this.HISTORY_KEY, recentHistory);

      console.log('💾 Weights and history saved to decentralized memory');
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

        console.log(`🧠 Loaded learned weights from ${saved.savedAt}`);
        console.log(`   Adjustments made: ${saved.adjustmentCount}`);
      }

      // Load history
      const history = await this.storage.load<any>(this.HISTORY_KEY);
      if (history) {
        this.tradeHistory = history;
        console.log(`📊 Loaded ${this.tradeHistory.length} historical trades`);
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
    console.log(`Auto-save ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Manually trigger save (if auto-save is disabled)
   */
  public async manualSave(): Promise<void> {
    await this.saveToDisk();
  }
}
