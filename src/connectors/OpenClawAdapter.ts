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

    constructor(
        private guard: EidolonGuard
    ) { }

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

        // 1. Validate with Guard (The Soul)
        // We Map skill names to ActionTypes roughly
        const actionType = this.mapSkillToAction(input.action);
        const validation = await this.guard.validateAction(
            actionType,
            {
                tokenSymbol: input.params.token || input.params.symbol || input.params.asset,
                // Normalize amount from various possible inputs
                amountUSD: input.params.amountUSD || input.params.amount || input.params.value || input.params.size
            }
        );

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
        } catch (error: any) {
            return { status: 'failed', error: error.message, validation };
        }
    }

    private mapSkillToAction(skillName: string): 'BUY' | 'SELL' | 'HOLD' {
        if (skillName.includes('buy') || skillName.includes('mint')) return 'BUY';
        if (skillName.includes('sell') || skillName.includes('burn')) return 'SELL';
        return 'HOLD';
    }

    /**
     * Generate OpenClaw-compatible JSON manifest
     */
    public getManifest(): any {
        return Array.from(this.skills.values()).map(s => ({
            name: s.name,
            description: s.description,
            parameters: s.schema
        }));
    }
}
