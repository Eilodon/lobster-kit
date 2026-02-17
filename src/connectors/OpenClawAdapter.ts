import { EidolonGuard, ValidationResult } from '../eidolon/EidolonGuard';

/**
 * 🔌 OPENCLAW ADAPTER
 * 
 * Connects ClawKit capabilities to OpenClaw's Skill System.
 * Defines the standard interface for "The Hand".
 */

export interface ActionInput {
    action: string;
    params: Record<string, any>;
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

    constructor(guard: EidolonGuard) {
        this.guard = guard;
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

        // Gate 3: Guard Check (Pre-Validation)
        // Convert unknown params to Record<string, unknown> for inspection
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
        try {
            const result = await skill.handler(input.params);
            return { status: 'success', data: result, validation };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { status: 'failed', error: errorMessage, validation };
        }
    }

    private mapSkillToAction(skillName: string): 'BUY' | 'SELL' | 'HOLD' {
        const name = skillName.toLowerCase();
        // FIX P1-05: Broader matching to prevent anti-rug bypass
        const buyPatterns = ['buy', 'purchase', 'acquire', 'swap_to', 'mint', 'long'];
        const sellPatterns = ['sell', 'dispose', 'swap_from', 'burn', 'short', 'liquidate', 'close'];

        if (buyPatterns.some(p => name.includes(p))) return 'BUY';
        if (sellPatterns.some(p => name.includes(p))) return 'SELL';
        return 'HOLD';
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
