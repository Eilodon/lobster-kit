#!/usr/bin/env node


import { Logger } from "@clawkit/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import ClawKit Core Modules
import { ClawKit, ClawKitConfig, resolveTokenAddress, OPBNB_CONFIG } from "@clawkit/toolkit";

import { createWalletClient, http } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { opBNB } from 'viem/chains';

import { EidolonGuard, ClawOracle } from "@clawkit/soul";
import { McpToolRegistry } from './tools/McpToolRegistry';
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
        let isReadOnly = false;
        // const privateKey = process.env.PRIVATE_KEY as `0x${string}`; // REMOVED for Security


        if (!process.env.PRIVATE_KEY) {
            Logger.warn("⚠️ EIDOLON-V: No PRIVATE_KEY found. Starting in READ-ONLY mode (Random Identity).");
            // Generate random account for read-only operations
            account = privateKeyToAccount(generatePrivateKey());
            isReadOnly = true;
        } else {
            // Scope the key access to minimize lifetime in this closure
            {
                const _pk = process.env.PRIVATE_KEY as `0x${string}`;
                account = privateKeyToAccount(_pk);
            }
        }

        const walletClient = createWalletClient({
            account,
            chain: opBNB,
            transport: http("https://opbnb-mainnet-rpc.bnbchain.org")
        });

        const config: ClawKitConfig = {
            rpcUrl: "https://opbnb-mainnet-rpc.bnbchain.org",
            chainConfig: OPBNB_CONFIG,
            chainId: opBNB.id
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

        return new McpToolRegistry().registerAll([
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
            const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
            return this.toolRegistry.dispatch(request.params.name, args);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.server.setRequestHandler(CallToolRequestSchema, callHandler as any);

    }

    async run() {
        Logger.info("🧠 Initializing Eidolon Consciousness...");
        await this.guard.init(); // Wakes up the brain

        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        Logger.info("🦅 EIDOLON-V Server running on stdio");
    }
}

const server = new EidolonServer();
server.run().catch(console.error);
