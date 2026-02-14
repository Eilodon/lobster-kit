import { PublicClient } from 'viem';

/**
 * 🫀 EIDOLON SENTINEL HEART
 * Adaptive Oscillator - Adjusts processing frequency based on market conditions
 * 
 * Architecture: Public framework with placeholder parameters
 * Production config: Available in ClawKit Pro or _production/config.ts (gitignored)
 */

// ⚠️ PLACEHOLDER CONFIG - Not optimized for production
// Production values are tuned through 1000+ backtests
export const HEART_CONFIG = {
  RHR: 3000,              // Resting Heart Rate: 3s (1 block on opBNB)
  ADRENALINE: 500,        // Adrenaline Spike: 0.5s
  VOLATILITY_THRESHOLD: 2.0, // % change to trigger adrenaline
  MIN_DELAY_MS: 100,      // FIX M3: Minimum delay (prevent spam)
  MAX_DELAY_MS: 60000,    // FIX M3: Maximum delay (prevent sleep)
};

export type HeartMode = 'ZEN' | 'ADRENALINE' | 'SLEEP';

export interface HeartMetrics {
  currentMode: HeartMode;
  bpm: number;            // Beats per minute
  totalBeats: number;
  modeChanges: number;
  avgExecutionTime: number;
}

export class SentinelHeart {
  private isAlive: boolean = false;
  private currentMode: HeartMode = 'ZEN';
  private lastPrice: number = 0;
  private beatCount: number = 0;
  private modeChangeCount: number = 0;
  private executionTimes: number[] = [];

  constructor(
    private publicClient: PublicClient,
    private onTick: () => Promise<void>,
    private config = HEART_CONFIG,
    private priceOracle?: () => Promise<number> // FIX C3: injectable oracle
  ) { }

  /**
   * Start the heart - begin adaptive processing
   */
  public async start() {
    if (this.isAlive) {
      console.log('🫀 Heart already beating');
      return;
    }

    this.isAlive = true;
    console.log('🫀 EIDOLON SENTINEL HEART: STARTED');
    console.log(`   Mode: ${this.currentMode} | Interval: ${this.getNextDelay()}ms`);

    this.beat();
  }

  /**
   * Stop the heart gracefully
   */
  public stop() {
    this.isAlive = false;
    console.log('🫀 EIDOLON SENTINEL HEART: STOPPED');
    this.printMetrics();
  }

  /**
   * Get current heart metrics
   */
  public getMetrics(): HeartMetrics {
    const avgExecTime = this.executionTimes.length > 0
      ? this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length
      : 0;

    return {
      currentMode: this.currentMode,
      bpm: 60000 / this.getNextDelay(),
      totalBeats: this.beatCount,
      modeChanges: this.modeChangeCount,
      avgExecutionTime: avgExecTime
    };
  }

  /**
   * Core heartbeat - Elastic Time implementation
   */
  private async beat() {
    if (!this.isAlive) return;

    const startTime = Date.now();
    this.beatCount++;

    try {
      // 1. Execute Brain Logic
      await this.onTick();

      // 2. Sense Market Pulse
      const currentPrice = await this.getMarketPulse();

      // 3. Adapt Heart Rate
      this.adjustRate(currentPrice);

      // Track execution time
      const executionTime = Date.now() - startTime;
      this.executionTimes.push(executionTime);

      // Keep only last 100 measurements
      if (this.executionTimes.length > 100) {
        this.executionTimes.shift();
      }

    } catch (error) {
      console.error('💔 Heart murmur (Error):', error);
      // Don't stop on error, keep beating
    }

    // Calculate next heartbeat
    const executionTime = Date.now() - startTime;
    const nextDelay = this.getNextDelay();
    const adjustedDelay = Math.max(0, nextDelay - executionTime);

    setTimeout(() => this.beat(), adjustedDelay);
  }

  /**
   * Adjust heart rate based on market volatility
   */
  private adjustRate(currentPrice: number) {
    if (this.lastPrice === 0) {
      this.lastPrice = currentPrice;
      return;
    }

    // Calculate volatility
    const volatility = Math.abs((currentPrice - this.lastPrice) / this.lastPrice) * 100;

    const previousMode = this.currentMode;

    // State transitions
    if (volatility > this.config.VOLATILITY_THRESHOLD) {
      this.currentMode = 'ADRENALINE';
    } else if (volatility < this.config.VOLATILITY_THRESHOLD * 0.3) {
      this.currentMode = 'ZEN';
    }
    // SLEEP mode can be implemented for ultra-low activity periods

    // Log mode changes
    if (previousMode !== this.currentMode) {
      this.modeChangeCount++;
      const emoji = this.currentMode === 'ADRENALINE' ? '⚡' : '🧘';
      console.log(`\n${emoji} MODE SHIFT: ${previousMode} → ${this.currentMode}`);
      console.log(`   Volatility: ${volatility.toFixed(2)}% | New Interval: ${this.getNextDelay()}ms\n`);
    }

    this.lastPrice = currentPrice;
  }

  /**
   * Get next heartbeat delay based on current mode
   */
  private getNextDelay(): number {
    const baseDelay = this.currentMode === 'ADRENALINE'
      ? this.config.ADRENALINE
      : this.config.RHR;

    // Enforce bounds (FIX M3: names now match semantics)
    return Math.max(
      this.config.MIN_DELAY_MS,
      Math.min(this.config.MAX_DELAY_MS, baseDelay)
    );
  }

  /**
   * Sense market pulse - Get current price.
   * FIX C3: Uses injected priceOracle instead of Math.random().
   */
  private async getMarketPulse(): Promise<number> {
    if (this.priceOracle) {
      return await this.priceOracle();
    }

    throw new Error(
      'SentinelHeart: priceOracle not configured. ' +
      'Inject a price oracle function in the constructor to enable adaptive timing.'
    );
  }

  /**
   * Print heart metrics summary
   */
  private printMetrics() {
    const metrics = this.getMetrics();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   HEART METRICS SUMMARY                ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║ Total Beats:      ${metrics.totalBeats.toString().padEnd(20)}║`);
    console.log(`║ Mode Changes:     ${metrics.modeChanges.toString().padEnd(20)}║`);
    console.log(`║ Avg Exec Time:    ${metrics.avgExecutionTime.toFixed(2)}ms`.padEnd(42) + '║');
    console.log(`║ Final Mode:       ${metrics.currentMode.padEnd(20)}║`);
    console.log('╚════════════════════════════════════════╝\n');
  }
}
