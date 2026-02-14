import { PublicClient, WalletClient } from 'viem';
import { SentinelHeart } from './SentinelHeart';
import { DivineTransparency, MarketState, ActionType } from './DivineTransparency';
import { ActiveLearning, TradeOutcome } from './ActiveLearning';
import { EmotionalCore, RiskParameters } from './EmotionalCore';

/**
 * 🦞 EIDOLON AGENT
 * Master Orchestrator - Combines all consciousness modules
 * 
 * This agent has:
 * - 🫀 Heart: Adaptive timing (SentinelHeart)
 * - 🔮 Mind: Causal reasoning (DivineTransparency)  
 * - 🧠 Brain: Self-learning (ActiveLearning)
 * - 💫 Soul: Emotional state (EmotionalCore)
 */

export interface EidolonConfig {
  // Agent behavior
  minConfidenceToTrade: number;
  basePositionSize: number; // % of portfolio
  maxDrawdown: number;      // % before emergency exit

  // Risk management
  riskParameters: RiskParameters;

  // Market sensing (override these with real implementations)
  marketStateSensor?: () => Promise<MarketState>;
  executeAction?: (action: ActionType, confidence: number) => Promise<TradeOutcome>;
  priceOracle?: () => Promise<number>; // Oracle for Heartbeat volatility
}

const DEFAULT_CONFIG: EidolonConfig = {
  minConfidenceToTrade: 70,
  basePositionSize: 5,
  maxDrawdown: 10,
  riskParameters: {
    maxPositionSize: 10,
    maxDrawdown: 15,
    minConfidence: 70,
    cooldownPeriod: 60000
  }
};

export class EidolonAgent {
  private heart?: SentinelHeart;
  private mind: DivineTransparency;
  private brain: ActiveLearning;
  private soul: EmotionalCore;

  private isRunning: boolean = false;
  private portfolioValue: number = 1000; // Starting portfolio
  private peakValue: number = 1000;

  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient,
    private config: EidolonConfig = DEFAULT_CONFIG
  ) {
    // Initialize consciousness modules
    this.mind = new DivineTransparency();
    this.brain = new ActiveLearning();
    this.soul = new EmotionalCore(config.riskParameters);

    console.log('🦞 EIDOLON AGENT INITIALIZED');
    console.log('   Consciousness Modules:');
    console.log('   🔮 Divine Transparency: ONLINE');
    console.log('   🧠 Active Learning: ONLINE');
    console.log('   💫 Emotional Core: ONLINE');
  }

  /**
   * Start the agent - Activate the heart
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Agent already running');
      return;
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   🦞 EIDOLON AGENT STARTING                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Initialize brain (load weights)
    await this.brain.init();

    this.isRunning = true;

    // Initialize heart with agent logic
    this.heart = new SentinelHeart(
      this.publicClient,
      () => this.think(),
      undefined, // use default heart config
      this.config.priceOracle // pass injected oracle
    );

    await this.heart.start();
  }

  /**
   * Stop the agent
   */
  public stop(): void {
    if (!this.isRunning) {
      console.log('⚠️  Agent not running');
      return;
    }

    this.heart?.stop();
    this.isRunning = false;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   🦞 EIDOLON AGENT STOPPED                                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    this.printFinalStats();
  }

  /**
   * Main thinking loop - Called by Heart on each beat
   */
  private async think(): Promise<void> {
    try {
      // 1. Check emotional state - Should we trade?
      if (!this.soul.shouldTrade(this.config.minConfidenceToTrade)) {
        return; // Skip this cycle
      }

      // 2. Sense the market
      const marketState = await this.senseMarket();

      // 3. Decide action using Divine Transparency
      const proposedAction = this.proposeAction(marketState);
      const decision = this.mind.explain(marketState, proposedAction);

      // 4. Check confidence threshold
      if (decision.confidence < this.config.minConfidenceToTrade) {
        console.log(`⏸️  Hesitating. Confidence ${decision.confidence}% < ${this.config.minConfidenceToTrade}% threshold`);
        return;
      }

      // 5. Check circuit breaker (drawdown protection)
      if (this.checkCircuitBreaker()) {
        console.log('🚨 CIRCUIT BREAKER TRIGGERED - Emergency exit initiated');
        await this.emergencyExit();
        return;
      }

      // 6. Execute action
      const outcome = await this.execute(decision.action, decision.confidence);

      // 7. Learn from outcome
      this.brain.learnFromOutcome(decision, outcome);
      this.soul.processOutcome(outcome.profitLoss);

      // 8. Update portfolio tracking
      if (outcome.success) {
        this.portfolioValue += outcome.profitLoss;
        this.peakValue = Math.max(this.peakValue, this.portfolioValue);
      }

    } catch (error) {
      console.error('🧠 Thinking error:', error);
    }
  }

  /**
   * Sense market conditions.
   * FIX C1: No more Math.random(). Must inject real sensor.
   */
  private async senseMarket(): Promise<MarketState> {
    if (this.config.marketStateSensor) {
      return await this.config.marketStateSensor();
    }

    throw new Error(
      'EidolonAgent: marketStateSensor not configured. ' +
      'You MUST provide a real market data source via config.marketStateSensor. ' +
      'Example: integrate with ClawKit AnalyticsModule or external oracle.'
    );
  }

  /**
   * Propose action based on market state (simple strategy)
   */
  private proposeAction(state: MarketState): ActionType {
    // Simple strategy: Buy when whales accumulate + low gas + deep liquidity
    if (state.whaleFlow === 'ACCUMULATING' && state.gasPrice === 'LOW' && state.liquidityDepth === 'DEEP') {
      return 'BUY';
    }

    // Sell when whales dump or sentiment euphoric
    if (state.whaleFlow === 'DUMPING' || state.sentiment === 'EUPHORIC') {
      return 'SELL';
    }

    return 'HOLD';
  }

  /**
   * Execute trading action.
   * FIX C2: No more Math.random(). Must inject real executor.
   */
  private async execute(action: ActionType, confidence: number): Promise<TradeOutcome> {
    if (this.config.executeAction) {
      return await this.config.executeAction(action, confidence);
    }

    throw new Error(
      'EidolonAgent: executeAction not configured. ' +
      'You MUST provide a real trade executor via config.executeAction. ' +
      'Example: integrate with ClawKit DeFiModule.swap() for real trades.'
    );
  }

  /**
   * Check if circuit breaker should trigger
   */
  private checkCircuitBreaker(): boolean {
    const drawdown = ((this.peakValue - this.portfolioValue) / this.peakValue) * 100;
    return drawdown > this.config.maxDrawdown;
  }

  /**
   * Emergency exit - Sell everything and stop trading
   */
  private async emergencyExit(): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   🚨 EMERGENCY EXIT PROTOCOL                               ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Max Drawdown Exceeded: ${this.config.maxDrawdown}%`.padEnd(61) + '║');
    console.log(`║ Peak Value:  $${this.peakValue.toFixed(2)}`.padEnd(61) + '║');
    console.log(`║ Current:     $${this.portfolioValue.toFixed(2)}`.padEnd(61) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Execute emergency sell
    // In production: Actually sell positions

    this.stop();
  }

  /**
   * Print final statistics
   */
  private printFinalStats(): void {
    const learningMetrics = this.brain.getMetrics();
    const emotionalProfile = this.soul.getProfile();
    const heartMetrics = this.heart?.getMetrics();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   📊 FINAL STATISTICS                                      ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║   PORTFOLIO                                                ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Starting Value:  $${1000}`.padEnd(61) + '║');
    console.log(`║ Final Value:     $${this.portfolioValue.toFixed(2)}`.padEnd(61) + '║');
    console.log(`║ Total P&L:       $${(this.portfolioValue - 1000).toFixed(2)}`.padEnd(61) + '║');
    console.log(`║ ROI:             ${((this.portfolioValue / 1000 - 1) * 100).toFixed(2)}%`.padEnd(61) + '║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║   TRADING PERFORMANCE                                      ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Trades:    ${learningMetrics.totalTrades}`.padEnd(61) + '║');
    console.log(`║ Win Rate:        ${(learningMetrics.winRate * 100).toFixed(1)}%`.padEnd(61) + '║');
    console.log(`║ Sharpe Ratio:    ${learningMetrics.sharpeRatio.toFixed(2)}`.padEnd(61) + '║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║   CONSCIOUSNESS                                            ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Final State:     ${emotionalProfile.state}`.padEnd(61) + '║');
    console.log(`║ Confidence:      ${emotionalProfile.confidence}%`.padEnd(61) + '║');
    console.log(`║ Heart Beats:     ${heartMetrics?.totalBeats || 0}`.padEnd(61) + '║');
    console.log(`║ Mode Changes:    ${heartMetrics?.modeChanges || 0}`.padEnd(61) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  }

  /**
   * Get current agent status
   */
  public getStatus() {
    return {
      isRunning: this.isRunning,
      portfolioValue: this.portfolioValue,
      peakValue: this.peakValue,
      heartMetrics: this.heart?.getMetrics(),
      learningMetrics: this.brain.getMetrics(),
      emotionalProfile: this.soul.getProfile()
    };
  }
}
