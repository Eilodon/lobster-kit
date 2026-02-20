import {
    ConversationTransparency,
    createWorldState,
    MemoryDecayManager,
    MemoryGraph,
    MemoryRouter,
    ToolGenerator,
    ToolPerformanceTracker,
} from '@clawkit/core';
import type {
    GeneratedToolSpec,
    IOracle,
    MemoryEntry,
    WorldState
} from '@clawkit/core';
import {
    TraumaRegistry,
    CognitiveArbiter,
    ConversationMode,
    ReasoningChain,
    SwarmOrchestrator,
    ContextCompressor,
    ContextRouter,
    type ConversationSensory,
    type Message,
    type UserSensory
} from '@clawkit/soul';
import { IMcpTool, McpToolResult } from './IMcpTool';
import { SQLiteLearningStore } from '@clawkit/core';
import { runSandboxedGeneratedTool } from './generatedToolSandbox';

type FeatureFlags = {
    reasonChainEnabled: boolean;
    contextCompressionEnabled: boolean;
    orchestratorEnabled: boolean;
    toolGeneratorExperimentalEnabled: boolean;
};

type DynamicRegister = (tool: IMcpTool) => void;
type OracleGenerator = Pick<IOracle, 'generate'>;
type OracleEmbedder = Pick<IOracle, 'embed'>;

export interface CognitiveToolDeps {
    flags: FeatureFlags;
    store: SQLiteLearningStore;
    traumaRegistry: TraumaRegistry;
    conversationTransparency: ConversationTransparency;
    reasoningChain: ReasoningChain;
    contextCompressor: ContextCompressor;
    contextRouter: ContextRouter;
    memoryGraph: MemoryGraph;
    memoryRouter: MemoryRouter;
    memoryDecay: MemoryDecayManager;
    orchestrator: SwarmOrchestrator;
    toolGenerator: ToolGenerator;
    toolPerformance: ToolPerformanceTracker;
    oracleGenerator?: OracleGenerator;
    embeddingOracle?: OracleEmbedder;
    generatedToolMax?: number;
    listTools: () => string[];
    recommendTools: (task: string, available?: string[]) => Promise<string[]>;
    registerDynamicTool: DynamicRegister;
    arbiter: CognitiveArbiter;
}

function asText(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function extractJsonPayload(raw: string): string | null {
    const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    if ((clean.startsWith('{') && clean.endsWith('}')) || (clean.startsWith('[') && clean.endsWith(']'))) {
        return clean;
    }
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return clean.slice(firstBrace, lastBrace + 1);
    }
    return null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
    const payload = extractJsonPayload(raw);
    if (!payload) return null;
    try {
        const parsed = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

function asMessageArray(input: unknown): Message[] {
    if (!Array.isArray(input)) return [];
    return input
        .map((raw) => {
            const role = (raw && typeof raw === 'object' && 'role' in raw) ? String((raw as { role?: unknown }).role) : 'user';
            const content = (raw && typeof raw === 'object' && 'content' in raw) ? String((raw as { content?: unknown }).content) : '';
            if (!content) return null;
            if (role !== 'user' && role !== 'assistant' && role !== 'system') return null;
            return { role, content } as Message;
        })
        .filter((m): m is Message => !!m);
}

function normalizeWorldState(input: unknown): WorldState<Record<string, unknown>> {
    if (input && typeof input === 'object') {
        const maybe = input as Partial<WorldState<Record<string, unknown>>>;
        if (typeof maybe.domain === 'string' && maybe.sensory && typeof maybe.sensory === 'object') {
            return {
                domain: maybe.domain,
                sensory: maybe.sensory,
                timestamp: typeof maybe.timestamp === 'number' ? maybe.timestamp : Date.now(),
                confidence: typeof maybe.confidence === 'number' ? maybe.confidence : 1,
                meta: maybe.meta,
            };
        }
    }
    return createWorldState('conversation', { text: String(input ?? '') });
}

function buildDefaultUser(userId: string): UserSensory {
    return {
        user_id: userId,
        expertise_level: 0.5,
        preferred_mode: 'balanced',
        domains: [],
        communication_style: {
            likes_directness: 0.7,
            tolerates_pushback: 0.5,
            prefers_brevity: 0.6,
        },
        negative_patterns: [],
        last_seen: Date.now(),
        session_count: 1,
    };
}

class GeneratedSandboxTool implements IMcpTool {
    public readonly definition;

    constructor(
        private readonly spec: GeneratedToolSpec,
        private readonly need: string,
        private readonly oracle?: OracleGenerator
    ) {
        this.definition = {
            name: spec.name,
            description: spec.description || `Generated sandbox tool for: ${need}`,
            inputSchema: spec.inputSchema,
            outputSchema: {
                type: 'object' as const,
                properties: {
                    mode: { type: 'string' },
                    output: { type: 'string' },
                    confidence: { type: 'number' },
                },
                required: ['mode', 'output'],
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            execution: {
                taskSupport: 'forbidden' as const,
            },
        };
    }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const requestedDomain = this.resolveRequestedDomain(args);
        if (!this.spec.sandbox.allowed_domains.includes(requestedDomain)) {
            throw new Error(
                `Generated tool "${this.spec.name}" blocked for domain "${requestedDomain}".`
            );
        }
        const payload = this.extractPayload(args);
        const result = await this.processPayload(payload, args);
        return {
            content: [
                { type: 'text', text: `Generated sandbox tool "${this.spec.name}" processed payload in ${result.mode} mode.` },
            ],
            structuredContent: {
                generated: true,
                tool_name: this.spec.name,
                need: this.need,
                mode: result.mode,
                output: result.output,
                confidence: result.confidence,
                requested_domain: requestedDomain,
                payload_echo: payload.slice(0, 800),
                sandboxed: true,
                capabilities: this.spec.capabilities,
            },
        };
    }

    private extractPayload(args: Record<string, unknown>): string {
        if (typeof args.payload === 'string') return args.payload.slice(0, 4_000);
        const serialized = JSON.stringify(args ?? {}).slice(0, 4_000);
        return serialized || '';
    }

    private async processPayload(
        payload: string,
        args: Record<string, unknown>
    ): Promise<{ mode: 'oracle' | 'heuristic'; output: string; confidence: number }> {
        const oracleExecutionEnabled = process.env.TOOL_GEN_ORACLE_EXECUTION === 'true';
        if (oracleExecutionEnabled && this.oracle?.generate) {
            const prompt = [
                'You execute a read-only MCP generated tool.',
                'Return JSON ONLY: {"output": string, "confidence": number}',
                `need=${this.need}`,
                `handler_hint=${this.spec.handlerHint}`,
                `capabilities=${JSON.stringify(this.spec.capabilities)}`,
                `input=${JSON.stringify(args).slice(0, 2500)}`,
            ].join('\n');
            try {
                const raw = await this.oracle.generate(prompt, { json: true, temperature: 0.2, maxTokens: 600 });
                const parsed = parseJsonObject(raw);
                if (parsed && typeof parsed.output === 'string') {
                    const rawConfidence = typeof parsed.confidence === 'number'
                        ? parsed.confidence
                        : Number(parsed.confidence);
                    const confidence = Number.isFinite(rawConfidence)
                        ? Math.max(0, Math.min(1, rawConfidence))
                        : 0.7;
                    return {
                        mode: 'oracle',
                        output: parsed.output.slice(0, 4_000),
                        confidence,
                    };
                }
            } catch {
                // Deterministic fallback below.
            }
        }
        return this.heuristicProcess(payload);
    }

    private heuristicProcess(payload: string): { mode: 'heuristic'; output: string; confidence: number } {
        return runSandboxedGeneratedTool(payload, this.need, this.spec.capabilities);
    }

    private resolveRequestedDomain(args: Record<string, unknown>): string {
        if (typeof args.domain === 'string' && args.domain.trim()) {
            return args.domain.trim();
        }
        const worldState = args.world_state;
        if (worldState && typeof worldState === 'object' && !Array.isArray(worldState)) {
            const domain = (worldState as Record<string, unknown>).domain;
            if (typeof domain === 'string' && domain.trim()) {
                return domain.trim();
            }
        }
        return 'general';
    }
}

export class ClawkitRecallUserTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_recall_user',
        description: 'Load user profile at session start.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                user_id: { type: 'string', description: 'Stable user identifier (hashed).' },
            },
            required: ['user_id'],
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const userId = asText(args.user_id).trim();
        if (!userId) throw new Error('user_id is required.');

        let profile = await this.deps.store.loadUserProfile(userId);
        if (!profile) {
            profile = buildDefaultUser(userId);
            await this.deps.store.saveUserProfile(profile);
        }
        return {
            content: [{ type: 'text', text: `User profile loaded: ${userId}` }],
            structuredContent: { profile },
        };
    }
}

export class ClawkitSenseIntentTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_sense_intent',
        description: 'Sense user intent and detect pattern drift before responding.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                messages: { type: 'array', description: 'Conversation messages.' },
                current_pattern: { type: 'string', description: 'Current response pattern name.' },
                user: { type: 'object', description: 'Optional user profile.' },
            },
            required: ['messages'],
        },
        outputSchema: {
            type: 'object' as const,
            properties: {
                sensory: { type: 'object', description: 'ConversationSensory payload.' },
            },
            required: ['sensory'],
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const messages = asMessageArray(args.messages);
        // We only use the last message for now as Arbiter.sense takes a single string found in the prompt,
        // but Arbiter.sense logic might need full context later.
        // For now, let's join messages or take the last user message.
        const lastMsg = messages.filter(m => m.role === 'user').pop()?.content || '';

        const currentPattern = asText(args.current_pattern, 'default');
        const user = (args.user && typeof args.user === 'object') ? args.user as UserSensory : undefined;

        // Delegate to CognitiveArbiter
        const sensory = await this.deps.arbiter.sense(lastMsg, user);

        // Arbiters sense might not return all fields expected by the tool output yet, 
        // merging with transparency checks if needed, but Arbiter should eventually supersede.
        return {
            content: [{ type: 'text', text: `Intent sensed: ${sensory.user_intent}` }],
            structuredContent: { sensory },
        };
    }

    private async enrichSensoryWithOracle(
        base: ConversationSensory,
        messages: Message[],
        currentPattern: string,
        user?: UserSensory
    ): Promise<ConversationSensory> {
        const generator = this.deps.oracleGenerator?.generate;
        if (!generator || messages.length === 0) return base;

        const transcript = messages.slice(-10).map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 4_000);
        const prompt = [
            'Infer conversational sensory metadata from transcript.',
            'Return JSON ONLY with optional keys:',
            'user_expertise_signal,user_intent,user_frustration_level,conversation_momentum,context_depth,pattern_is_appropriate',
            `current_pattern=${currentPattern}`,
            `base=${JSON.stringify(base)}`,
            `user=${JSON.stringify(user ?? null)}`,
            `transcript=${transcript}`,
        ].join('\n');

        try {
            const raw = await generator(prompt, { json: true, temperature: 0.2, maxTokens: 500 });
            const parsed = parseJsonObject(raw);
            if (!parsed) return base;
            return {
                ...base,
                user_expertise_signal: this.pickEnum(
                    parsed.user_expertise_signal,
                    ['novice', 'intermediate', 'expert'] as const,
                    base.user_expertise_signal
                ),
                user_intent: this.pickEnum(
                    parsed.user_intent,
                    ['share_and_be_heard', 'get_validation', 'debug_problem', 'learn_something', 'brainstorm_together', 'vent'] as const,
                    base.user_intent
                ),
                user_frustration_level: this.pickNumber(parsed.user_frustration_level, base.user_frustration_level),
                conversation_momentum: this.pickEnum(
                    parsed.conversation_momentum,
                    ['neutral', 'building', 'deteriorating'] as const,
                    base.conversation_momentum ?? 'neutral'
                ),
                context_depth: this.pickEnum(parsed.context_depth, ['sparse', 'rich'] as const, base.context_depth),
                pattern_is_appropriate: this.pickBoolean(parsed.pattern_is_appropriate, base.pattern_is_appropriate ?? true),
                pattern_drift_detected: !this.pickBoolean(parsed.pattern_is_appropriate, base.pattern_is_appropriate ?? true),
            };
        } catch {
            return base;
        }
    }

    private pickEnum<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
        return typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : fallback;
    }

    private pickNumber(value: unknown, fallback: number): number {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(0, Math.min(1, n));
    }

    private pickBoolean(value: unknown, fallback: boolean): boolean {
        return typeof value === 'boolean' ? value : fallback;
    }
}

export class ClawkitCheckPatternTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_check_pattern',
        description: 'Check TraumaRegistry before using patterns.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                patterns: { type: 'array', description: 'Pattern names to check.' },
                mode: { type: 'string', description: 'Operational mode (default ZEN).' },
            },
            required: ['patterns'],
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const mode = asText(args.mode, 'ZEN');
        const patterns = Array.isArray(args.patterns) ? args.patterns.map((p) => String(p)) : [];

        // 1. Check TraumaRegistry (Inhibition)
        const blocked = patterns
            .filter((pattern) => this.deps.traumaRegistry.isInhibited(mode, pattern))
            .map((pattern) => ({
                pattern,
                reason: 'trauma_inhibition',
                remaining_ms: this.deps.traumaRegistry.getRemainingInhibition(mode, pattern),
            }));

        // 2. Check Causal Validity (Arbiter)
        const causalChecks = patterns.map(pattern => {
            // Heuristic: Split pattern into cause->effect if possible, or check against self-consistency
            // For now, we assume the pattern string might be "CauseVar->EffectVar" or just "PatternName"
            // If it's a name, we might validate it against a known list or default to valid.
            // Let's assume input might be complex, but for V3 let's just valid existence.

            // If checking a specific causal link:
            const parts = pattern.split('->');
            if (parts.length === 2) {
                const check = this.deps.arbiter.checkPattern(parts[0].trim(), parts[1].trim());
                return { pattern, ...check };
            }
            return { pattern, valid: true, probability: 1, samples: 0, reasoning: 'implicitly_valid' };
        });

        const invalid = causalChecks.filter(c => !c.valid);

        return {
            content: [{
                type: 'text',
                text: `Checked ${patterns.length} patterns. Blocked: ${blocked.length}. Invalid: ${invalid.length}.`
            }],
            structuredContent: {
                mode,
                blocked,
                causal_checks: causalChecks
            },
        };
    }
}

export class ClawkitCommitPatternTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_commit_pattern',
        description: 'Commit chosen pattern and persist reasoning artifact.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                chosen_pattern: { type: 'string' },
                reasoning: { type: 'string' },
                importance: { type: 'number' },
            },
            required: ['chosen_pattern', 'reasoning'],
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const chosenPattern = asText(args.chosen_pattern);
        const reasoning = asText(args.reasoning);
        const importance = asNumber(args.importance, 0.5);
        const id = `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const embedding = await this.resolveEmbedding(chosenPattern, reasoning);

        const memoryEntry: MemoryEntry = {
            id,
            content: `[${chosenPattern}] ${reasoning}`,
            embedding,
            stability: 1,
            last_accessed: Date.now(),
            created_at: Date.now(),
            importance: Math.max(0, Math.min(1, importance)),
            source: 'pattern_commit',
        };
        await this.deps.store.upsertMemoryEntry(memoryEntry);
        await this.deps.memoryGraph.addNode({
            id,
            concept: `${chosenPattern}: ${reasoning.slice(0, 120)}`,
            embedding: memoryEntry.embedding,
            connections: [],
        });

        return {
            content: [{ type: 'text', text: `Pattern committed: ${chosenPattern}` }],
            structuredContent: { id, chosen_pattern: chosenPattern },
        };
    }

    private async resolveEmbedding(chosenPattern: string, reasoning: string): Promise<number[]> {
        if (this.deps.embeddingOracle?.embed) {
            try {
                const raw = await this.deps.embeddingOracle.embed(
                    createWorldState('pattern_commit', { chosen_pattern: chosenPattern, reasoning })
                );
                if (Array.isArray(raw) && raw.length > 0) {
                    const cleaned = raw.map((value) => (Number.isFinite(value) ? value : 0));
                    if (cleaned.some((value) => value !== 0)) return cleaned;
                }
            } catch {
                // Fallback below keeps commit path resilient when embedding provider is unavailable.
            }
        }

        const fallback = new Array<number>(64).fill(0);
        const text = `${chosenPattern} ${reasoning}`;
        for (let i = 0; i < text.length; i++) {
            const idx = (text.charCodeAt(i) + i) % fallback.length;
            fallback[idx] += 1;
        }
        return fallback;
    }
}

export class ClawkitRecordOutcomeTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_record_outcome',
        description: 'Record outcome and update learning systems.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pattern: { type: 'string' },
                outcome: { type: 'string', description: 'success|failure|neutral' },
                severity: { type: 'number', description: '0.0 to 1.0' },
                mode: { type: 'string' },
            },
            required: ['pattern', 'outcome'],
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const pattern = asText(args.pattern);
        const outcome = asText(args.outcome, 'neutral').toLowerCase();
        const severity = Math.max(0, Math.min(1, asNumber(args.severity, 0.4)));
        const mode = asText(args.mode, 'ZEN');

        if (outcome === 'failure') {
            this.deps.traumaRegistry.recordTrauma(mode, pattern, severity * 5);
        } else if (outcome === 'success') {
            this.deps.traumaRegistry.heal(mode, pattern);
        }

        await this.deps.toolPerformance.record(`pattern:${pattern}`, outcome !== 'failure', 0, outcome === 'success' ? 1 : 0.4);

        return {
            content: [{ type: 'text', text: `Outcome recorded for pattern "${pattern}".` }],
            structuredContent: { pattern, outcome, severity, mode },
        };
    }
}

export class ClawkitRecallSimilarTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_recall_similar',
        description: 'Recall similar past episodes from memory layers.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string' },
                world_state: { type: 'object' },
            },
            required: ['query'],
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const query = asText(args.query);
        const worldState = normalizeWorldState(args.world_state ?? { query });
        const results = await this.deps.memoryRouter.query({ query, worldState });
        return {
            content: [{ type: 'text', text: `Found ${results.length} similar memories.` }],
            structuredContent: { results },
        };
    }
}

export class ClawkitUpdateUserTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_update_user',
        description: 'Update user profile signals and preferences.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                user_id: { type: 'string' },
                patch: { type: 'object' },
            },
            required: ['user_id', 'patch'],
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const userId = asText(args.user_id).trim();
        if (!userId) throw new Error('user_id is required.');
        const patch = (args.patch && typeof args.patch === 'object') ? args.patch as Record<string, unknown> : {};
        const existing = await this.deps.store.loadUserProfile(userId) ?? buildDefaultUser(userId);
        const updated: UserSensory = {
            ...existing,
            ...patch,
            user_id: userId,
            communication_style: {
                ...existing.communication_style,
                ...(patch.communication_style as Partial<UserSensory['communication_style']> | undefined),
            },
            last_seen: Date.now(),
            session_count: existing.session_count + 1,
        };
        await this.deps.store.saveUserProfile(updated);
        return {
            content: [{ type: 'text', text: `User profile updated: ${userId}` }],
            structuredContent: { profile: updated },
        };
    }
}

export class ClawkitDreamConversationTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_dream_conversation',
        description: 'Run experience replay consolidation at session end.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                episodes: { type: 'number', description: 'Number of episodes to replay.' },
                prune_threshold: { type: 'number', description: 'Retention prune threshold.' },
                preserve_importance_at: { type: 'number', description: 'Do not prune memories at/above this importance.' },
            },
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const episodes = Math.max(1, Math.floor(asNumber(args.episodes, 20)));
        const threshold = Math.max(0.01, Math.min(0.9, asNumber(args.prune_threshold, 0.1)));
        const preserveImportanceAt = Math.max(0, Math.min(1, asNumber(args.preserve_importance_at, 0.85)));
        const pruned = await this.deps.memoryDecay.prune(threshold, { preserveImportanceAbove: preserveImportanceAt });
        return {
            content: [{ type: 'text', text: `Dream cycle completed. episodes=${episodes} pruned=${pruned}` }],
            structuredContent: { episodes, pruned, threshold, preserve_importance_at: preserveImportanceAt },
        };
    }
}

export class ClawkitReasonChainTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_reason_chain',
        description: 'Run ToT + Critic-Verifier loop before committing a response.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                draft_response: { type: 'string' },
                context: { type: 'object' },
                mode: { type: 'string', description: 'fast|deep' },
                max_iterations: { type: 'number' },
                latency_budget_ms: { type: 'number', description: 'Optional latency budget for fast/deep path gating.' },
            },
            required: ['draft_response', 'context'],
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        if (!this.deps.flags.reasonChainEnabled) {
            return {
                content: [{ type: 'text', text: 'Reason chain is disabled by feature flag.' }],
                isError: true,
            };
        }
        const started = Date.now();
        const draft = asText(args.draft_response);
        const mode = asText(args.mode, 'fast') === 'deep' ? 'deep' : 'fast';
        const maxIterations = Math.max(1, Math.min(6, Math.floor(asNumber(args.max_iterations, 3))));
        const latencyBudgetMs = Math.max(0, Math.floor(asNumber(args.latency_budget_ms, 0)));
        const context = (args.context && typeof args.context === 'object')
            ? args.context as ConversationSensory
            : this.mockContext(); // Use the new mockContext method

        const verified = await this.deps.reasoningChain.run(draft, context, {
            mode,
            max_iterations: maxIterations,
        });
        const latencyMs = Date.now() - started;
        const notes = verified.trace?.notes ?? [];
        const baselineFastScore = this.extractScoreFromNotes(notes, 'baseline_fast_score=');
        const abMetrics = {
            mode,
            baseline_fast_score: baselineFastScore ?? verified.final_score,
            reasoning_score: verified.final_score,
            score_delta: verified.final_score - (baselineFastScore ?? verified.final_score),
        };
        const budgetExceeded = latencyBudgetMs > 0 && latencyMs > latencyBudgetMs;

        await this.deps.store.appendReasoningTrace({
            id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            created_at: Date.now(),
            mode,
            final_score: verified.final_score,
            iterations: verified.iterations,
            trace: {
                ...(verified.trace ?? {}),
                latency_ms: latencyMs,
                latency_budget_ms: latencyBudgetMs,
                budget_exceeded: budgetExceeded,
                ab_metrics: abMetrics,
            },
        });
        return {
            content: [{
                type: 'text',
                text: budgetExceeded
                    ? `${verified.response}\n\n[warn] Fast-mode latency budget exceeded (${latencyMs}ms > ${latencyBudgetMs}ms).`
                    : verified.response,
            }],
            structuredContent: {
                verified,
                latency_ms: latencyMs,
                latency_budget_ms: latencyBudgetMs,
                budget_exceeded: budgetExceeded,
                ab_metrics: abMetrics,
            },
        };
    }
    private extractScoreFromNotes(notes: string[], prefix: string): number | null {
        const line = notes.find((n) => n.startsWith(prefix));
        if (!line) return null;
        const val = parseFloat(line.split('=')[1]);
        return Number.isFinite(val) ? val : null;
    }

    private mockContext(): ConversationSensory {
        return {
            user_expertise_signal: 'intermediate',
            user_intent: 'share_and_be_heard',
            agent_current_pattern: 'sympathetic_listener',
            pattern_is_appropriate: true,
            pattern_drift_detected: false,
            user_frustration_level: 0.2,
            conversation_momentum: 'neutral',
            context_depth: 'sparse',
            thermo_state: [0.5, 0.5, 0.5, 0.5, 0.5]
        } as ConversationSensory;
    }
}

export class ClawkitOrchestrateTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_orchestrate',
        description: 'Spawn and coordinate sub-agents for complex multi-step tasks.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                task: { type: 'string' },
                strategy: { type: 'string', description: 'single_agent|parallel|pipeline|consensus' },
                agent_count: { type: 'number' },
                timeout_ms: { type: 'number' },
            },
            required: ['task', 'strategy'],
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        if (!this.deps.flags.orchestratorEnabled) {
            return {
                content: [{ type: 'text', text: 'Orchestrator is disabled by feature flag.' }],
                isError: true,
            };
        }
        const task = asText(args.task);
        const strategy = asText(args.strategy, 'single_agent');
        const agentCount = Math.max(1, Math.min(6, Math.floor(asNumber(args.agent_count, 2))));
        const timeoutMs = Math.max(100, asNumber(args.timeout_ms, 3000));

        const agentIds: string[] = [];
        for (let i = 0; i < agentCount; i++) {
            const role = i === 0 ? 'planner' : 'executor';
            agentIds.push(await this.deps.orchestrator.spawnAgent(role, task));
        }

        let result: Record<string, unknown>;
        let failures = 0;
        if (strategy === 'consensus') {
            result = await this.deps.orchestrator.consensus(task, agentIds, 0.6) as unknown as Record<string, unknown>;
        } else if (strategy === 'parallel') {
            const delegated = await Promise.all(agentIds.map((id) => this.deps.orchestrator.delegate(task, id, timeoutMs)));
            failures = delegated.filter((entry) => !entry.ok).length;
            result = { delegated };
        } else if (strategy === 'pipeline') {
            const delegated = [];
            for (const id of agentIds) {
                const step = await this.deps.orchestrator.delegate(task, id, timeoutMs);
                delegated.push(step);
                if (!step.ok) failures++;
            }
            result = { delegated };
        } else {
            const leader = await this.deps.orchestrator.electLeader(task);
            const delegated = await this.deps.orchestrator.delegate(task, leader, timeoutMs);
            failures = delegated.ok ? 0 : 1;
            result = delegated as unknown as Record<string, unknown>;
        }

        return {
            content: [{ type: 'text', text: `Orchestration completed with strategy=${strategy} failures=${failures}` }],
            structuredContent: { strategy, agent_ids: agentIds, failures, result },
            isError: failures >= agentIds.length && agentIds.length > 0,
        };
    }
}

export class ClawkitCompressContextTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_compress_context',
        description: 'Intelligently compress conversation history within token budget.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                messages: { type: 'array', description: 'Messages to compress.' },
                target_tokens: { type: 'number' },
                preserve_recent: { type: 'number' },
                importance_threshold: { type: 'number' },
                model_profile: { type: 'object', description: 'Optional model profile for budget planning.' },
            },
            required: ['messages', 'target_tokens'],
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        if (!this.deps.flags.contextCompressionEnabled) {
            return {
                content: [{ type: 'text', text: 'Context compression is disabled by feature flag.' }],
                isError: true,
            };
        }
        const messages = asMessageArray(args.messages);
        const targetTokens = Math.max(256, Math.floor(asNumber(args.target_tokens, 50000)));
        const preserveRecent = Math.max(1, Math.floor(asNumber(args.preserve_recent, 10)));
        const importanceThreshold = Math.max(0, Math.min(1, asNumber(args.importance_threshold, 0)));
        const modelProfile = (args.model_profile && typeof args.model_profile === 'object')
            ? args.model_profile as Record<string, unknown>
            : undefined;
        const compressed = await this.deps.contextCompressor.compress(messages, targetTokens, preserveRecent, {
            context_window: typeof modelProfile?.context_window === 'number' ? modelProfile.context_window : undefined,
            reserve_response_tokens: typeof modelProfile?.reserve_response_tokens === 'number' ? modelProfile.reserve_response_tokens : undefined,
            compression_floor: typeof modelProfile?.compression_floor === 'number' ? modelProfile.compression_floor : undefined,
        });

        if (importanceThreshold > 0) {
            const summaries = compressed.summaries.filter((item) => item.importance >= importanceThreshold);
            const totalTokens =
                compressed.verbatim.reduce((acc, item) => acc + estimateTokens(item.content), 0) +
                compressed.key_facts.reduce((acc, item) => acc + estimateTokens(item), 0) +
                summaries.reduce((acc, item) => acc + estimateTokens(item.topic) + estimateTokens(item.summary), 0);

            return {
                content: [{
                    type: 'text',
                    text: `Compressed context to ~${totalTokens} tokens with importance threshold ${importanceThreshold.toFixed(2)}.`,
                }],
                structuredContent: {
                    compressed: {
                        ...compressed,
                        summaries,
                        total_tokens: totalTokens,
                    },
                    importance_threshold: importanceThreshold,
                },
            };
        }

        return {
            content: [{ type: 'text', text: `Compressed context to ~${compressed.total_tokens} tokens.` }],
            structuredContent: { compressed },
        };
    }
}

export class ClawkitSimulateResponseTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_simulate_response',
        description: 'Simulate the outcome of a potential response action (OODA Simulation).',
        inputSchema: {
            type: 'object' as const,
            properties: {
                actionPattern: { type: 'string', description: 'The response pattern to simulate.' },
                mode: { type: 'number', description: 'ConversationMode enum (0=Zen, 1=Peer, etc).' },
                intrusiveness: { type: 'number', description: 'Estimated intrusiveness (0.0-1.0).' }
            },
            required: ['actionPattern', 'mode', 'intrusiveness'],
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const actionPattern = asText(args.actionPattern);
        const mode = asNumber(args.mode, 0) as ConversationMode;
        const intrusiveness = asNumber(args.intrusiveness, 0.5);

        const result = await this.deps.arbiter.simulateAction(actionPattern, mode, intrusiveness);

        return {
            content: [{ type: 'text', text: `Simulation complete. Approved: ${result.approved}` }],
            structuredContent: { result },
        };
    }
}

export class ClawkitMemoryQueryTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_memory_query',
        description: 'Route and query across episodic, semantic, and causal memory.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string' },
                world_state: { type: 'object' },
            },
            required: ['query'],
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const query = asText(args.query);
        const worldState = normalizeWorldState(args.world_state ?? { query });
        const route = await this.deps.contextRouter.route(query);
        const results = await this.deps.memoryRouter.query({ query, worldState });
        return {
            content: [{ type: 'text', text: `Memory query routed to ${route}, ${results.length} result(s).` }],
            structuredContent: { route, results },
        };
    }
}

export class ClawkitGenerateToolTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_generate_tool',
        description: 'Generate and register a new sandbox MCP tool at runtime (experimental).',
        inputSchema: {
            type: 'object' as const,
            properties: {
                need: { type: 'string' },
                world_state: { type: 'object' },
            },
            required: ['need'],
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        if (!this.deps.flags.toolGeneratorExperimentalEnabled) {
            return {
                content: [{ type: 'text', text: 'Tool generation is disabled by feature flag.' }],
                isError: true,
            };
        }
        const need = asText(args.need).trim();
        if (!need) throw new Error('need is required.');

        const audit = async (
            status: 'accepted' | 'rejected',
            reason: string,
            toolName = 'unresolved',
            metadata?: Record<string, unknown>
        ) => {
            await this.deps.store.appendGeneratedToolAudit({
                tool_name: toolName,
                need,
                status,
                reason,
                created_at: Date.now(),
                metadata,
            });
        };

        const generatedLimit = Math.max(1, Math.floor(this.deps.generatedToolMax ?? 32));
        const existingGenerated = this.deps.listTools().filter((name) => name.startsWith('clawkit_gen_'));
        if (existingGenerated.length >= generatedLimit) {
            await audit('rejected', `Generated-tool limit reached (${generatedLimit}).`);
            throw new Error(`Generated-tool limit reached (${generatedLimit}).`);
        }

        const worldState = normalizeWorldState(args.world_state ?? { need });
        const spec = await this.deps.toolGenerator.generate(need, worldState);
        if (!spec) {
            await audit('rejected', 'Need rejected by sandbox policy.');
            throw new Error('Need rejected by sandbox policy or failed to generate tool spec.');
        }
        this.deps.toolGenerator.validateSpec(spec);
        if (this.deps.listTools().includes(spec.name)) {
            await audit('rejected', 'Generated tool name collision.', spec.name);
            throw new Error(`Generated tool "${spec.name}" already exists.`);
        }

        const tool = new GeneratedSandboxTool(spec, need, this.deps.oracleGenerator);
        this.deps.registerDynamicTool(tool);
        await audit('accepted', 'Tool registered in sandbox mode.', spec.name, {
            allowed_domains: spec.sandbox.allowed_domains,
            capabilities: spec.capabilities,
        });

        return {
            content: [{ type: 'text', text: `Generated tool registered: ${spec.name}` }],
            structuredContent: { spec },
        };
    }
}

export class ClawkitToolRecommendTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_tool_recommend',
        description: 'Recommend tools based on performance scoring and task intent.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                task: { type: 'string' },
                available_tools: { type: 'array' },
            },
            required: ['task'],
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };

    constructor(private readonly deps: CognitiveToolDeps) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const task = asText(args.task);
        const available = Array.isArray(args.available_tools)
            ? args.available_tools.map((t) => String(t))
            : this.deps.listTools();
        const recommendations = await this.deps.recommendTools(task, available);
        const performance = this.deps.toolPerformance.listRecords();
        return {
            content: [{ type: 'text', text: `Recommended ${recommendations.length} tool(s).` }],
            structuredContent: {
                recommendations,
                performance,
            },
        };
    }
}

export function createCognitiveTools(deps: CognitiveToolDeps): IMcpTool[] {
    return [
        new ClawkitRecallUserTool(deps),
        new ClawkitSenseIntentTool(deps),
        new ClawkitCheckPatternTool(deps),
        new ClawkitCommitPatternTool(deps),
        new ClawkitRecordOutcomeTool(deps),
        new ClawkitRecallSimilarTool(deps),
        new ClawkitUpdateUserTool(deps),
        new ClawkitDreamConversationTool(deps),
        new ClawkitReasonChainTool(deps),
        new ClawkitOrchestrateTool(deps),
        new ClawkitCompressContextTool(deps),
        new ClawkitMemoryQueryTool(deps),
        new ClawkitGenerateToolTool(deps),
        new ClawkitToolRecommendTool(deps),
        new ClawkitSimulateResponseTool(deps),
    ];
}
