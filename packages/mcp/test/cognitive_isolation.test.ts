import { describe, expect, it } from 'vitest';
import { ClawkitSimulateResponseTool, ClawkitSenseIntentTool, ClawkitCheckPatternTool, CognitiveToolDeps } from '../src/tools/cognitive-tools';

describe('Cognitive Tools Isolation', () => {
    const mockArbiter = {
        simulateAction: async (pattern: string, mode: number, intrusiveness: number) => ({
            approved: true,
            riskScore: 10,
            confidence: 90,
            predicted_outcome: 'positive',
            simulation_id: 'sim_123'
        }),
        sense: async (msg: string, profile: any) => ({
            user_expertise_signal: 'expert',
            user_intent: 'debug_problem',
            user_frustration_level: 0.2,
            context_depth: 'rich',
            thermo_state: [0.5, 0.5, 0.5, 0.5, 0.5],
            pattern_is_appropriate: true,
            pattern_drift_detected: false,
        })
    } as any;

    const deps = {
        arbiter: mockArbiter,
        flags: {},
        conversationTransparency: {
            senseIntent: () => ({ user_intent: 'base_intent' }) // mock base sensing if tool uses it
        } as any
    } as unknown as CognitiveToolDeps;

    it('executes simulation tool via arbiter', async () => {
        const tool = new ClawkitSimulateResponseTool(deps);
        const result = await tool.execute({
            actionPattern: 'test_pattern',
            mode: 1, // Peer
            intrusiveness: 0.5
        });

        expect(result.isError).toBeFalsy();
        const content = result.structuredContent as any;
        expect(content.result.approved).toBe(true);
        expect(content.result.simulation_id).toBe('sim_123');
    });

    it('executes sense intent tool via arbiter', async () => {
        const tool = new ClawkitSenseIntentTool(deps);
        // The tool might use deps.conversationTransparency first?
        // Let's check implementation of ClawkitSenseIntentTool in cognitive-tools.ts
        // I updated it to use arbiter.sense directly in execute?
        // Let's verify via test.

        const result = await tool.execute({
            messages: [{ role: 'user', content: 'debug this' }],
            current_pattern: 'default'
        });

        expect(result.isError).toBeFalsy();
        const content = result.structuredContent as any;
        expect(content.sensory.user_intent).toBe('debug_problem'); // From mockArbiter
    });

    it('executes check pattern tool via arbiter', async () => {
        // Enhance mock arbiter for this test
        // We need to overwrite the method on the mock or casting it properly
        (mockArbiter as any).checkPattern = (cause: string, effect: string) => ({
            valid: true,
            probability: 0.85,
            samples: 20,
            reasoning: 'mock_reasoning'
        });

        // Mock TraumaRegistry for the tool deps
        const mockRegistry = {
            isInhibited: () => false,
            getRemainingInhibition: () => 0n
        };
        const toolDeps = { ...deps, traumaRegistry: mockRegistry } as unknown as CognitiveToolDeps;

        const tool = new ClawkitCheckPatternTool(toolDeps);

        // Test 1: Simple pattern (no causal check triggered in current heuristic unless "->")
        const result1 = await tool.execute({
            patterns: ['simple_pattern'],
            mode: 'ZEN'
        });
        const content1 = result1.structuredContent as any;
        expect(content1.causal_checks[0].valid).toBe(true);
        expect(content1.causal_checks[0].reasoning).toBe('implicitly_valid');

        // Test 2: Causal pattern
        const result2 = await tool.execute({
            patterns: ['ExpertSignal->TrustLevel'],
            mode: 'ZEN'
        });
        const content2 = result2.structuredContent as any;
        expect(content2.causal_checks[0].probability).toBe(0.85);
    });
});
