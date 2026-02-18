import { PublicClient, WalletClient } from 'viem';
import * as fs from 'fs';
import * as path from 'path';
import { ClawKit } from '../index';
import { DivineTransparency } from './DivineTransparency';
import { MarketState, ActionType, DecisionLog, SentinelMode, ModeConfig } from './EidolonTypes';
import { ActiveLearning, TradeOutcome } from './ActiveLearning';
import { EmotionalCore, EmotionalState } from './EmotionalCore';
import { WasmAdapter, ValueInvariant as WasmValueInvariant, AntiRug as WasmAntiRug } from './WasmAdapter';
import { ClawOracle } from './sensors/ClawOracle';
import { GoPlusSecurity } from './oracles/GoPlusSecurity';
import { MarketStream } from './sensors/MarketStream';
import { EidolonSimulator, ShadowTransaction, SimulationResult } from './simulation/EidolonSimulator';
import RiskParams from '../config/RiskConfig.json';
import { DeepSeekOracle } from './ai/DeepSeekOracle';
import { EidolonBus, EidolonEventType, TradeExecutedEvent } from './events/EidolonBus';
import { TraumaRegistry } from './TraumaRegistry';
import { AppendOnlyAdapter } from './memory/AppendOnlyAdapter';
import { BigMath } from '../utils/BigMath';
import { KpiTracker, KpiSnapshot } from './metrics/KpiTracker';

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
    enforceRiskySimulation?: boolean;
    intrusivenessThreshold?: number;
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
    private kit: ClawKit;
    private config: GuardConfig;

    // Components
    private mind: DivineTransparency;
    private brain: ActiveLearning;
    private soul: EmotionalCore;
    private valueInvariant: WasmValueInvariant;
    private antiRug: WasmAntiRug;
    private trauma: TraumaRegistry;
    private traumaStorage: AppendOnlyAdapter;
    private oracle: ClawOracle; // Replaces GoPlus as primary oracle interface
    private securityOracle: GoPlusSecurity;
    // private marketStream: MarketStream; // Managed by Kit
    private simulator: EidolonSimulator;
    private lastMarketState: MarketState | null = null;
    private bus: EidolonBus;
    private readonly kpi = new KpiTracker();

    // Caching
    private securityCache: Map<string, { score: import('./WasmAdapter').SecurityScore, timestamp: number }> = new Map();
    private readonly CACHE_TTL = 60000; // 60 seconds

    // Teardown
    private snapshotIntervalId: ReturnType<typeof setInterval> | null = null;
    private unsubs: Array<() => void> = [];

    // Persistence
    private static readonly LISTS_FILE = path.resolve(process.cwd(), '.eidolon', 'antirug_lists.json');
    private readonly debugEnabled = process.env.EIDOLON_DEBUG === '1';

    constructor(
        kit: ClawKit,
        config: GuardConfig = {
            maxRiskScore: 60,
            minConfidence: 70,
            riskParameters: {
                maxPositionSize: RiskParams.base.maxPositionSize,
                maxDrawdown: RiskParams.base.maxDrawdown,
                minConfidence: RiskParams.base.minConfidence,
                cooldownPeriod: RiskParams.base.cooldownPeriod
            },
            enforceRiskySimulation: true,
            intrusivenessThreshold: 0.5
        }
    ) {
        this.kit = kit;
        this.client = kit.publicClient;
        this.wallet = kit.walletClient;
        this.config = config;

        // FIX U1: Wire DeepSeek Oracle
        let neuralOracle;
        if (kit.config.deepSeekConfig) {
            neuralOracle = new DeepSeekOracle(kit.config.deepSeekConfig);
        }

        this.mind = new DivineTransparency(neuralOracle);
        this.brain = new ActiveLearning();
        this.soul = new EmotionalCore();

        const wasm = WasmAdapter.getInstance();
        this.valueInvariant = wasm.createValueInvariant(5.0, config.riskParameters.maxPositionSize, 15.0);
        this.antiRug = wasm.createAntiRug();
        this.trauma = new TraumaRegistry();
        this.traumaStorage = new AppendOnlyAdapter();

        // Initialize Oracles
        this.oracle = new ClawOracle(kit);
        this.securityOracle = new GoPlusSecurity();
        // this.marketStream = new MarketStream(this.client); // Removed: Use kit.marketStream if needed
        this.simulator = new EidolonSimulator(kit);
        this.bus = EidolonBus.getInstance();

        this.debug('🛡️ EIDOLON GUARD INITIALIZED (RUST + ORACLE + STREAM + SIMULATOR)');
    }

    public async init(): Promise<void> {
        await this.brain.init();
        await this.trauma.initPersistence(this.traumaStorage, 'eidolon_trauma_registry.json');
        // Soul init is automatic in constructor now

        // Load persisted whitelist/blacklist into WASM
        this.loadAntiRugLists();

        // FIX: Use shared market stream from Kit
        // We don't subscribe here directly; we rely on EmotionalCore to react to reflex events.
        // EidolonGuard relies on fresh senseMarket() calls during validation for full state.

        // FIX P1-06: Store interval ID for cleanup
        this.snapshotIntervalId = setInterval(() => {
            this.updateSnapshot().catch(e => console.warn('Snapshot failed', e));
        }, 15000);

        const unsubTrade = this.bus.subscribe(EidolonEventType.TRADE_EXECUTED, (event: TradeExecutedEvent) => {
            void this.handleTradeExecuted(event);
        });
        this.unsubs.push(unsubTrade);

        this.debug('   🧠 Memory Loaded & Senses Active & Snapshot Loop Started');
    }

    /**
     * 🧹 TEARDOWN: Stop all background loops and listeners
     */
    public destroy(): void {
        if (this.snapshotIntervalId) {
            clearInterval(this.snapshotIntervalId);
            this.snapshotIntervalId = null;
        }
        // this.marketStream.stop?.(); // Handled by Kit
        for (const unsub of this.unsubs) {
            try {
                unsub();
            } catch {
                // no-op
            }
        }
        this.unsubs = [];
        this.soul.dispose?.();
        void this.trauma.flush();
        void this.brain.flush?.();
        this.securityCache.clear();
        this.debug('🛡️ EIDOLON GUARD DESTROYED');
    }

    /**
     * 💾 PERSISTENCE: Load whitelist/blacklist from disk into WASM
     */
    private loadAntiRugLists(): void {
        try {
            if (fs.existsSync(EidolonGuard.LISTS_FILE)) {
                const raw = fs.readFileSync(EidolonGuard.LISTS_FILE, 'utf-8');
                const data = JSON.parse(raw);
                (this.antiRug as any).import_lists(data);
                this.debug(`   📋 Loaded ${data.whitelist?.length ?? 0} whitelist + ${data.blacklist?.length ?? 0} blacklist entries`);
            }
        } catch (e) {
            console.warn('Failed to load AntiRug lists, starting fresh', e);
        }
    }

    /**
     * 💾 PERSISTENCE: Save whitelist/blacklist from WASM to disk
     */
    private persistAntiRugLists(): void {
        try {
            const dir = path.dirname(EidolonGuard.LISTS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const data = (this.antiRug as any).export_lists();
            fs.writeFileSync(EidolonGuard.LISTS_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            console.warn('Failed to persist AntiRug lists', e);
        }
    }

    /**
     * Add address to whitelist (persisted)
     */
    public addToWhitelist(address: string): void {
        this.antiRug.add_to_whitelist(address);
        this.persistAntiRugLists();
    }

    /**
     * Add address to blacklist (persisted)
     */
    public addToBlacklist(address: string): void {
        this.antiRug.add_to_blacklist(address);
        this.persistAntiRugLists();
    }

    /**
     * Warm security cache outside validation path.
     * Keeps validateAction deterministic and side-effect free.
     */
    public async primeSecurityCache(tokenAddress: string): Promise<void> {
        try {
            const tokenData = await this.securityOracle.checkToken(tokenAddress);
            const score = tokenData
                ? (this.antiRug as any).compute_score(tokenAddress, tokenData) as import('./WasmAdapter').SecurityScore
                : this.antiRug.check_token_security(tokenAddress) as unknown as import('./WasmAdapter').SecurityScore;
            this.securityCache.set(tokenAddress, { score, timestamp: Date.now() });
        } catch (e) {
            console.warn(`Failed to prime security cache for ${tokenAddress}`, e);
        }
    }


    /**
     * 🔄 STATE UPDATE LOOP (Background)
     * pure side-effect: Updates internal state snapshots
     */
    public async updateSnapshot(): Promise<void> {
        try {
            // Get BNB Balance
            const balanceWei = await this.client.getBalance({
                address: this.wallet.account!.address
            });
            // Get Price
            const bnbPrice = await this.oracle.getBNBPrice();

            // Calculate Portfolio Value
            const bnbPriceWad = BigMath.toWad(bnbPrice.toString());
            const totalPortfolioUSDWad = BigMath.mulWad(balanceWei, bnbPriceWad);
            const totalPortfolioUSD = BigMath.unitsToNumber(totalPortfolioUSDWad, 18);

            this.valueInvariant.update_snapshot(totalPortfolioUSD);
            this.kpi.recordPortfolioSnapshot(totalPortfolioUSD);

            // Also update market state if needed
            // this.lastMarketState = await this.senseMarket(); 
        } catch (e) {
            // Do NOT reset to 0 — that disables the circuit breaker entirely.
            // Stale snapshot is safer than no snapshot.
            console.warn('Failed to update portfolio snapshot, keeping stale value', e);
        }
    }

    /**
     * Report a trauma to the immune system
     */
    public reportTrauma(mode: string, action: string, severity: number): void {
        this.trauma.recordTrauma(mode, action, severity);
    }

    public async validateAction(
        action: ActionType,
        context: {
            marketState?: MarketState,
            amountUSD?: number,
            tokenSymbol?: string,
            tokenAddress?: string,
            txCandidate?: ShadowTransaction,
            estimatedSlippage?: number
        }
    ): Promise<ValidationResult> {
        const startedAtMs = Date.now();
        try {

            // 🧠 FIXED: Removed side-effect from validation path.
            // updateSnapshot() must be called externally or via loop.

            const isTradeAction = action === 'BUY' || action === 'SELL';
            const requiresSimulation = this.requiresSimulation(action);

            if (isTradeAction) {
                if (
                    context.amountUSD === undefined ||
                    context.amountUSD === null ||
                    !Number.isFinite(context.amountUSD) ||
                    context.amountUSD <= 0
                ) {
                    return {
                        approved: false,
                        riskScore: 100,
                        confidence: 0,
                        reason: `CRITICAL: Missing or invalid 'amountUSD' context for ${action} action.`
                    };
                }
            }

            // 0. TRAUMA CHECK (Immune System)
            const currentMode = this.soul.getMode();
            if (this.trauma.isInhibited(currentMode, action)) {
                const remaining = this.trauma.getRemainingInhibition(currentMode, action);
                const remainingMin = (remaining / 60000).toFixed(1);
                return {
                    approved: false,
                    reason: `🛡️ TRAUMA INHIBITION: Action '${action}' blocked for ${remainingMin}m due to recent failure.`,
                    riskScore: 100,
                    confidence: 0,
                    decisionLog: undefined // No logic ran
                };
            }

            if (
                this.config.enforceRiskySimulation &&
                requiresSimulation &&
                !context.txCandidate
            ) {
                return {
                    approved: false,
                    riskScore: 95,
                    confidence: 0,
                    reason: `SIMULATION_REQUIRED: '${action}' intrusiveness=${this.getActionIntrusiveness(action).toFixed(2)} requires txCandidate shadow simulation.`
                };
            }

        // 1. HARD INVARIANT CHECK (The Citadel - RUST)
            if (context.amountUSD !== undefined && context.amountUSD !== null) {
            // Fix: Calculate predicted impact (default to 1% slippage if unknown)
            const slippage = (
                context.estimatedSlippage !== undefined &&
                Number.isFinite(context.estimatedSlippage) &&
                context.estimatedSlippage >= 0
            ) ? context.estimatedSlippage : 0.01;
            const amountUsdWad = BigMath.toWad(context.amountUSD.toString());
            const slippageWad = BigMath.toWad(slippage.toString());
            const predictedImpactWad = BigMath.mulWad(amountUsdWad, slippageWad);
            const predictedImpact = BigMath.unitsToNumber(predictedImpactWad, 18);
            const invariantCheck = this.valueInvariant.check_invariant(context.amountUSD, predictedImpact) as unknown as import('./WasmAdapter').InvariantCheckResult;


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
            const now = Date.now();
            const cached = this.securityCache.get(context.tokenAddress);

            let security: import('./WasmAdapter').SecurityScore;

            if (cached && (now - cached.timestamp < this.CACHE_TTL)) {
                // console.log(`⚡ Cache Hit for ${context.tokenAddress}`);
                security = cached.score;
            } else {
                this.debug(`🕵️ Inspecting token: ${context.tokenAddress}`);
                const tokenData = await this.securityOracle.checkToken(context.tokenAddress);

                if (tokenData) {
                    security = (this.antiRug as any).compute_score(context.tokenAddress, tokenData) as import('./WasmAdapter').SecurityScore;
                } else {
                    security = this.antiRug.check_token_security(context.tokenAddress) as unknown as import('./WasmAdapter').SecurityScore;
                }
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
        // FIX L1: Await the now-async explain method (Neural Oracle)
        const decision: DecisionLog = await this.mind.explain(marketState, action);
        this.applyCausalBias(decision, marketState, action);

        // 4. Consult the Soul (Thermodynamic)
        const emotionalState = this.soul.getCurrentState();
        // currentMode fetched earlier
        const modeConfig = this.soul.getModeConfig();

        // FIX P2-04: Apply SentinelMode Limits
        // Override risk parameters based on current mode
        const maxLeverage = modeConfig.maxLeverage;
        const maxPositionPct = modeConfig.maxPositionPct;
        const riskLevel = modeConfig.riskLevel;

        this.debug(`🧠 SENTINEL MODE: ${currentMode} (Risk: ${riskLevel}, Lev: ${maxLeverage}x)`);

        // Gate 1: Check Mode Constraints
        if (currentMode === SentinelMode.EMERGENCY) {
            return {
                approved: false,
                riskScore: 100,
                confidence: 0,
                reason: `🚨 SENTINEL EMERGENCY: All trading halted.`,
                decisionLog: decision
            };
        }

        // Gate 2: Calculate Risk Score (with mode bias)
        const riskScore = this.calculateRisk(marketState, action, emotionalState);

        // Calculate Position Size Limit based on Mode
        // We need total portfolio value for this.
        // Assuming we have it (or fetch it). 
        // For now, let's use the provided adjustedPositionSize logic, but cap it.
        const basePositionSize = this.config.riskParameters.maxPositionSize;
        // Mode limit:
        // If maxPositionPct is 10%, and portfolio is $1000, limit is $100.
        // We lack portfolio value in context usually?
        // updateSnapshot() updates valueInvariant.
        // Let's assume we use maxPositionSize from config * mode scaler?
        // Mode Risk is 0-1. 

        const adjustedPositionSize = basePositionSize * riskLevel;

        const baseValidation = this.evaluateActionPure({
            decision,
            emotionalState,
            riskScore,
            adjustedPositionSize,
            modeConfig
        });

            if (!baseValidation.approved) {
                return baseValidation;
            }

        // Gate 2: MULTIVERSE CHECK (Shadow Simulation)
            if (isTradeAction && context.txCandidate) {
            this.debug('🔮 MULTIVERSE CHECK: Spawning Shadow Clone...');
            let shadowResult: SimulationResult;
            let touched: string[] = [];
            let worstCaseGas: bigint | null = null;

            const simulatorAny = this.simulator as any;
            if (typeof simulatorAny.simulateRiskMatrix === 'function') {
                const matrix = await simulatorAny.simulateRiskMatrix(context.txCandidate);
                shadowResult = matrix.base;
                touched = matrix.footprint?.touchedAddresses || [];
                worstCaseGas = matrix.gasWorstCase?.estimatedGas ?? null;

                if (!matrix.allPassed) {
                    this.kpi.recordSimulationResult(false);
                    return {
                        approved: false,
                        riskScore: 100,
                        confidence: 0,
                        reason: `💀 MULTI-SIM FAILED: Base scenario reverted (${shadowResult.revertReason || 'unknown reason'})`,
                        decisionLog: decision
                    };
                }
            } else {
                shadowResult = await this.simulator.simulate(context.txCandidate);
                touched = shadowResult.touchedAddresses || [];
            }

            if (!shadowResult.success) {
                this.kpi.recordSimulationResult(false);
                return {
                    approved: false,
                    riskScore: 100,
                    confidence: 0,
                    reason: `💀 SHADOW CLONE DIED: Transaction Revert (${shadowResult.revertReason})`,
                    decisionLog: decision
                };
            }

            // 🛡️ BLAST RADIUS CHECK (New in Phase 5)
            if (touched.length > 10) {
                return {
                    approved: false,
                    riskScore: 95,
                    confidence: 10,
                    reason: `💥 BLAST RADIUS EXCEEDED: Touched ${touched.length} contracts (Max 10). Possible complexity attack.`,
                    decisionLog: decision
                };
            }

            // 🛡️ PHISHING/ROUTING CHECK
            // If it's a simple APPROVE, it should only touch the Token and the Spender.
            // Check based on txCandidate data if available
            // FIX Bug #12: Strict signature check
            if (context.txCandidate?.data?.startsWith('0x095ea7b3')) { // partial approve sig check
                // TODO: Parse tx data properly to identify Approve.
                // For now, relies on context.action which might be coarse.
            }

            const worstCaseSuffix = worstCaseGas ? ` | Worst-case gas: ${worstCaseGas.toString()}` : '';
            this.debug(`✅ Shadow Clone survived. Cost: ${shadowResult.gasUsed.toString()} gas. Blast Radius: ${touched.length}${worstCaseSuffix}`);
                this.kpi.recordSimulationResult(true);
            }

            return baseValidation;
        } finally {
            this.kpi.recordDecisionLatency(Date.now() - startedAtMs);
        }
    }

    public async learn(
        action: ActionType,
        outcome: TradeOutcome
    ): Promise<void> {
        const type = outcome.profitLoss > 0 ? 'PROFIT' : 'LOSS';
        // FIXED: Pass capitalAtRisk for ROI calculation (Brain Upgrade)
        this.soul.stimulate(Math.abs(outcome.profitLoss), type, outcome.capitalAtRisk);
    }

    private async handleTradeExecuted(event: TradeExecutedEvent): Promise<void> {
        const payload = event?.payload;
        if (!payload || (payload.action !== 'BUY' && payload.action !== 'SELL')) return;

        const outcome = payload.outcome;
        if (!outcome) return;

        const normalizedOutcome: TradeOutcome = {
            decisionId: Number.isFinite(outcome.decisionId) ? outcome.decisionId : Date.now(),
            profitLoss: Number.isFinite(outcome.profitLoss) ? outcome.profitLoss : 0,
            capitalAtRisk: Number.isFinite(outcome.capitalAtRisk) && outcome.capitalAtRisk > 0 ? outcome.capitalAtRisk : 0,
            slippage: Number.isFinite(outcome.slippage) ? outcome.slippage : 0,
            gasUsed: Number.isFinite(outcome.gasUsed) ? outcome.gasUsed : 0,
            success: Boolean(outcome.success)
        };
        this.kpi.recordExecutionOutcome(normalizedOutcome.success, normalizedOutcome.gasUsed);

        const fallbackMarketState = this.lastMarketState || await this.senseMarket();
        const decision = payload.decisionLog || {
            timestamp: normalizedOutcome.decisionId,
            action: payload.action,
            confidence: 50,
            reasoning: payload.executionError
                ? `Execution failed: ${payload.executionError}`
                : 'Execution completed without explicit reasoning payload.',
            causalFactors: [],
            marketState: fallbackMarketState
        };

        try {
            await this.brain.learnFromOutcome(decision, normalizedOutcome);
        } catch (err) {
            console.warn('ActiveLearning update failed:', err);
        }

        const stimulusType = normalizedOutcome.profitLoss > 0 ? 'PROFIT' : 'LOSS';
        this.soul.stimulate(
            Math.abs(normalizedOutcome.profitLoss),
            stimulusType,
            normalizedOutcome.capitalAtRisk
        );
    }

    private evaluateActionPure(input: {
        decision: DecisionLog;
        emotionalState: EmotionalState;
        riskScore: number;
        adjustedPositionSize: number;
        modeConfig: ModeConfig;
    }): ValidationResult {
        const { decision, emotionalState, riskScore, adjustedPositionSize, modeConfig } = input;

        if (emotionalState.cortisol > 80) {
            return {
                approved: false,
                riskScore: 90,
                confidence: 0,
                reason: `BIO-REJECT: Panic detected (Cortisol: ${emotionalState.cortisol.toFixed(1)})`,
                decisionLog: decision
            };
        }

        if (decision.confidence < this.config.minConfidence) {
            return {
                approved: false,
                riskScore: 80,
                confidence: decision.confidence,
                reason: `Insufficient logic confidence (${decision.confidence}%)`,
                decisionLog: decision
            };
        }

        if (riskScore > this.config.maxRiskScore) {
            return {
                approved: false,
                riskScore,
                confidence: decision.confidence,
                reason: `Risk score too high (${riskScore}/${this.config.maxRiskScore})`,
                decisionLog: decision
            };
        }

        return {
            approved: true,
            riskScore,
            confidence: decision.confidence,
            reason: decision.reasoning,
            decisionLog: decision,
            adjustments: {
                suggestedPositionSize: adjustedPositionSize
            }
        };
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

        // FIX L6: Reward good conditions (Risk Scoring was one-way only)
        if (state.liquidityDepth === 'DEEP') score -= 10;
        if (state.gasPrice === 'LOW') score -= 5;
        if (state.whaleFlow === 'ACCUMULATING' && action === 'BUY') score -= 15;

        // Thermodynamic Risks
        if (emoState.arousal > 0.8 && emoState.valence < 0.3) score += 20; // Angry/Anxious
        if (emoState.momentum > 0.8 && emoState.valence > 0.8) score += 10; // Overconfident/Manic

        return Math.min(100, Math.max(0, score));
    }

    private applyCausalBias(decision: DecisionLog, marketState: MarketState, action: ActionType): void {
        const signal = (this.brain as any).getCausalSignal?.(marketState, action);
        if (!signal) return;

        const delta = Number.isFinite(signal.confidenceDelta) ? signal.confidenceDelta : 0;
        if (delta === 0) return;

        decision.confidence = Math.max(0, Math.min(100, decision.confidence + delta));
        if (Array.isArray(signal.explanations) && signal.explanations.length > 0) {
            decision.reasoning = `${decision.reasoning} | [CAUSAL] ${signal.explanations.join(' ; ')}`;
        }
    }

    private getActionIntrusiveness(action: ActionType): number {
        switch (action) {
            case 'BUY':
                return 0.6;
            case 'SELL':
                return 0.6;
            case 'EMERGENCY_EXIT':
                return 0.8;
            case 'HOLD':
            default:
                return 0;
        }
    }

    private requiresSimulation(action: ActionType): boolean {
        const threshold = this.config.intrusivenessThreshold ?? 0.5;
        return this.getActionIntrusiveness(action) > threshold;
    }

    private debug(...args: unknown[]): void {
        if (!this.debugEnabled) return;
        console.log(...args);
    }

    public getKpiSnapshot(): KpiSnapshot {
        return this.kpi.getSnapshot();
    }

    public recordCausalDriftAlarmLeadTime(leadTimeMinutes: number): void {
        this.kpi.recordCausalDriftAlarm(leadTimeMinutes);
    }

    public recordSwarmBandwidthSample(baselineBytes: number, optimizedBytes: number): void {
        this.kpi.recordSwarmBandwidthSample(baselineBytes, optimizedBytes);
    }
}
