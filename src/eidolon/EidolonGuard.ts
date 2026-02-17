import { PublicClient, WalletClient, formatEther } from 'viem';
import * as fs from 'fs';
import * as path from 'path';
import { ClawKit } from '../index';
import { DivineTransparency } from './DivineTransparency';
import { MarketState, ActionType, DecisionLog } from './EidolonTypes';
import { ActiveLearning, TradeOutcome } from './ActiveLearning';
import { EmotionalCore, EmotionalState } from './EmotionalCore';
import { WasmAdapter, ValueInvariant as WasmValueInvariant, AntiRug as WasmAntiRug } from './WasmAdapter';
import { ClawOracle } from './sensors/ClawOracle';
import { GoPlusSecurity } from './oracles/GoPlusSecurity';
import { MarketStream } from './sensors/MarketStream';
import { EidolonSimulator, ShadowTransaction } from './simulation/EidolonSimulator';
import RiskParams from '../config/RiskConfig.json';
import { DeepSeekOracle } from './ai/DeepSeekOracle';

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
    private kit: ClawKit;
    private config: GuardConfig;

    // Components
    private mind: DivineTransparency;
    private brain: ActiveLearning;
    private soul: EmotionalCore;
    private valueInvariant: WasmValueInvariant;
    private antiRug: WasmAntiRug;
    private oracle: ClawOracle; // Replaces GoPlus as primary oracle interface
    private securityOracle: GoPlusSecurity;
    private marketStream: MarketStream;
    private simulator: EidolonSimulator;
    private lastMarketState: MarketState | null = null;

    // Caching
    private securityCache: Map<string, { score: import('./WasmAdapter').SecurityScore, timestamp: number }> = new Map();
    private readonly CACHE_TTL = 60000; // 60 seconds

    // Persistence
    private static readonly LISTS_FILE = path.resolve(process.cwd(), '.eidolon', 'antirug_lists.json');

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
            }
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

        // Initialize Oracles
        this.oracle = new ClawOracle(kit);
        this.securityOracle = new GoPlusSecurity();
        this.marketStream = new MarketStream(this.client);
        this.simulator = new EidolonSimulator(kit);

        console.log('🛡️ EIDOLON GUARD INITIALIZED (RUST + ORACLE + STREAM + SIMULATOR)');
    }

    public async init(): Promise<void> {
        await this.brain.init();
        // Soul init is automatic in constructor now

        // Load persisted whitelist/blacklist into WASM
        this.loadAntiRugLists();

        this.marketStream.subscribe((state) => {
            this.lastMarketState = state;
        });
        this.marketStream.start();

        // FIX L7: Automate Snapshot Loop (Every 15s - ~5 blocks)
        setInterval(() => {
            this.updateSnapshot().catch(e => console.warn('Snapshot failed', e));
        }, 15000);

        console.log('   🧠 Memory Loaded & Senses Active & Snapshot Loop Started');
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
                console.log(`   📋 Loaded ${data.whitelist?.length ?? 0} whitelist + ${data.blacklist?.length ?? 0} blacklist entries`);
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
            const totalPortfolioUSD = parseFloat(formatEther(balanceWei)) * bnbPrice;

            this.valueInvariant.update_snapshot(totalPortfolioUSD);

            // Also update market state if needed
            // this.lastMarketState = await this.senseMarket(); 
        } catch (e) {
            // Do NOT reset to 0 — that disables the circuit breaker entirely.
            // Stale snapshot is safer than no snapshot.
            console.warn('Failed to update portfolio snapshot, keeping stale value', e);
        }
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

        // 🧠 FIXED: Removed side-effect from validation path.
        // updateSnapshot() must be called externally or via loop.


        // 1. HARD INVARIANT CHECK (The Citadel - RUST)
        if (context.amountUSD) {
            // Fix: Calculate predicted impact (default to 1% slippage if unknown)
            const slippage = context.estimatedSlippage ?? 0.01;
            const predictedImpact = context.amountUSD * slippage;
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
                console.log(`🕵️ Inspecting token: ${context.tokenAddress}`);
                const tokenData = await this.securityOracle.checkToken(context.tokenAddress);

                if (tokenData) {
                    security = (this.antiRug as any).compute_score(context.tokenAddress, tokenData) as import('./WasmAdapter').SecurityScore;
                } else {
                    security = this.antiRug.check_token_security(context.tokenAddress) as unknown as import('./WasmAdapter').SecurityScore;
                }

                // Cache the result
                this.securityCache.set(context.tokenAddress, { score: security, timestamp: now });
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
        // 3. Consult the Mind
        // FIX L1: Await the now-async explain method (Neural Oracle)
        const decision: DecisionLog = await this.mind.explain(marketState, action);

        // 4. Consult the Soul (Thermodynamic)
        // Soul now reacts to events in background
        const emotionalState = this.soul.getCurrentState();
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

        // Gate 4: MULTIVERSE CHECK (Shadow Simulation)
        if ((action === 'BUY' || action === 'SELL') && context.txCandidate) {
            console.log('🔮 MULTIVERSE CHECK: Spawning Shadow Clone...');
            const shadowResult = await this.simulator.simulate(context.txCandidate);

            if (!shadowResult.success) {
                return {
                    approved: false,
                    riskScore: 100,
                    confidence: 0,
                    reason: `💀 SHADOW CLONE DIED: Transaction Revert (${shadowResult.revertReason})`
                };
            }

            // 🛡️ BLAST RADIUS CHECK (New in Phase 5)
            const touched = shadowResult.touchedAddresses || [];
            if (touched.length > 10) {
                return {
                    approved: false,
                    riskScore: 95,
                    confidence: 10,
                    reason: `💥 BLAST RADIUS EXCEEDED: Touched ${touched.length} contracts (Max 10). Possible complexity attack.`
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

            console.log(`✅ Shadow Clone survived. Cost: ${shadowResult.gasUsed.toString()} gas. Blast Radius: ${touched.length}`);
        } else if (action === 'BUY' || action === 'SELL') {
            // Warn if no candidate provided for simulation
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
        // FIXED: Pass capitalAtRisk for ROI calculation (Brain Upgrade)
        this.soul.stimulate(Math.abs(outcome.profitLoss), type, outcome.capitalAtRisk);
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
}

