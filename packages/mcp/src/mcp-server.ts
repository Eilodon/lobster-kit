#!/usr/bin/env node


import {
    ContextCompressor,
    ContextRouter,
    ConversationTransparency,
    Logger,
    MemoryDecayManager,
    MemoryGraph,
    MemoryRouter,
    ReasoningChain,
    SQLiteLearningStore,
    SwarmOrchestrator,
    ToolGenerator,
    ToolPerformanceTracker,
    createWorldState,
} from "@clawkit/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import ClawKit Core Modules
import { ClawKit, ClawKitConfig, OPBNB_CONFIG } from "@clawkit/toolkit";

import { createWalletClient, http } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { opBNB } from 'viem/chains';

import { EidolonGuard, ClawOracle, DeepSeekOracle, TraumaRegistry } from "@clawkit/soul";
import { McpToolRegistry } from './tools/McpToolRegistry';
import { MCP_COMPATIBILITY_CONTRACT } from './contracts/mcpCompatibilityContract';
import { normalizeCallToolRequest } from './tools/callToolCompat';
import {
    OracleSenseTool,
    DefiQuoteTool,
    SecurityScanTool,
    PortfolioTool,
    ExecuteSwapTool,
    PanicTool,
    RecallTool,
    IntuitionTool,
    DreamTool,
} from './tools/tools';
import { createCognitiveTools } from './tools/cognitive-tools';
import { ClawKit as DeFiClawKit, OpBnbDefiAdapter } from '@clawkit/defi-bnb';


/**
 * 🔌 EIDOLON-V MCP SERVER
 * Exposes the "God-tier" DeFi capabilities to Antigravity (and other LLMs).
 */
class EidolonServer {
    private server: Server;
    private kit: ClawKit;
    private defiKit: DeFiClawKit;
    private guard: EidolonGuard;       // 🛡️ The Exocortex Defender
    private toolRegistry!: McpToolRegistry; // 🔌 Dynamic Tool Dispatcher
    private readonly featureFlags = {
        cognitiveToolsEnabled: this.parseBooleanEnv('COGNITIVE_TOOLS_ENABLED', true),
        reasonChainEnabled: this.parseBooleanEnv('REASON_CHAIN_ENABLED', true),
        contextCompressionEnabled: this.parseBooleanEnv('CONTEXT_COMPRESSION_ENABLED', true),
        orchestratorEnabled: this.parseBooleanEnv('ORCHESTRATOR_ENABLED', false),
        toolGeneratorExperimentalEnabled: this.parseBooleanEnv('TOOL_GEN_EXPERIMENTAL_ENABLED', false),
    };
    private readonly rolloutConfig = {
        canaryPercent: this.parseNumberEnv('COGNITIVE_CANARY_PERCENT', 100),
        rollbackErrorRate: this.parseNumberEnv('COGNITIVE_AUTO_ROLLBACK_ERROR_RATE', 0.35),
        rollbackP95Ms: this.parseNumberEnv('COGNITIVE_AUTO_ROLLBACK_P95_MS', 3000),
        rollbackMinCalls: this.parseNumberEnv('COGNITIVE_AUTO_ROLLBACK_MIN_CALLS', 20),
        generatedToolMax: this.parseNumberEnv('TOOL_GEN_MAX_DYNAMIC_TOOLS', 32),
    };
    private readonly cognitiveStore = new SQLiteLearningStore();
    private readonly traumaRegistry = new TraumaRegistry();
    private readonly conversationTransparency = new ConversationTransparency();
    private readonly contextCompressor = new ContextCompressor();
    private readonly contextRouter = new ContextRouter();
    private readonly embeddingOracle = new DeepSeekOracle({
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL,
        embeddingModel: process.env.CLAWKIT_EMBEDDING_MODEL,
        embeddingEndpoint: process.env.CLAWKIT_EMBEDDING_ENDPOINT,
    });
    private readonly toolGenerator = new ToolGenerator(this.embeddingOracle);
    private readonly orchestrator = new SwarmOrchestrator(this.embeddingOracle);
    private readonly reasoningChain = new ReasoningChain(this.embeddingOracle);
    private readonly memoryGraph = new MemoryGraph(this.cognitiveStore);
    private readonly memoryDecay = new MemoryDecayManager(this.cognitiveStore);
    private readonly memoryRouter = new MemoryRouter(
        this.embeddingOracle,
        this.memoryGraph,
        async () => this.cognitiveStore.listMemoryEntries(),
        async () => [{ id: 'causal_bootstrap', confidence: 0.55, note: 'No causal trace persisted yet.' }]
    );
    private toolPerformance!: ToolPerformanceTracker;

    constructor() {
        this.server = new Server(
            {
                name: "eidolon-v-server",
                version: "1.0.0",
            },
            {
                capabilities: {
                    resources: {},
                    tools: {},
                },
            }
        );

        // Initialize ClawKit (Read-Only Mode Support)
        let account;
        // const privateKey = process.env.PRIVATE_KEY as `0x${string}`; // REMOVED for Security


        if (!process.env.PRIVATE_KEY) {
            Logger.warn("⚠️ EIDOLON-V: No PRIVATE_KEY found. Starting in READ-ONLY mode (Random Identity).");
            // Generate random account for read-only operations
            account = privateKeyToAccount(generatePrivateKey());
        } else {
            // Scope the key access to minimize lifetime in this closure
            {
                const _pk = process.env.PRIVATE_KEY as `0x${string}`;
                account = privateKeyToAccount(_pk);
            }
        }

        const rpcUrl = process.env.RPC_URL || "https://opbnb-mainnet-rpc.bnbchain.org";
        const chainId = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : opBNB.id;

        const walletClient = createWalletClient({
            account,
            chain: opBNB,
            transport: http(rpcUrl)
        });

        const config: ClawKitConfig = {
            rpcUrl,
            chainConfig: OPBNB_CONFIG,
            chainId
        };

        try {
            this.kit = new ClawKit(walletClient, config);
            this.defiKit = new DeFiClawKit(walletClient, config as any);
            this.kit.registerAdapter(new OpBnbDefiAdapter(this.defiKit), { override: true });

            const registeredDefiActions = this.kit.adapters.listActions('defi');
            if (registeredDefiActions.length === 0) {
                throw new Error('DeFi adapter registration failed: no actions exposed under domain "defi".');
            }

            // 👻 GHOST PROTOCOL: ClawOracle constructed for internal use
            const oracle = new ClawOracle(this.kit);
            // NOTE: gas.setOracle removed — gas module pruned in Phase 1.
            void oracle; // reserved for future sensor integration


            // 🛡️ INITIALIZE GUARD
            this.guard = new EidolonGuard(this.kit);
            // We await init() in run() or let it lazy load, but best to init here if async implies it.
            // Guard.init() is async, so we'll call it in run().

            Logger.info("🦅 EIDOLON-V: MCP Server Initialized. Connected to opBNB. GHOST Protocol Active.");
        } catch (e) {
            Logger.error("❌ EIDOLON-V: Failed to initialize ClawKit:", e);
            process.exit(1);
        }

        this.setupHandlers();

        // Error handling
        this.server.onerror = (error) => Logger.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    private parseBooleanEnv(name: string, fallback: boolean): boolean {
        const raw = process.env[name];
        if (!raw) return fallback;
        const normalized = raw.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return fallback;
    }

    private parseNumberEnv(name: string, fallback: number): number {
        const raw = process.env[name];
        if (!raw) return fallback;
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    private setupHandlers() {
        this.setupResources();
        this.setupTools();
    }


    /**
     * 🔌 Build MCP tool registry and wire all tools.
     * Replaces the old switch-case dispatcher.
     */
    private buildToolRegistry(): McpToolRegistry {
        if (this.kit.adapters.listActions('defi').length === 0) {
            throw new Error('Missing domain adapter: expected a registered "defi" adapter before MCP tool setup.');
        }

        // Shared DeFi adapter caller — routes through DomainAdapterRegistry
        const callDefi = <T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> =>
            this.kit.executeAdapterAction<T>({
                domain: 'defi',
                action,
                params,
                context: { actor: 'mcp', requestedAt: Date.now() },
            }).then((r) => r.data);

        const registry = new McpToolRegistry(this.cognitiveStore, {
            canaryPercent: this.rolloutConfig.canaryPercent,
            rollbackErrorRate: this.rolloutConfig.rollbackErrorRate,
            rollbackP95Ms: this.rolloutConfig.rollbackP95Ms,
            rollbackMinCalls: this.rolloutConfig.rollbackMinCalls,
        }).registerAll([
            new OracleSenseTool(callDefi),
            new DefiQuoteTool(callDefi),
            new SecurityScanTool(callDefi),
            new PortfolioTool(callDefi),
            new ExecuteSwapTool(callDefi, this.guard),
            new PanicTool(callDefi, this.guard),
            new RecallTool(this.guard),
            new IntuitionTool(this.guard),
            new DreamTool(this.guard),
        ]);

        this.toolPerformance = registry.getTelemetry();

        if (this.featureFlags.cognitiveToolsEnabled) {
            const cognitiveTools = createCognitiveTools({
                flags: {
                    reasonChainEnabled: this.featureFlags.reasonChainEnabled,
                    contextCompressionEnabled: this.featureFlags.contextCompressionEnabled,
                    orchestratorEnabled: this.featureFlags.orchestratorEnabled,
                    toolGeneratorExperimentalEnabled: this.featureFlags.toolGeneratorExperimentalEnabled,
                },
                store: this.cognitiveStore,
                traumaRegistry: this.traumaRegistry,
                conversationTransparency: this.conversationTransparency,
                reasoningChain: this.reasoningChain,
                contextCompressor: this.contextCompressor,
                contextRouter: this.contextRouter,
                memoryGraph: this.memoryGraph,
                memoryRouter: this.memoryRouter,
                memoryDecay: this.memoryDecay,
                orchestrator: this.orchestrator,
                toolGenerator: this.toolGenerator,
                toolPerformance: this.toolPerformance,
                oracleGenerator: this.embeddingOracle,
                generatedToolMax: this.rolloutConfig.generatedToolMax,
                listTools: () => registry.listToolNames(),
                recommendTools: (task, available) => registry.recommend(task, available),
                registerDynamicTool: (tool) => {
                    registry.register(tool, true);
                },
            });
            registry.registerAll(cognitiveTools);
        }

        return registry;
    }


    private setupResources() {
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: [
                {
                    uri: "eidolon://bioreactor",
                    name: "Biological State (Glucose/Dopamine/Cortisol)",
                    mimeType: "application/json",
                },
                {
                    uri: "eidolon://logs",
                    name: "Agent Thought Stream",
                    mimeType: "text/plain",
                },
                {
                    uri: "eidolon://telemetry",
                    name: "Tool Telemetry (call/error/latency/fallback)",
                    mimeType: "application/json",
                },
                {
                    uri: "eidolon://generated-tool-audit",
                    name: "Generated Tool Audit Logs",
                    mimeType: "application/json",
                },
                {
                    uri: "eidolon://contracts",
                    name: "Runtime + MCP compatibility contracts",
                    mimeType: "application/json",
                }
            ],
        }));

        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            if (request.params.uri === "eidolon://bioreactor") {
                // Access internal state via private property (hack for demo/MCP)
                const state = (this.guard as any).soul?.state || {
                    glucose: 100,
                    dopamine: 50,
                    cortisol: 0,
                    arousal: 0.5
                };
                return {
                    contents: [
                        {
                            uri: "eidolon://bioreactor",
                            mimeType: "application/json",
                            text: JSON.stringify(state, null, 2),
                        },
                    ],
                };
            }

            if (request.params.uri === "eidolon://logs") {
                return {
                    contents: [{
                        uri: "eidolon://logs",
                        mimeType: "text/plain",
                        text: "[INFO] System Nominal.\n[INFO] Emotional State: Stable."
                    }]
                };
            }

            if (request.params.uri === "eidolon://telemetry") {
                const byTool = await this.toolRegistry.getPerformanceRecords();
                return {
                    contents: [{
                        uri: "eidolon://telemetry",
                        mimeType: "application/json",
                        text: JSON.stringify({
                            feature_flags: this.featureFlags,
                            rollout: this.toolRegistry.getRolloutStatus(),
                            by_tool: byTool,
                            generated_at: Date.now(),
                        }, null, 2),
                    }]
                };
            }

            if (request.params.uri === "eidolon://generated-tool-audit") {
                const entries = await this.cognitiveStore.listGeneratedToolAudits(200);
                return {
                    contents: [{
                        uri: "eidolon://generated-tool-audit",
                        mimeType: "application/json",
                        text: JSON.stringify({
                            entries,
                            generated_at: Date.now(),
                        }, null, 2),
                    }]
                };
            }

            if (request.params.uri === "eidolon://contracts") {
                return {
                    contents: [{
                        uri: "eidolon://contracts",
                        mimeType: "application/json",
                        text: JSON.stringify({
                            mcp_compatibility: MCP_COMPATIBILITY_CONTRACT,
                            generated_at: Date.now(),
                        }, null, 2),
                    }]
                };
            }

            throw new Error("Resource not found");
        });
    }

    private setupTools() {
        // 🔄 Build registry once — all 9 tools registered dynamically
        this.toolRegistry = this.buildToolRegistry();

        // List available tools (was a 90-line hardcoded array)
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: this.toolRegistry.listDefinitions(),
        }));

        // Dispatch tool calls (was a 200-line switch-case)
        // SDK's ServerResult union requires 'task' in one branch — cast needed.
        // Our McpToolResult satisfies the CallToolResult branch at runtime.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const callHandler = async (request: any, _extra: any): Promise<any> => {
            try {
                const normalized = normalizeCallToolRequest(request);
                return this.toolRegistry.dispatch(normalized.toolName, normalized.args);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text', text: `Error: ${message}` }],
                    isError: true,
                };
            }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.server.setRequestHandler(CallToolRequestSchema, callHandler as any);

    }

    async run() {
        Logger.info("🧠 Initializing Eidolon Consciousness...");
        await this.initCognitiveRuntime();
        await this.guard.init(); // Wakes up the brain

        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        Logger.info("🦅 EIDOLON-V Server running on stdio");
    }

    private async initCognitiveRuntime(): Promise<void> {
        await this.cognitiveStore.init();
        await this.traumaRegistry.initPersistence(this.cognitiveStore, 'cognitive_trauma_registry.json');

        // Seed a tiny semantic baseline so memory_query has meaningful first result.
        await this.memoryGraph.addNode({
            id: 'semantic_bootstrap',
            concept: 'system bootstrapped',
            embedding: await this.embeddingOracle.embed(createWorldState('system', { status: 'ready' })),
            connections: [],
        });
    }
}

const server = new EidolonServer();
server.run().catch(console.error);
