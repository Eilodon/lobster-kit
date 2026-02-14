import fs from 'fs/promises';
import path from 'path';

/**
 * 💫 EMOTIONAL CORE
 * Personality & Risk Management - Agent emotional state system
 * 
 * Simulates emotional responses to trading outcomes
 * Adjusts risk-taking behavior based on psychological state
 * 
 * Architecture: Basic public implementation
 * Full version: Advanced state machine with momentum tracking (ClawKit Pro)
 */

export type EmotionalState = 'CONFIDENT' | 'CAUTIOUS' | 'FEARFUL' | 'GREEDY' | 'NEUTRAL' | 'PANIC';

export interface EmotionalProfile {
  state: EmotionalState;
  confidence: number;      // 0-100
  aggression: number;      // 0-100 (affects position sizing)
  fearLevel: number;       // 0-100
  greedLevel: number;      // 0-100
  consecutiveWins: number;
  consecutiveLosses: number;
}

export interface RiskParameters {
  maxPositionSize: number;  // % of portfolio
  maxDrawdown: number;      // % before circuit breaker
  minConfidence: number;    // Minimum confidence to trade
  cooldownPeriod: number;   // ms to wait after losses
}

// ⚠️ BASIC CONFIGURATION - Simplified emotional model
// Production version uses multi-dimensional state space with momentum
export const EMOTIONAL_CONFIG = {
  CONFIDENCE_BOOST_PER_WIN: 5,
  CONFIDENCE_DROP_PER_LOSS: 10,
  FEAR_THRESHOLD: 3,           // Consecutive losses to trigger fear
  GREED_THRESHOLD: 3,          // Consecutive wins to trigger greed
  COOLDOWN_BASE: 60000,        // 1 minute base cooldown
  MAX_POSITION_SCALE: 2.0,     // Max 2x position when confident
  MIN_POSITION_SCALE: 0.5,     // Min 0.5x position when fearful
};

export class EmotionalCore {
  private state: EmotionalState = 'NEUTRAL';
  private confidence: number = 70; // Start with moderate confidence
  private consecutiveWins: number = 0;
  private consecutiveLosses: number = 0;
  private lastTradeTime: number = 0;
  private inCooldown: boolean = false;

  // Persistence
  private readonly STORAGE_FILE = path.join(process.cwd(), '.clawkit', 'emotional_core.json');

  constructor(
    private baseRiskParams: RiskParameters,
    private config = EMOTIONAL_CONFIG
  ) {
    // Attempt to load state synchronously-ish or just start neutral
    // Best practice: use explicit init()
  }

  /**
   * Initialize and load saved state
   */
  public async init(): Promise<void> {
    await this.loadState();
  }

  /**
   * Save current state to disk
   */
  private async saveState(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.STORAGE_FILE), { recursive: true });
      const data = {
        state: this.state,
        confidence: this.confidence,
        consecutiveWins: this.consecutiveWins,
        consecutiveLosses: this.consecutiveLosses,
        lastTradeTime: this.lastTradeTime,
        timestamp: Date.now()
      };
      await fs.writeFile(this.STORAGE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save emotional state:', error);
    }
  }

  /**
   * Load state from disk
   */
  private async loadState(): Promise<void> {
    try {
      const data = await fs.readFile(this.STORAGE_FILE, 'utf-8');
      const state = JSON.parse(data);
      if (state) {
        this.state = state.state;
        this.confidence = state.confidence;
        this.consecutiveWins = state.consecutiveWins;
        this.consecutiveLosses = state.consecutiveLosses;
        this.lastTradeTime = state.lastTradeTime;
        console.log('🧠 Emotional memory restored.');
      }
    } catch {
      // No saved state, start fresh
    }
  }

  /**
   * Process trading outcome and update emotional state
   */
  public processOutcome(profitLoss: number, timestamp: number = Date.now()): void {
    this.lastTradeTime = timestamp;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   💫 EMOTIONAL CORE - STATE UPDATE                        ║');
    console.log('╠════════════════════════════════════════════════════════════╣');

    if (profitLoss > 0) {
      this.handleWin(profitLoss);
    } else if (profitLoss < 0) {
      this.handleLoss(profitLoss);
    }

    // Update emotional state
    this.updateState();

    console.log(`║ Current State:  ${this.state.padEnd(42)}║`);
    console.log(`║ Confidence:     ${this.confidence}%`.padEnd(61) + '║');
    console.log(`║ Win Streak:     ${this.consecutiveWins}`.padEnd(61) + '║');
    console.log(`║ Loss Streak:    ${this.consecutiveLosses}`.padEnd(61) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Auto-save state
    this.saveState().catch(err => console.error('State save failed', err));
  }

  /**
   * Handle winning trade
   */
  private handleWin(profit: number): void {
    this.consecutiveWins++;
    this.consecutiveLosses = 0;

    // Boost confidence
    this.confidence = Math.min(100, this.confidence + this.config.CONFIDENCE_BOOST_PER_WIN);

    console.log(`║ ✅ WIN: +$${profit.toFixed(2)}`.padEnd(61) + '║');
  }

  /**
   * Handle losing trade
   */
  private handleLoss(loss: number): void {
    this.consecutiveLosses++;
    this.consecutiveWins = 0;

    // Drop confidence
    this.confidence = Math.max(0, this.confidence - this.config.CONFIDENCE_DROP_PER_LOSS);

    console.log(`║ ❌ LOSS: $${loss.toFixed(2)}`.padEnd(61) + '║');

    // Trigger cooldown after losses
    if (this.consecutiveLosses >= 2) {
      this.inCooldown = true;
      const cooldownMs = this.config.COOLDOWN_BASE * this.consecutiveLosses;
      setTimeout(() => {
        this.inCooldown = false;
        console.log('🕐 Cooldown period ended. Ready to trade again.');
      }, cooldownMs);

      console.log(`║ ⏸️  COOLDOWN: ${(cooldownMs / 1000).toFixed(0)}s`.padEnd(61) + '║');
    }
  }

  /**
   * Update emotional state based on streak
   */
  private updateState(): void {
    const prevState = this.state;

    if (this.consecutiveLosses >= this.config.FEAR_THRESHOLD) {
      this.state = 'FEARFUL';
    } else if (this.consecutiveWins >= this.config.GREED_THRESHOLD) {
      this.state = 'GREEDY';
    } else if (this.confidence > 80) {
      this.state = 'CONFIDENT';
    } else if (this.confidence < 40) {
      this.state = 'CAUTIOUS';
    } else {
      this.state = 'NEUTRAL';
    }

    if (prevState !== this.state) {
      console.log(`║ 🔄 STATE CHANGE: ${prevState} → ${this.state}`.padEnd(61) + '║');
    }
  }

  /**
   * Get current emotional profile
   */
  public getProfile(): EmotionalProfile {
    return {
      state: this.state,
      confidence: this.confidence,
      aggression: this.calculateAggression(),
      fearLevel: this.calculateFearLevel(),
      greedLevel: this.calculateGreedLevel(),
      consecutiveWins: this.consecutiveWins,
      consecutiveLosses: this.consecutiveLosses
    };
  }

  /**
   * Get adjusted risk parameters based on emotional state
   */
  public getRiskParameters(): RiskParameters {
    const profile = this.getProfile();
    const positionScaling = this.getPositionScaling();

    return {
      maxPositionSize: this.baseRiskParams.maxPositionSize * positionScaling,
      maxDrawdown: this.baseRiskParams.maxDrawdown,
      minConfidence: this.state === 'FEARFUL' ? 80 : this.baseRiskParams.minConfidence,
      cooldownPeriod: this.baseRiskParams.cooldownPeriod * this.consecutiveLosses
    };
  }

  /**
   * Calculate position size scaling based on emotional state
   */
  private getPositionScaling(): number {
    switch (this.state) {
      case 'FEARFUL':
        return this.config.MIN_POSITION_SCALE; // 0.5x - scared money
      case 'CAUTIOUS':
        return 0.75; // 0.75x - conservative
      case 'NEUTRAL':
        return 1.0; // 1x - normal
      case 'CONFIDENT':
        return 1.5; // 1.5x - slightly aggressive
      case 'GREEDY':
        return this.config.MAX_POSITION_SCALE; // 2x - but capped to prevent recklessness
      case 'PANIC':
        return 0; // 0x - complete withdrawal
      default:
        return 1.0;
    }
  }

  /**
   * Check if agent should trade now
   */
  public shouldTrade(minimumConfidence: number = 50): boolean {
    if (this.state === 'PANIC') {
      console.log('🛑 Trading HALTED: PANIC PROTOCOL ACTIVE');
      return false;
    }

    if (this.inCooldown) {
      console.log('⏸️  Trading suspended: In cooldown period');
      return false;
    }

    if (this.confidence < minimumConfidence) {
      console.log(`⏸️  Trading suspended: Confidence too low (${this.confidence}% < ${minimumConfidence}%)`);
      return false;
    }

    if (this.state === 'FEARFUL') {
      console.log('⏸️  Trading suspended: Emotional state is FEARFUL');
      return false;
    }

    return true;
  }

  /**
   * 🚨 PANIC PROTOCOL
   * Triggered by external severe market conditions (e.g., Flash Crash)
   */
  public triggerPanic(reason: string): void {
    if (this.state !== 'PANIC') {
      this.state = 'PANIC';
      this.confidence = 0;
      console.log(`\n🚨 PANIC PROTOCOL ENGAGED: ${reason}`);
      console.log('   All trading halted. Risk parameters minimized.');
    }
  }

  /**
   * Recover from Panic
   */
  public recoverFromPanic(): void {
    if (this.state === 'PANIC') {
      this.state = 'CAUTIOUS';
      this.confidence = 30;
      console.log('\n🧘 Recovering from Panic. State set to CAUTIOUS.');
    }
  }

  /**
   * Calculate aggression level (affects position sizing)
   */
  private calculateAggression(): number {
    const baseAggression = 50;
    const winBonus = this.consecutiveWins * 10;
    const lossPenalty = this.consecutiveLosses * 15;

    return Math.max(0, Math.min(100, baseAggression + winBonus - lossPenalty));
  }

  /**
   * Calculate fear level
   */
  private calculateFearLevel(): number {
    return Math.min(100, this.consecutiveLosses * 25);
  }

  /**
   * Calculate greed level
   */
  private calculateGreedLevel(): number {
    return Math.min(100, this.consecutiveWins * 20);
  }

  /**
   * Reset emotional state (for testing or recovery)
   */
  public reset(): void {
    this.state = 'NEUTRAL';
    this.confidence = 70;
    this.consecutiveWins = 0;
    this.consecutiveLosses = 0;
    this.inCooldown = false;
    console.log('🔄 Emotional state reset to NEUTRAL');
  }

  /**
   * Print emotional summary
   */
  public printSummary(): void {
    const profile = this.getProfile();
    const risk = this.getRiskParameters();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   💫 EMOTIONAL PROFILE                                     ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ State:          ${profile.state.padEnd(42)}║`);
    console.log(`║ Confidence:     ${profile.confidence}%`.padEnd(61) + '║');
    console.log(`║ Aggression:     ${profile.aggression.toFixed(0)}%`.padEnd(61) + '║');
    console.log(`║ Fear Level:     ${profile.fearLevel.toFixed(0)}%`.padEnd(61) + '║');
    console.log(`║ Greed Level:    ${profile.greedLevel.toFixed(0)}%`.padEnd(61) + '║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║   RISK PARAMETERS                                          ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Max Position:   ${risk.maxPositionSize.toFixed(1)}%`.padEnd(61) + '║');
    console.log(`║ Min Confidence: ${risk.minConfidence}%`.padEnd(61) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  }
}
