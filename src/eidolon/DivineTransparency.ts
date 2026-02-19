import { IOracle, MarketContext } from './ai/IOracle';
import {
  MarketState,
  ActionType,
  DecisionLog,
  CausalFactor,
  ReasoningWeights,
  DEFAULT_WEIGHTS
} from './EidolonTypes';

/**
 * 🔮 DIVINE TRANSPARENCY
 * Causal Reasoning Engine - Explains WHY the agent makes decisions
 * 
 * Architecture: Neuro-Symbolic Hybrid
 * 1. Analyzes market state (Symbolic)
 * 2. Consults LLM Oracle for Contextual Weights (Neural)
 * 3. Synthesizes explanation
 */

export class DivineTransparency {
  private readonly MAX_HISTORY_SIZE = 1000;
  private decisionHistory: DecisionLog[] = [];
  private weights: ReasoningWeights = DEFAULT_WEIGHTS;
  private oracle?: IOracle;

  constructor(oracle?: IOracle) {
    this.oracle = oracle;
    if (this.oracle) {
      console.log(`🔮 Connected to ${this.oracle.getName()}`);
    }
  }

  /**
   * Analyze market state and explain reasoning for action
   * @param state Current market observations
   * @param action Proposed action
   * @returns Decision log with confidence and reasoning
   */
  public async explain(state: MarketState, action: ActionType): Promise<DecisionLog> {

    // FIX C3: Use local variable to prevent permanent mutation of base weights
    let effectiveWeights = { ...this.weights };
    let neuralNarrative = '';

    if (this.oracle) {
      try {
        const insight = await this.oracle.analyze({
          marketState: state
        });
        // Override local weights with neural context
        effectiveWeights = { ...effectiveWeights, ...insight.weights };
        neuralNarrative = insight.narrative;
      } catch (e) {
        console.warn('🔮 Oracle connection failed, using instinct (Symbolic)', e);
      }
    }

    const factors: CausalFactor[] = [];
    let confidence = 50; // Base confidence

    // 1. Causal Inference - Analyze each factor

    // Whale Flow Analysis
    const whaleImpact = effectiveWeights.whaleFlow[state.whaleFlow];
    if (whaleImpact !== 0) {
      factors.push({
        name: 'Whale Activity',
        impact: whaleImpact,
        description: this.getWhaleDescription(state.whaleFlow)
      });
      confidence += whaleImpact;
    }

    // Gas Price Analysis
    const gasImpact = effectiveWeights.gasPrice[state.gasPrice];
    if (gasImpact !== 0) {
      factors.push({
        name: 'Network Cost',
        impact: gasImpact,
        description: this.getGasDescription(state.gasPrice)
      });
      confidence += gasImpact;
    }

    // Liquidity Analysis (especially important for SELL actions)
    const liquidityImpact = effectiveWeights.liquidityDepth[state.liquidityDepth];
    if (state.liquidityDepth === 'THIN' && action === 'SELL') {
      factors.push({
        name: 'Liquidity Risk',
        impact: liquidityImpact * 2, // Double penalty for selling into thin liquidity
        description: '⚠️ High slippage risk - thin order book'
      });
      confidence += liquidityImpact * 2;
    } else if (liquidityImpact !== 0) {
      factors.push({
        name: 'Liquidity Depth',
        impact: liquidityImpact,
        description: this.getLiquidityDescription(state.liquidityDepth)
      });
      confidence += liquidityImpact;
    }

    // Sentiment Analysis (contrarian)
    const sentimentImpact = effectiveWeights.sentiment[state.sentiment];
    if (sentimentImpact !== 0) {
      factors.push({
        name: 'Market Sentiment',
        impact: sentimentImpact,
        description: this.getSentimentDescription(state.sentiment)
      });
      confidence += sentimentImpact;
    }

    // Price Action Analysis
    const priceImpact = effectiveWeights.priceAction[state.priceAction];
    if (priceImpact !== 0) {
      factors.push({
        name: 'Price Momentum',
        impact: priceImpact,
        description: this.getPriceActionDescription(state.priceAction)
      });
      confidence += priceImpact;
    }

    // 2. Action-Specific Adjustments
    // FIX Bug #27: Clamp before adjustment to prevent negative logic flip
    confidence = Math.max(0, confidence);
    confidence = this.adjustForAction(action, state, confidence);

    // 3. Bounds checking
    confidence = Math.min(100, Math.max(0, confidence));

    // 4. Generate narrative
    let reasoning = this.generateNarrative(action, factors, confidence);

    // Inject Neural Voice if available
    if (neuralNarrative) {
      reasoning = `[ORACLE]: "${neuralNarrative}" | [SYSTEM]: ${reasoning}`;
    }

    const log: DecisionLog = {
      timestamp: Date.now(),
      action,
      confidence,
      reasoning,
      causalFactors: factors,
      marketState: state
    };

    this.decisionHistory.push(log);

    // FIXED: Prevent memory leak with circular buffer logic
    if (this.decisionHistory.length > this.MAX_HISTORY_SIZE) {
      this.decisionHistory.shift();
    }

    this.logToConsole(log);

    return log;
  }

  /**
   * Adjust confidence based on action type and state
   */
  private adjustForAction(
    action: ActionType,
    state: MarketState,
    baseConfidence: number
  ): number {
    let adjusted = baseConfidence;

    // Emergency exit should have high confidence if triggered
    if (action === 'EMERGENCY_EXIT') {
      adjusted = Math.max(adjusted, 90);
    }

    // Reduce confidence for selling into dumps
    if (action === 'SELL' && state.priceAction === 'DUMPING') {
      adjusted *= 0.7; // Panic selling penalty
    }

    // Reduce confidence for buying into pumps
    if (action === 'BUY' && state.priceAction === 'PUMPING' && state.sentiment === 'EUPHORIC') {
      adjusted *= 0.8; // FOMO penalty
    }

    return adjusted;
  }

  /**
   * Generate human-readable narrative
   */
  private generateNarrative(
    action: ActionType,
    factors: CausalFactor[],
    confidence: number
  ): string {
    if (factors.length === 0) {
      return `Executing ${action} based on standard routine.`;
    }

    // Sort factors by absolute impact
    const sortedFactors = factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

    // Get top 3 factors
    const topFactors = sortedFactors.slice(0, 3);

    const factorDescriptions = topFactors.map(f => {
      const sign = f.impact > 0 ? '✓' : '✗';
      return `${sign} ${f.description}`;
    });

    return `EXECUTING ${action} (${confidence}% confident). ${factorDescriptions.join(' | ')}`;
  }

  /**
   * Log to console with Eidolon styling
   */
  private logToConsole(log: DecisionLog) {
    const confidenceColor = log.confidence > 80 ? '\x1b[32m' :
      log.confidence > 50 ? '\x1b[33m' : '\x1b[31m';

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   🔮 DIVINE TRANSPARENCY - DECISION ANALYSIS               ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ ACTION:      ${log.action.padEnd(45)}║`);
    console.log(`║ CONFIDENCE:  ${confidenceColor}${log.confidence}%\x1b[0m`.padEnd(70) + '║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ REASONING:                                                 ║`);

    // Word wrap reasoning
    const maxWidth = 56;
    const words = log.reasoning.split(' ');
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + word).length > maxWidth) {
        console.log(`║ ${currentLine.padEnd(56)} ║`);
        currentLine = word + ' ';
      } else {
        currentLine += word + ' ';
      }
    }
    if (currentLine.trim()) {
      console.log(`║ ${currentLine.trim().padEnd(56)} ║`);
    }

    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║ CAUSAL FACTORS:                                            ║');

    log.causalFactors.forEach(factor => {
      const impactStr = factor.impact > 0 ? `+${factor.impact}` : `${factor.impact}`;
      const line = `${factor.name}: ${impactStr}`;
      console.log(`║   ${line.padEnd(54)} ║`);
    });

    console.log('╚════════════════════════════════════════════════════════════╝\n');
  }

  /**
   * Get decision history for analysis
   */
  public getHistory(): DecisionLog[] {
    return this.decisionHistory;
  }

  /**
   * Get recent decisions
   */
  public getRecentDecisions(count: number = 10): DecisionLog[] {
    return this.decisionHistory.slice(-count);
  }

  /**
   * Export history for analysis
   */
  public exportHistory(): string {
    return JSON.stringify(this.decisionHistory, null, 2);
  }

  // Helper description methods
  private getWhaleDescription(flow: MarketState['whaleFlow']): string {
    switch (flow) {
      case 'ACCUMULATING': return '🐳 Smart money is buying aggressively';
      case 'DUMPING': return '📉 Whales exiting positions';
      case 'NEUTRAL': return 'No significant whale activity';
    }
  }

  private getGasDescription(gas: MarketState['gasPrice']): string {
    switch (gas) {
      case 'LOW': return '⛽ Network cost optimal for trading';
      case 'MEDIUM': return 'Gas prices moderate';
      case 'HIGH': return '⚠️ High network fees - poor trade economics';
    }
  }

  private getLiquidityDescription(depth: MarketState['liquidityDepth']): string {
    switch (depth) {
      case 'THIN': return '⚠️ Thin liquidity - high slippage risk';
      case 'DEEP': return 'Deep liquidity - low slippage expected';
    }
  }

  private getSentimentDescription(sentiment: MarketState['sentiment']): string {
    switch (sentiment) {
      case 'EUPHORIC': return '⚠️ Extreme greed - contrarian sell signal';
      case 'FEAR': return '💎 Extreme fear - contrarian buy opportunity';
      case 'NEUTRAL': return 'Neutral market sentiment';
    }
  }

  private getPriceActionDescription(action: MarketState['priceAction']): string {
    switch (action) {
      case 'PUMPING': return '🚀 Strong upward momentum';
      case 'DUMPING': return '📉 Strong downward pressure';
      case 'RANGING': return 'Price consolidating in range';
    }
  }
}
