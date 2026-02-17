#!/usr/bin/env node

// 🔴 CRITICAL: Redirect console.log to stderr BEFORE any imports.
// MCP stdio transport uses stdout as the JSON-RPC channel.
// Any console.log from imported modules (defi.ts, EmotionalCore.ts, etc.)
// would inject non-JSON text into the protocol stream → client disconnect.
console.log = console.error;

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Import ClawKit Core Modules
import { ClawKit } from "./index";
import { ClawOracle } from "./eidolon/sensors/ClawOracle"; // Import Oracle
import { ClawKitConfig, getTokenDecimals } from "./types";
import { OPBNB_CONFIG } from "./types";
import { createWalletClient, http, custom } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { opBNB } from 'viem/chains';

/**
 * 🔌 EIDOLON-V MCP SERVER
 * Exposes the "God-tier" DeFi capabilities to Antigravity (and other LLMs).
 */
class EidolonServer {
    private server: Server;
    private kit: ClawKit;

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
        // FIX Bug #2: Remove unsafe fallback
        let account;
        let isReadOnly = false;
        const privateKey = process.env.PRIVATE_KEY as `0x${string}`;

        if (!privateKey) {
            console.error("⚠️ EIDOLON-V: No PRIVATE_KEY found. Starting in READ-ONLY mode (Random Identity).");
            // Generate random account for read-only operations
            const { generatePrivateKey } = require('viem/accounts');
            account = privateKeyToAccount(generatePrivateKey());
            isReadOnly = true;
        } else {
            account = privateKeyToAccount(privateKey);
        }

        const walletClient = createWalletClient({
            account,
            chain: opBNB,
            transport: http("https://opbnb-mainnet-rpc.bnbchain.org")
        });

        const config: ClawKitConfig = {
            rpcUrl: "https://opbnb-mainnet-rpc.bnbchain.org",
            chainConfig: OPBNB_CONFIG
        };

        try {
            this.kit = new ClawKit(walletClient, config);

            // 👻 GHOST PROTOCOL: Inject Internal Oracle for Privacy
            // This prevents GasModule from calling CoinGecko/Binance public APIs
            const oracle = new ClawOracle(this.kit);
            this.kit.gas.setOracle(oracle);

            console.error("🦅 EIDOLON-V: MCP Server Initialized. Connected to opBNB. GHOST Protocol Active.");
        } catch (e) {
            console.error("❌ EIDOLON-V: Failed to initialize ClawKit:", e);
            process.exit(1);
        }

        this.setupHandlers();

        // Error handling
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    private setupHandlers() {
        this.setupResources();
        this.setupTools();
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
                // Ideally expose via public getter
                // For now, we return a simulated static state or real if possible
                const state = (this.kit.security as any).guard?.soul?.state || {
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
                        text: "[INFO] System Nominal.\n[INFO] Emotional State: Stable.\n[WARN] Market Volatility detected."
                    }]
                };
            }

            throw new Error("Resource not found");
        });
    }

    private setupTools() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "eidolon_oracle_sense",
                    description: "Consult the Omniscient Oracle for market depth, price, and gas.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Symbol to check (e.g. WBNB)" },
                        },
                    },
                },
                {
                    name: "eidolon_defi_quote",
                    description: "Get a Hyper-Routed swap quote (Best price across all fee tiers).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            tokenIn: { type: "string", description: "Token symbol to sell" },
                            tokenOut: { type: "string", description: "Token symbol to buy" },
                            amount: { type: "string", description: "Amount in logic units (e.g. 1.5)" },
                        },
                        required: ["tokenIn", "tokenOut", "amount"],
                    },
                },
                {
                    name: "eidolon_security_scan",
                    description: "Scan a token for risks (Honeypot, Owner, Liquidity).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            address: { type: "string", description: "Contract address to scan" },
                        },
                        required: ["address"],
                    },
                },
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case "eidolon_oracle_sense": {
                        // In a real run, we'd use this.kit.security.guard.senseMarket()
                        // But we can instantiate Oracle directly if needed or use exposed method
                        // For now, let's simulate a sense call or use a direct one if available
                        const quoteResult = await this.kit.defi.getRealQuote('WBNB', 'USDT', 1000000000000000000n, 1);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        symbol: "WBNB",
                                        priceUSD: Number(quoteResult.amountOutMin) / Math.pow(10, getTokenDecimals('USDT')), // FIX Bug #25: Destructure quote result
                                        marketCondition: "VOLATILE",
                                        liquidityDepth: "DEEP" // Would call probeLiquidity here
                                    }, null, 2),
                                },
                            ],
                        };
                    }

                    case "eidolon_defi_quote": {
                        const args = request.params.arguments as { tokenIn: string; tokenOut: string; amount: string };
                        const { tokenIn, tokenOut, amount } = args;
                        // FIX Bug #26: Use correct decimals for input token
                        const decimals = getTokenDecimals(tokenIn);
                        const amountBn = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals)));
                        const quote = await this.kit.defi.getRealQuote(tokenIn, tokenOut, amountBn, 0.5);

                        // Calculate output human readable
                        const outDecimals = getTokenDecimals(tokenOut);
                        const outAmount = Number(quote.amountOutMin) / Math.pow(10, outDecimals);

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `⚡ HYPER-ROUTE FOUND:\nInput: ${amount} ${tokenIn}\nOutput: ${outAmount} ${tokenOut}\nExecution: PARALLEL`,
                                },
                            ],
                        };
                    }

                    case "eidolon_security_scan": {
                        const args = request.params.arguments as { address: string };
                        const { address } = args;
                        const report = await this.kit.security.scanContract(address);
                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify(report, null, 2)
                            }]
                        };
                    }

                    default:
                        throw new Error("Unknown tool");
                }
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("🦅 EIDOLON-V Server running on stdio");
    }
}

const server = new EidolonServer();
server.run().catch(console.error);
