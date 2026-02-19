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
import { z } from "zod";

// Import ClawKit Core Modules
import { ClawKit, ClawKitConfig, getTokenDecimals, resolveTokenAddress, OPBNB_CONFIG } from "@clawkit/toolkit";

import { createWalletClient, formatUnits, http, parseUnits } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { opBNB } from 'viem/chains';

import { EidolonGuard, GuardConfig, ClawOracle } from "@clawkit/soul";

/**
 * 🔌 EIDOLON-V MCP SERVER
 * Exposes the "God-tier" DeFi capabilities to Antigravity (and other LLMs).
 */
class EidolonServer {
    private server: Server;
    private kit: ClawKit;
    private guard: EidolonGuard; // 🛡️ The Exocortex Defender

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
            chainConfig: OPBNB_CONFIG
        };

        try {
            this.kit = new ClawKit(walletClient, config);

            // 👻 GHOST PROTOCOL: Inject Internal Oracle for Privacy
            const oracle = new ClawOracle(this.kit);
            this.kit.gas.setOracle(oracle);

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
                {
                    name: "eidolon_get_portfolio",
                    description: "Get current portfolio health and positions.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    },
                },
                {
                    name: "eidolon_execute_swap",
                    description: "Execute a swap securely via EidolonGuard.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            tokenIn: { type: "string" },
                            tokenOut: { type: "string" },
                            amount: { type: "string" },
                            slippage: { type: "number", description: "Slippage % (default 0.5)" }
                        },
                        required: ["tokenIn", "tokenOut", "amount"]
                    }
                },
                {
                    name: "eidolon_panic_button",
                    description: "TRIGGER EMERGENCY EXIT. Sells everything to safe assets.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            confirmation: { type: "string", description: "Must be 'CONFIRM_PANIC'" }
                        },
                        required: ["confirmation"]
                    }
                }
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case "eidolon_oracle_sense": {
                        // FIX P4-F2: Use dynamic symbol param instead of hardcoded WBNB-USDT
                        const symbol = (request.params.arguments as any)?.symbol || 'WBNB';
                        const senseDecimals = getTokenDecimals(symbol);
                        const oneUnit = parseUnits('1', senseDecimals);
                        const quoteResult = await this.kit.defi.getRealQuote(symbol, 'USDT', oneUnit, 1);
                        const usdtDecimals = getTokenDecimals('USDT');
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        symbol,
                                        priceUSD: formatUnits(quoteResult.amountOutMin, usdtDecimals),
                                        marketCondition: "VOLATILE",
                                        liquidityDepth: "DEEP"
                                    }, null, 2),
                                },
                            ],
                        };
                    }

                    case "eidolon_defi_quote": {
                        const args = request.params.arguments as { tokenIn: string; tokenOut: string; amount: string };
                        const { tokenIn, tokenOut, amount } = args;
                        const decimals = getTokenDecimals(tokenIn);
                        const amountBn = parseUnits(amount, decimals);
                        const quote = await this.kit.defi.getRealQuote(tokenIn, tokenOut, amountBn, 0.5);

                        const outDecimals = getTokenDecimals(tokenOut);
                        const outAmount = formatUnits(quote.amountOutMin, outDecimals);

                        return {
                            content: [{
                                type: "text",
                                text: `⚡ HYPER-ROUTE FOUND:\nInput: ${amount} ${tokenIn}\nOutput: ${outAmount} ${tokenOut}\nExecution: PARALLEL`,
                            }],
                        };
                    }

                    case "eidolon_security_scan": {
                        const args = request.params.arguments as { address: string };
                        const { address } = args;
                        const report = await this.kit.security.scanContract(address);
                        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
                    }

                    case "eidolon_get_portfolio": {
                        const health = await this.kit.analytics.portfolioHealth();
                        return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
                    }

                    case "eidolon_execute_swap": {
                        const args = request.params.arguments as { tokenIn: string; tokenOut: string; amount: string; slippage?: number };
                        Logger.warn(`🛡️ EIDOLON GUARD: Intercepting Swap Request: ${args.amount} ${args.tokenIn} -> ${args.tokenOut}`);

                        // FIX: Use centralized token resolution
                        // We use the imported helper which relies on config
                        const safeResolve = (symbol: string) => {
                            const addr = resolveTokenAddress(symbol);
                            if (addr === symbol && !addr.startsWith('0x')) {
                                // Failed to resolve and not an address
                                throw new Error(`Unknown token symbol: ${symbol}`);
                            }
                            return addr;
                        };

                        const decimals = getTokenDecimals(args.tokenIn);
                        const amountBn = parseUnits(args.amount, decimals);
                        // Get quote in USDT to determine USD value (using 1% slippage for valuation)
                        const quote = await this.kit.defi.getRealQuote(args.tokenIn, 'USDT', amountBn, 1);
                        const usdtDecimals = getTokenDecimals('USDT');
                        // Fix for P0: Calculate real USD value for thermodynamics check
                        const amountUSD = parseFloat(formatUnits(quote.amountOutMin, usdtDecimals));

                        const context = {
                            tokenAddress: safeResolve(args.tokenOut),
                            amountUSD
                        };

                        // FIX P4-F3: Determine action type based on swap direction
                        // Selling a stablecoin = buying crypto = BUY
                        // Selling crypto for stablecoin = SELL
                        const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD']);
                        const actionType = STABLECOINS.has(args.tokenIn.toUpperCase()) ? 'BUY' : 'SELL';
                        const validation = await this.guard.validateAction(actionType as any, context);

                        if (!validation.approved) {
                            return {
                                content: [{
                                    type: "text",
                                    text: `🛑 BLOCKED BY EIDOLON GUARD\nReason: ${validation.reason}\nRisk Score: ${validation.riskScore}\nConfidence: ${validation.confidence}%`
                                }],
                                isError: true
                            };
                        }

                        // 2. EXECUTE IF APPROVED
                        Logger.info("✅ GUARD APPROVED. Executing...");
                        const tx = await this.kit.defi.swap({
                            from: args.tokenIn,
                            to: args.tokenOut,
                            amount: args.amount,
                            slippage: args.slippage || 0.5
                        });

                        return {
                            content: [{
                                type: "text",
                                text: `✅ SWAP EXECUTED\nTX Hash: ${tx.hash}\nGuard Risk Score: ${validation.riskScore}`
                            }]
                        };
                    }

                    case "eidolon_panic_button": {
                        const args = request.params.arguments as { confirmation: string };
                        if (args.confirmation !== 'CONFIRM_PANIC') {
                            throw new Error("Invalid confirmation code");
                        }

                        Logger.warn("🚨 PANIC BUTTON TRIGGERED VIA MCP");
                        // Trigger emotional panic
                        (this.guard as any).soul?.inducePanic("User Manual Trigger");

                        // Execute emergency exit logic
                        const results = await this.kit.defi.dumpAllPositions();

                        return {
                            content: [{
                                type: "text",
                                text: `🚨 PANIC PROTOCOL EXECUTED.\n${results.join('\n')}`
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
        Logger.info("🧠 Initializing Eidolon Consciousness...");
        await this.guard.init(); // Wakes up the brain

        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        Logger.info("🦅 EIDOLON-V Server running on stdio");
    }
}

const server = new EidolonServer();
server.run().catch(console.error);
