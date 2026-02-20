import { describe, expect, it } from 'vitest';
import {
    ContextCompressor,
    ConversationTransparency,
    MemoryDecayManager,
    ReasoningChain,
    SwarmOrchestrator,
    ToolGenerator,
    ToolPerformanceTracker,
    createWorldState,
    type IOracle,
} from '../src';

describe('Core Cognitive Modules', () => {
    const oracle: IOracle = {
        async analyze() {
            return {
                weights: {
                    whaleFlow: { ACCUMULATING: 1, DUMPING: -1, NEUTRAL: 0 },
                    gasPrice: { LOW: 1, MEDIUM: 0, HIGH: -1 },
                    liquidityDepth: { THIN: -1, DEEP: 1 },
                    sentiment: { EUPHORIC: -1, FEAR: 1, NEUTRAL: 0 },
                    priceAction: { PUMPING: 1, DUMPING: -1, RANGING: 0 },
                },
                narrative: 'stub',
            };
        },
        async embed(worldState) {
            const text = JSON.stringify(worldState);
            const out = new Array(64).fill(0);
            for (let i = 0; i < text.length; i++) out[i % out.length] += text.charCodeAt(i) % 5;
            return out;
        },
        getName() {
            return 'stub';
        },
    };

    it('senses intent and returns ConversationSensory', () => {
        const transparency = new ConversationTransparency();
        const sensory = transparency.senseIntent(
            [
                { role: 'user', content: 'Please debug this error and propose next steps.' },
                { role: 'assistant', content: 'Sure.' },
            ],
            'default'
        );
        expect(sensory.user_intent).toBe('debug_problem');
        expect(typeof sensory.user_frustration_level).toBe('number');
    });

    it('compresses context into constrained token budget', async () => {
        const compressor = new ContextCompressor();
        const compressed = await compressor.compress(
            [
                { role: 'user', content: 'remember I prefer concise responses' },
                { role: 'assistant', content: 'noted' },
                { role: 'user', content: 'debug bug in swap routing with high latency' },
                { role: 'assistant', content: 'we should inspect adapter boundaries' },
            ],
            200,
            2
        );
        expect(compressed.verbatim.length).toBe(2);
        expect(compressed.total_tokens).toBeLessThanOrEqual(200);
    });

    it('runs reasoning chain in fast mode', async () => {
        const chain = new ReasoningChain(oracle);
        const result = await chain.run(
            'Draft response',
            {
                user_expertise_signal: 'intermediate',
                user_intent: 'brainstorm_together',
                agent_current_pattern: 'default',
                pattern_is_appropriate: true,
                pattern_drift_detected: false,
                user_frustration_level: 0.1,
                conversation_momentum: 'building',
                context_depth: 'rich',
            },
            { mode: 'fast' }
        );
        expect(result.final_score).toBeGreaterThanOrEqual(0);
        expect(result.final_score).toBeLessThanOrEqual(1);
    });

    it('uses oracle-backed critique for fast mode when available', async () => {
        const oracleBacked: IOracle = {
            ...oracle,
            async generate(prompt, options) {
                if (options?.json && prompt.includes('strict response critic')) {
                    return JSON.stringify({
                        score: 0.93,
                        confidence: 0.9,
                        issues: ['needs clearer next step'],
                        suggestions: ['state the immediate first action'],
                    });
                }
                return '{}';
            },
        };
        const chain = new ReasoningChain(oracleBacked);
        const result = await chain.run(
            'Draft response',
            {
                user_expertise_signal: 'intermediate',
                user_intent: 'debug_problem',
                agent_current_pattern: 'default',
                pattern_is_appropriate: true,
                pattern_drift_detected: false,
                user_frustration_level: 0.1,
                conversation_momentum: 'building',
                context_depth: 'rich',
            },
            { mode: 'fast' }
        );
        expect(result.final_score).toBeCloseTo(0.93, 2);
    });

    it('calculates retention with decay curve', () => {
        const decay = new MemoryDecayManager();
        const now = Date.now();
        const retention = decay.calculateRetention(
            {
                id: 'x',
                content: 'memory',
                embedding: [],
                stability: 1,
                last_accessed: now - 2 * 24 * 60 * 60 * 1000,
                created_at: now - 2 * 24 * 60 * 60 * 1000,
                importance: 0.5,
            },
            now
        );
        expect(retention).toBeGreaterThan(0);
        expect(retention).toBeLessThan(1);
    });

    it('does not prune high-importance memories even with low retention', async () => {
        const now = Date.now();
        const deleted: string[][] = [];
        const fakeStore = {
            async listMemoryEntries() {
                return [
                    {
                        id: 'low',
                        content: 'low importance',
                        embedding: [],
                        stability: 0.5,
                        last_accessed: now - 20 * 24 * 60 * 60 * 1000,
                        created_at: now - 20 * 24 * 60 * 60 * 1000,
                        importance: 0.2,
                    },
                    {
                        id: 'high',
                        content: 'high importance',
                        embedding: [],
                        stability: 0.5,
                        last_accessed: now - 20 * 24 * 60 * 60 * 1000,
                        created_at: now - 20 * 24 * 60 * 60 * 1000,
                        importance: 0.95,
                    },
                ];
            },
            async deleteMemoryEntries(ids: string[]) {
                deleted.push(ids);
                return ids.length;
            },
        } as any;

        const decay = new MemoryDecayManager(fakeStore);
        const pruned = await decay.prune(0.8, { preserveImportanceAbove: 0.85 });
        expect(pruned).toBe(1);
        expect(deleted[0]).toEqual(['low']);
    });

    it('supports embedding hook signature through IOracle', async () => {
        const vector = await oracle.embed(createWorldState('test', { a: 1 }));
        expect(Array.isArray(vector)).toBe(true);
        expect(vector.length).toBeGreaterThan(0);
    });

    it('tracks fallback rate and latency percentiles for tool telemetry', async () => {
        const tracker = new ToolPerformanceTracker();
        await tracker.record('clawkit_reason_chain', true, 120);
        await tracker.record('clawkit_reason_chain', false, 450, { fallbackUsed: true });
        const record = tracker.getRecord('clawkit_reason_chain');
        expect(record).not.toBeNull();
        expect(record?.call_count).toBe(2);
        expect(record?.fallback_count).toBe(1);
        expect(record?.fallback_rate).toBeCloseTo(0.5, 4);
        expect((record?.latency_p95_ms ?? 0)).toBeGreaterThan(0);
    });

    it('rejects unsafe generated-tool requests', async () => {
        const generator = new ToolGenerator();
        const safe = await generator.generate(
            'summarize deploy logs',
            createWorldState('ops', { channel: 'deploy' })
        );
        expect(safe).not.toBeNull();

        const unsafe = await generator.generate(
            'execute shell command to delete files',
            createWorldState('ops', { channel: 'deploy' })
        );
        expect(unsafe).toBeNull();
    });

    it('generates richer tool specs from oracle output when available', async () => {
        const oracleBacked: IOracle = {
            ...oracle,
            async generate(prompt, options) {
                if (options?.json && prompt.includes('Design a read-only MCP tool spec')) {
                    return JSON.stringify({
                        name: 'clawkit_gen_log_summarizer',
                        description: 'Summarize deploy and runtime logs.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                payload: { type: 'string', description: 'Raw logs' },
                                max_lines: { type: 'number', description: 'Line limit' },
                            },
                            required: ['payload'],
                        },
                        handlerHint: 'Use read-only summarization.',
                        capabilities: ['read_only', 'summarization'],
                        allowed_domains: ['ops'],
                    });
                }
                return '{}';
            },
        };
        const generator = new ToolGenerator(oracleBacked);
        const spec = await generator.generate(
            'summarize deploy logs',
            createWorldState('ops', { channel: 'deploy' })
        );
        expect(spec).not.toBeNull();
        expect(spec?.name.startsWith('clawkit_gen_')).toBe(true);
        expect(spec?.inputSchema.properties.max_lines?.type).toBe('number');
    });

    it('delegates through oracle-backed orchestrator', async () => {
        const oracleBacked: IOracle = {
            ...oracle,
            async generate(prompt, options) {
                if (options?.json && prompt.includes('autonomous sub-agent')) {
                    return JSON.stringify({
                        ok: true,
                        data: {
                            role_action: 'planned',
                            note: 'oracle delegation success',
                        },
                    });
                }
                return '{}';
            },
        };
        const orchestrator = new SwarmOrchestrator(oracleBacked);
        const agentId = await orchestrator.spawnAgent('planner', 'build deployment checklist');
        const result = await orchestrator.delegate('build deployment checklist', agentId, 800);
        expect(result.ok).toBe(true);
        expect((result.data as Record<string, unknown>)?.note).toBe('oracle delegation success');
    });
});
