import { describe, expect, it } from 'vitest';
import { McpToolRegistry } from '../src/tools/McpToolRegistry';
import { createCognitiveTools } from '../src/tools/cognitive-tools';

describe('Generated tool runtime hardening', () => {
    it('enforces allowed_domains at execute time', async () => {
        const registry = new McpToolRegistry();
        const toolSpec = {
            name: 'clawkit_gen_ops_summarizer',
            description: 'Summarize ops logs.',
            inputSchema: {
                type: 'object' as const,
                properties: {
                    payload: { type: 'string' },
                },
                required: ['payload'],
            },
            handlerHint: 'Read-only summarization',
            capabilities: ['read_only', 'summarization'],
            sandbox: {
                execution: 'sandbox' as const,
                side_effects: false as const,
                allowed_domains: ['ops', 'general'],
            },
        };

        const tools = createCognitiveTools({
            flags: {
                reasonChainEnabled: false,
                contextCompressionEnabled: false,
                orchestratorEnabled: false,
                toolGeneratorExperimentalEnabled: true,
            },
            store: {
                loadUserProfile: async () => null,
                saveUserProfile: async () => undefined,
                upsertMemoryEntry: async () => undefined,
                appendReasoningTrace: async () => undefined,
                appendGeneratedToolAudit: async () => undefined,
            } as any,
            traumaRegistry: {
                isInhibited: () => false,
                getRemainingInhibition: () => 0,
                recordTrauma: () => undefined,
                heal: () => undefined,
            } as any,
            conversationTransparency: {
                senseIntent: () => ({
                    user_expertise_signal: 'intermediate',
                    user_intent: 'debug_problem',
                    agent_current_pattern: 'default',
                    pattern_is_appropriate: true,
                    pattern_drift_detected: false,
                    user_frustration_level: 0.1,
                    conversation_momentum: 'neutral',
                    context_depth: 'sparse',
                }),
            } as any,
            reasoningChain: {
                run: async (draft: string) => ({ response: draft, iterations: 1, final_score: 0.7, trace: { mode: 'fast', notes: [] } }),
            } as any,
            contextCompressor: {
                compress: async () => ({ verbatim: [], summaries: [], key_facts: [], total_tokens: 0 }),
            } as any,
            contextRouter: {
                route: async () => 'memory',
            } as any,
            memoryGraph: {
                addNode: async () => undefined,
            } as any,
            memoryRouter: {
                query: async () => [],
            } as any,
            memoryDecay: {
                prune: async () => 0,
            } as any,
            orchestrator: {
                spawnAgent: async () => 'agent_1',
                consensus: async () => ({ selected: 'ok', support_ratio: 1, votes: {} }),
                delegate: async () => ({ ok: true }),
                electLeader: async () => 'agent_1',
            } as any,
            toolGenerator: {
                generate: async () => toolSpec,
                validateSpec: () => undefined,
            } as any,
            toolPerformance: {
                record: async () => undefined,
                listRecords: () => [],
            } as any,
            listTools: () => registry.listToolNames(),
            recommendTools: async () => [],
            registerDynamicTool: (tool) => registry.register(tool, true),
            arbiter: {
                sense: async () => ({
                    user_expertise_signal: 'intermediate',
                    user_intent: 'debug_problem',
                    user_frustration_level: 0.1,
                    context_depth: 'sparse',
                    thermo_state: [0.5, 0.5, 0.5, 0.5, 0.5],
                    pattern_is_appropriate: true,
                    pattern_drift_detected: false,
                }),
                simulateAction: async () => ({ approved: true }),
                checkPattern: () => ({ valid: true }),
            } as any,
        });

        registry.registerAll(tools);

        const generated = await registry.dispatch('clawkit_generate_tool', {
            need: 'summarize ops logs',
            world_state: { domain: 'ops', sensory: { topic: 'ops' } },
        });
        expect(generated.isError).toBeFalsy();
        expect(registry.has('clawkit_gen_ops_summarizer')).toBe(true);

        const blocked = await registry.dispatch('clawkit_gen_ops_summarizer', {
            payload: 'incident logs',
            domain: 'finance',
        });
        expect(blocked.isError).toBe(true);
        expect(blocked.content[0]?.text.toLowerCase()).toContain('blocked');

        const allowed = await registry.dispatch('clawkit_gen_ops_summarizer', {
            payload: 'incident logs',
            domain: 'ops',
        });
        expect(allowed.isError).toBeFalsy();
    });
});
