import { EidolonGuard, type ValidationResult } from '@clawkit/soul';
import { type ActionType, EidolonBus, EidolonEventType } from '@clawkit/core';

/**
 * 🔌 OPENCLAW ADAPTER
 * 
 * Connects ClawKit capabilities to OpenClaw's Skill System.
 * Defines the standard interface for "The Hand".
 */

export interface ActionInput {
    action: string;
    params: Record<string, unknown>;
}

export interface ActionOutput {
    status: 'success' | 'failed' | 'denied';
    data?: any;
    error?: string;
    validation?: ValidationResult;
}

export interface SkillDefinition {
    name: string;
    description: string;
    schema: any; // JSON Schema for params
    handler: (params: any) => Promise<any>;
}

export class OpenClawAdapter {
    private skills: Map<string, SkillDefinition> = new Map();
    private guard: EidolonGuard;
    private bus: EidolonBus;

    constructor(guard: EidolonGuard) {
        this.guard = guard;
        this.bus = EidolonBus.getInstance();
    }

    /**
     * Register a new skill (e.g., "swap_tokens")
     */
    public registerSkill(skill: SkillDefinition) {
        this.skills.set(skill.name, skill);
        console.log(`🔌 Skill registered: ${skill.name}`);
    }

    /**
     * Execute a skill request from OpenClaw (The Brain)
     */
    public async execute(input: ActionInput): Promise<ActionOutput> {
        const skill = this.skills.get(input.action);
        if (!skill) {
            return { status: 'failed', error: `Unknown skill: ${input.action}` };
        }

        console.log(`🔌 OpenClaw requested: ${input.action}`);

        try {
            // Gate 3: Guard Check (Pre-Validation)
            const safeParams = input.params as Record<string, unknown>;
            const mappedAction = this.mapSkillToAction(input.action);
            const validation = await this.guard.validateAction(mappedAction, safeParams);

            if (!validation.approved) {
                console.warn(`🛡️ Guard blocked action: ${validation.reason}`);
                return {
                    status: 'denied',
                    error: validation.reason,
                    validation
                };
            }

            // 2. Execute Skill (The Hand)
            // FIX: Measure adjustments (Emergency Mode / Position Sizing)
            const finalParams = { ...input.params };
            if (validation.adjustments) {
                if (validation.adjustments.emergencyMode) {
                    finalParams.emergencyMode = true;
                    console.warn('🚨 ACTIVATING EMERGENCY OVERRIDE FOR THIS ACTION 🚨');
                }
                if (validation.adjustments.suggestedPositionSize) {
                    // Start small: Just log for now, or override if the skill supports it
                    // finalParams.amountUSD = validation.adjustments.suggestedPositionSize;
                }
            }

            const result = await skill.handler(finalParams);
            this.emitTradeExecuted(mappedAction, validation, finalParams, result, true);
            return { status: 'success', data: result, validation };

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            return { status: 'failed', error: errorMessage };
        }
    }

    private mapSkillToAction(skillName: string): 'BUY' | 'SELL' | 'HOLD' | 'EMERGENCY_EXIT' {
        const name = skillName.toLowerCase();

        // FIX P1-05: Strict Action Mapping (Audit Remediation)
        // Explicitly map known patterns. Default to error/blocked state if unknown.

        const buyPatterns = ['buy', 'purchase', 'acquire', 'swap_to', 'mint', 'long', 'snipe', 'ape', 'fomo', 'trade', 'execute'];
        const sellPatterns = ['sell', 'dispose', 'swap_from', 'burn', 'short', 'liquidate', 'close', 'dump', 'exit'];
        // Explicit HOLD patterns only
        const holdPatterns = ['hold', 'wait', 'pause', 'idle', 'sleep'];
        const panicPatterns = ['panic', 'emergency', 'halt', 'stop_all'];

        if (buyPatterns.some(p => name.includes(p))) return 'BUY';
        if (sellPatterns.some(p => name.includes(p))) return 'SELL';
        if (holdPatterns.some(p => name.includes(p))) return 'HOLD';
        if (panicPatterns.some(p => name.includes(p))) return 'EMERGENCY_EXIT';

        // 🛑 PREVENT BYPASS: Do not default to HOLD. Return a special 'UNKNOWN' state
        // that will be rejected by the guard/adapter logic, or throw error here.
        // Since return type is strict, we throw here to fail fast.
        throw new Error(`SECURITY_BLOCK: Unknown skill action '${skillName}'. Cannot map to safe primitive.`);
    }

    private emitTradeExecuted(
        action: ActionType,
        validation: ValidationResult,
        params: Record<string, unknown>,
        result: any,
        success: boolean,
        executionError?: string
    ) {
        // Only emit execution outcomes for trade actions.
        if (action !== 'BUY' && action !== 'SELL') return;

        const decisionId = validation.decisionLog?.timestamp ?? Date.now();
        const capitalAtRisk = this.extractCapitalAtRisk(params);
        const gasUsed = this.extractNumber(result, ['gasUsed', 'actualGasUsed'], 0);
        const slippage = this.extractNumber(result, ['slippage', 'actualSlippage'], this.extractNumber(params, ['slippage'], 0));

        // Prefer explicit PnL, fallback to a small penalty on failed execution.
        const profitLoss = this.extractNumber(result, ['profitLoss', 'pnl', 'pl'], success ? 0 : -1);

        this.bus.emitEvent({
            type: EidolonEventType.TRADE_EXECUTED,
            timestamp: Date.now(),
            payload: {
                action,
                decisionLog: validation.decisionLog,
                txHash: typeof result?.hash === 'string' ? result.hash : undefined,
                executionError,
                outcome: {
                    decisionId,
                    profitLoss,
                    capitalAtRisk,
                    slippage,
                    gasUsed,
                    success
                }
            }
        });
    }

    private extractCapitalAtRisk(params: Record<string, unknown>): number {
        const directUSD = this.extractNumber(params, ['capitalAtRisk', 'amountUSD', 'usdAmount'], 0);
        if (directUSD > 0) return directUSD;

        const parsedAmount = this.extractNumber(params, ['amount'], 0);
        if (parsedAmount > 0) return parsedAmount;

        return 0;
    }

    private extractNumber(source: any, keys: string[], fallback: number): number {
        if (!source || typeof source !== 'object') return fallback;

        for (const key of keys) {
            const raw = source[key];
            if (typeof raw === 'number' && Number.isFinite(raw)) {
                return raw;
            }
            if (typeof raw === 'string') {
                const parsed = Number(raw);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }
        }

        return fallback;
    }

    /**
     * Generate OpenClaw-compatible JSON manifest
     */
    public getManifest(): object[] {
        return Array.from(this.skills.values()).map(s => ({
            name: s.name,
            description: s.description,
            parameters: s.schema
        }));
    }
}
