import { PublicClient, WalletClient } from 'viem';
import { DivineTransparency } from './DivineTransparency';
import { MarketState, ActionType, DecisionLog } from './EidolonTypes';
import { ActiveLearning, TradeOutcome } from './ActiveLearning';
import { EmotionalCore, EmotionalState } from './EmotionalCore';
import { WasmAdapter, ValueInvariant as WasmValueInvariant, AntiRug as WasmAntiRug } from './WasmAdapter';
import { GoPlusSecurity } from './oracles/GoPlusSecurity';
import { MarketStream } from './sensors/MarketStream';

/**
 * 🛡️ EIDOLON GUARD
 * Security & Validation Layer - "The Soul"
 */

export interface RiskParameters {
    maxPositionSize: number;
    maxDrawdown: number;
    minConfidence: number;
    cooldownPeriod: number;
}

export interface GuardConfig {
    maxRiskScore: number;
    minConfidence: number;
    riskParameters: RiskParameters;
    marketStateSensor?: () => Promise<MarketState>;
}

export interface ValidationResult {
    approved: boolean;
    reason: string;
    riskScore: number;
    confidence: number;
    decisionLog?: DecisionLog;
    adjustments?: {
        suggestedPositionSize?: number;
        warning?: string;
    };
}

export class EidolonGuard {
    private client: PublicClient;
    private wallet: WalletClient;
    private config: GuardConfig;

    // Components
    private mind: DivineTransparency;
    private brain: ActiveLearning;
    private soul: EmotionalCore;
    private valueInvariant: WasmValueInvariant;
    private antiRug: WasmAntiRug;
    private oracle: GoPlusSecurity;
    private marketStream: MarketStream;
    private lastMarketState: MarketState | null = null;

    constructor(
        client: PublicClient,
        wallet: WalletClient,
        config: GuardConfig = {
            maxRiskScore: 60,
            minConfidence: 70,
            riskParameters: {
                maxPositionSize: 1000,
                maxDrawdown: 10,
                minConfidence: 70,
                cooldownPeriod: 60000
            }
        }
    ) {
        this.client = client;
        this.wallet = wallet;
        this.config = config;

        this.mind = new DivineTransparency();
        this.brain = new ActiveLearning();
        this.soul = new EmotionalCore();

        const wasm = WasmAdapter.getInstance();
        this.valueInvariant = wasm.createValueInvariant(5.0, config.riskParameters.maxPositionSize, 15.0);
        this.antiRug = wasm.createAntiRug();

        this.oracle = new GoPlusSecurity();
        this.marketStream = new MarketStream(client);

        console.log('🛡️ EIDOLON GUARD INITIALIZED (RUST + GOPLUS + STREAM)');
    }

    public async init(): Promise<void> {
        await this.brain.init();
        // Soul init is automatic in constructor now

        this.marketStream.subscribe((state) => {
            this.lastMarketState = state;
        });
        this.marketStream.start();
        console.log('   🧠 Memory Loaded & Senses Active');
    }

    public async validateAction(
        action: ActionType,
        context: {
            marketState?: MarketState,
            amountUSD?: number,
            tokenSymbol?: string,
            tokenAddress?: string
        }
    ): Promise<ValidationResult> {

        // 0. Update Security Snapshot
        const mockTotalPortfolio = 10000;
        this.valueInvariant.update_snapshot(mockTotalPortfolio);

        // 1. HARD INVARIANT CHECK (The Citadel - RUST)
        if (context.amountUSD) {
            const invariantCheck = this.valueInvariant.check_invariant(context.amountUSD, 0) as unknown as import('./WasmAdapter').InvariantCheckResult;

            if (invariantCheck.circuit_broken) {
                return {
                    approved: false,
                    reason: `💥 CIRCUIT BREAKER TRIGGERED (RUST): ${invariantCheck.reason}`,
                    riskScore: 100,
                    confidence: 0
                };
            }

            if (!invariantCheck.safe) {
                return {
                    approved: false,
                    reason: `🛡️ CITADEL BLOCK (RUST): ${invariantCheck.reason}`,
                    riskScore: 90,
                    confidence: 10
                };
            }
        }

        // Check 2: Anti-Rug
        if (action === 'BUY' && context.tokenAddress) {
            console.log(`🕵️ Inspecting token: ${context.tokenAddress}`);
            const tokenData = await this.oracle.checkToken(context.tokenAddress);
            let security: import('./WasmAdapter').SecurityScore;

            if (tokenData) {
                security = (this.antiRug as any).compute_score(context.tokenAddress, tokenData) as import('./WasmAdapter').SecurityScore;
            } else {
                security = this.antiRug.check_token_security(context.tokenAddress) as unknown as import('./WasmAdapter').SecurityScore;
            }

            if (security.is_honeypot || !security.contract_verified || security.score < 50) {
                return {
                    approved: false,
                    reason: `🕵️ ANTI-RUG BLOCK (RUST): Token ${security.status} (Score: ${security.score})`,
                    riskScore: 100,
                    confidence: 0
                };
            }
        }

        // 2. Sense Market
        const marketState = context.marketState || this.lastMarketState || await this.senseMarket();

        // 3. Consult the Mind
        const decision: DecisionLog = await this.mind.explain(marketState, action);

        // 4. Consult the Soul (Thermodynamic)
        // Tick with estimated volatility (0.1 default for now)
        const emotionalState = await this.soul.tick(0.1);
        const riskMultiplier = this.soul.getRiskMultiplier();

        // Gate 1: Emotional Safety (Cortisol Check)
        if (emotionalState.cortisol > 80) { // Panic threshold
            return {
                approved: false,
                riskScore: 90,
                confidence: 0,
                reason: `BIO-REJECT: Panic detected (Cortisol: ${emotionalState.cortisol.toFixed(1)})`
            };
        }

        // Gate 2: Logic/Confidence
        if (decision.confidence < this.config.minConfidence) {
            return {
                approved: false,
                riskScore: 80,
                confidence: decision.confidence,
                reason: `Insufficient logic confidence (${decision.confidence}%)`
            };
        }

        // Gate 3: Risk Calculation
        const riskScore = this.calculateRisk(marketState, action, emotionalState);
        if (riskScore > this.config.maxRiskScore) {
            return {
                approved: false,
                riskScore,
                confidence: decision.confidence,
                reason: `Risk score too high (${riskScore}/${this.config.maxRiskScore})`
            };
        }

        // Gate 4: Context Integrity
        if (action === 'BUY' || action === 'SELL') {
            if (context.amountUSD === undefined || context.amountUSD === null) {
                return {
                    approved: false,
                    riskScore: 100,
                    confidence: decision.confidence,
                    reason: `CRITICAL: Missing 'amountUSD' context for ${action} action.`
                };
            }
        }

        const adjustedPositionSize = this.config.riskParameters.maxPositionSize * riskMultiplier;

        return {
            approved: true,
            riskScore,
            confidence: decision.confidence,
            reason: decision.reasoning,
            adjustments: {
                suggestedPositionSize: adjustedPositionSize
            }
        };
    }

    public async learn(
        action: ActionType,
        outcome: TradeOutcome
    ): Promise<void> {
        const type = outcome.profitLoss > 0 ? 'PROFIT' : 'LOSS';
        this.soul.stimulate(Math.abs(outcome.profitLoss), type);
    }

    private async senseMarket(): Promise<MarketState> {
        if (this.config.marketStateSensor) {
            return await this.config.marketStateSensor();
        }
        return {
            gasPrice: 'MEDIUM',
            whaleFlow: 'NEUTRAL',
            sentiment: 'NEUTRAL',
            liquidityDepth: 'DEEP',
            priceAction: 'RANGING'
        };
    }

    private calculateRisk(state: MarketState, action: ActionType, emoState: EmotionalState): number {
        let score = 50;

        if (state.liquidityDepth === 'THIN') score += 20;
        if (state.gasPrice === 'HIGH') score += 10;
        if (state.whaleFlow === 'DUMPING' && action === 'BUY') score += 30;

        // Thermodynamic Risks
        if (emoState.arousal > 0.8 && emoState.valence < 0.3) score += 20; // Angry/Anxious
        if (emoState.momentum > 0.8 && emoState.valence > 0.8) score += 10; // Overconfident/Manic

        return Math.min(100, Math.max(0, score));
    }
}
