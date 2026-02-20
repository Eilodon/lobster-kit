
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import {
    ConversationTransparency,
    MemoryDecayManager,
    MemoryGraph,
    MemoryRouter,
    SQLiteLearningStore,
    ToolGenerator,
    ToolPerformanceTracker,
    createWorldState,
    type IOracle,
} from '@clawkit/core';
import {
    TraumaRegistry,
    WasmAdapter,
    CognitiveArbiter,
    ReasoningChain,
    SwarmOrchestrator,
    ContextCompressor,
    ContextRouter
} from '@clawkit/soul';
import { createCognitiveTools } from '../src/tools/cognitive-tools';
import { McpToolRegistry } from '../src/tools/McpToolRegistry';
import {
    DefiQuoteTool,
    DreamTool,
    ExecuteSwapTool,
    IntuitionTool,
    OracleSenseTool,
    PanicTool,
    PortfolioTool,
    RecallTool,
    SecurityScanTool,
} from '../src/tools/tools';


// Mock implementation of SQLiteLearningStore
class MockStore {
    public memory: Map<string, any> = new Map();
    public userProfiles: Map<string, any> = new Map();
    public audits: any[] = [];
    public traces: any[] = [];

    async init() { return; }
    async close() { return; }

    // IStorageProvider
    async save(key: string, value: any) { this.memory.set(key, value); }
    async load(key: string) { return this.memory.get(key); }

    // Memory Logic
    async listMemoryEntries() { return []; }
    async deleteMemoryEntries(ids: string[]) { return ids.length; }

    // User Profile
    async getUserProfile(id: string) { return this.userProfiles.get(id); }
    async saveUserProfile(profile: any) { this.userProfiles.set(profile.user_id, profile); }

    // Audits
    async appendGeneratedToolAudit(audit: any) { this.audits.push(audit); }
    async listGeneratedToolAudits(limit: number) { return this.audits.slice(-limit); }

    // Traces
    async appendReasoningTrace(trace: any) { this.traces.push(trace); }
}

describe('Cognitive MCP Tools', () => {
    let store: any; // Use any to bypass strict type check for now
    let trauma: TraumaRegistry;
    let conversation: ConversationTransparency;
    let compressor: ContextCompressor;
    let router: ContextRouter;
    let generator: ToolGenerator;
    let orchestrator: SwarmOrchestrator;
    let perf: ToolPerformanceTracker;
    let reasoning: ReasoningChain;
    let graph: MemoryGraph;
    let decay: MemoryDecayManager;
    let memoryRouter: MemoryRouter;
    let registry: McpToolRegistry;
    let tools: any[];

    // ... (oracle definition omitted for brevity, keeping same)

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
        async embed(state) {
            const text = JSON.stringify(state);
            const out = new Array(64).fill(0);
            for (let i = 0; i < text.length; i++) {
                const idx = (text.charCodeAt(i) + i) % out.length;
                out[idx] += 1;
            }
            return out;
        },
        async refine(draft, critique) {
            return `${draft}\n${critique.suggestions.join('\n')}`;
        },
        getName() {
            return 'stub-oracle';
        },
    };

    // Mock Arbiter
    const mockArbiter = {
        sense: async (msg: string) => ({
            user_expertise_signal: 'expert',
            user_intent: 'debug_problem',
            user_frustration_level: 0.2,
            context_depth: 'rich',
            thermo_state: [0.5, 0.5, 0.5, 0.5, 0.5],
            pattern_is_appropriate: true,
            pattern_drift_detected: false,
        }),
        simulateAction: async (pattern: string) => ({
            approved: true,
            riskScore: 10,
            confidence: 90,
            predicted_outcome: 'positive',
        }),
        checkPattern: async () => ({
            valid: true,
            score: 0.9
        })
    } as any;

    beforeAll(async () => {
        // MOCK WASM ADAPTER TO PREVENT SIGSEGV
        const mockWasm = {
            init: vi.fn(),
            createTraumaRegistry: vi.fn().mockReturnValue(null),
            createCausalGraph: vi.fn().mockReturnValue(null),
            isReady: vi.fn().mockReturnValue(true),
        };
        vi.spyOn(WasmAdapter, 'getInstance').mockReturnValue(mockWasm as any);

        // USE MOCK STORE instead of SQLiteLearningStore
        store = new MockStore();

        trauma = new TraumaRegistry();
        conversation = new ConversationTransparency();
        compressor = new ContextCompressor();
        router = new ContextRouter();
        generator = new ToolGenerator();
        orchestrator = new SwarmOrchestrator();
        perf = new ToolPerformanceTracker();
        reasoning = new ReasoningChain(oracle);
        graph = new MemoryGraph(store);
        decay = new MemoryDecayManager(store);
        memoryRouter = new MemoryRouter(
            oracle,
            graph,
            async () => store.listMemoryEntries(),
            async () => []
        );
        registry = new McpToolRegistry();

        tools = createCognitiveTools({
            flags: {
                reasonChainEnabled: true,
                contextCompressionEnabled: true,
                orchestratorEnabled: true,
                toolGeneratorExperimentalEnabled: false,
            },
            store,
            traumaRegistry: trauma,
            conversationTransparency: conversation,
            reasoningChain: reasoning,
            contextCompressor: compressor,
            contextRouter: router,
            memoryGraph: graph,
            memoryRouter,
            memoryDecay: decay,
            orchestrator,
            toolGenerator: generator,
            toolPerformance: perf,
            listTools: () => registry.listToolNames(),
            recommendTools: (task, available) => registry.recommend(task, available),
            registerDynamicTool: (tool) => registry.register(tool, true),
            arbiter: mockArbiter,
        });

        await store.init();
        await trauma.initPersistence(store, 'test_cognitive_trauma.json');
        for (const tool of tools) registry.register(tool, true);
    });

    afterAll(async () => {
        if (trauma) await trauma.flush();
        // if (store) store.close(); // Mock store doesn't need explicit close, but has the method
        vi.restoreAllMocks();
    });

    it('registers all 15 clawkit cognitive tools', () => {
        const names = registry.listToolNames().filter((n) => n.startsWith('clawkit_'));
        expect(names).toHaveLength(15);
    });
});
