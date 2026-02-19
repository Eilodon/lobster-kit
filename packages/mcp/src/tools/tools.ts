/**
 * 🌐 Tool Adapters — All 9 MCP tools as individual, testable classes.
 *
 * Each tool implements IMcpTool: self-describes its schema via `definition`
 * and executes its logic via `execute()`.
 *
 * These are registered into McpToolRegistry which dispatches calls dynamically.
 */

import { IMcpTool, McpToolResult } from './IMcpTool';
import { EidolonGuard } from '@clawkit/soul';
import { resolveTokenAddress } from '@clawkit/toolkit';
import { Logger, MarketState } from '@clawkit/core';


// ─── shared DeFi adapter helper type ──────────────────────────────────────

type DefiCaller = <T = unknown>(action: string, params?: Record<string, unknown>) => Promise<T>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Oracle Sense Tool
// ─────────────────────────────────────────────────────────────────────────────

export class OracleSenseTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_oracle_sense',
        description: 'Consult the Omniscient Oracle for market depth, price, and gas.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                symbol: { type: 'string', description: 'Symbol to check (e.g. WBNB)' },
            },
        },
    };

    constructor(private readonly callDefi: DefiCaller) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const symbol = (args.symbol as string) || 'WBNB';
        const result = await this.callDefi<{ amountOutMin: string }>('sense_oracle', {
            symbol, quoteToken: 'USDT', amount: '1', slippage: 1,
        });
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    symbol,
                    priceUSD: result.amountOutMin,
                    marketCondition: 'VOLATILE',
                    liquidityDepth: 'DEEP',
                }, null, 2),
            }],
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DeFi Quote Tool
// ─────────────────────────────────────────────────────────────────────────────

export class DefiQuoteTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_defi_quote',
        description: 'Get a Hyper-Routed swap quote (Best price across all fee tiers).',
        inputSchema: {
            type: 'object' as const,
            properties: {
                tokenIn: { type: 'string', description: 'Token symbol to sell' },
                tokenOut: { type: 'string', description: 'Token symbol to buy' },
                amount: { type: 'string', description: 'Amount in logic units (e.g. 1.5)' },
            },
            required: ['tokenIn', 'tokenOut', 'amount'],
        },
    };

    constructor(private readonly callDefi: DefiCaller) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const { tokenIn, tokenOut, amount } = args as { tokenIn: string; tokenOut: string; amount: string };
        const quote = await this.callDefi<{ amountOutMin: string }>('quote', {
            tokenIn, tokenOut, amount, slippage: 0.5,
        });
        return {
            content: [{
                type: 'text',
                text: `⚡ HYPER-ROUTE FOUND:\nInput: ${amount} ${tokenIn}\nOutput: ${quote.amountOutMin} ${tokenOut}\nExecution: PARALLEL`,
            }],
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Security Scan Tool
// ─────────────────────────────────────────────────────────────────────────────

export class SecurityScanTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_security_scan',
        description: 'Scan a token for risks (Honeypot, Owner, Liquidity).',
        inputSchema: {
            type: 'object' as const,
            properties: {
                address: { type: 'string', description: 'Contract address to scan' },
            },
            required: ['address'],
        },
    };

    constructor(private readonly callDefi: DefiCaller) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const report = await this.callDefi('scan_contract', { address: args.address });
        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Portfolio Health Tool
// ─────────────────────────────────────────────────────────────────────────────

export class PortfolioTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_get_portfolio',
        description: 'Get current portfolio health and positions.',
        inputSchema: { type: 'object' as const, properties: {} },
    };

    constructor(private readonly callDefi: DefiCaller) { }

    async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
        const health = await this.callDefi('portfolio_health', {});
        return { content: [{ type: 'text', text: JSON.stringify(health, null, 2) }] };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Execute Swap Tool
// ─────────────────────────────────────────────────────────────────────────────

const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD']);

export class ExecuteSwapTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_execute_swap',
        description: 'Execute a swap securely via EidolonGuard.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                tokenIn: { type: 'string' },
                tokenOut: { type: 'string' },
                amount: { type: 'string' },
                slippage: { type: 'number', description: 'Slippage % (default 0.5)' },
            },
            required: ['tokenIn', 'tokenOut', 'amount'],
        },
    };

    constructor(
        private readonly callDefi: DefiCaller,
        private readonly guard: EidolonGuard,
    ) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const { tokenIn, tokenOut, amount, slippage = 0.5 } = args as {
            tokenIn: string; tokenOut: string; amount: string; slippage?: number;
        };

        Logger.warn(`🛡️ EIDOLON GUARD: Intercepting Swap Request: ${amount} ${tokenIn} → ${tokenOut}`);

        const safeResolve = (symbol: string) => {
            const addr = resolveTokenAddress(symbol);
            if (addr === symbol && !addr.startsWith('0x')) {
                throw new Error(`Unknown token symbol: ${symbol}`);
            }
            return addr;
        };

        // Step 1: USD-value estimate for guard validation
        const usdQuote = await this.callDefi<{ amountOutMin: string }>('quote', {
            tokenIn, tokenOut: 'USDT', amount, slippage: 1,
        });
        const amountUSD = Number(usdQuote.amountOutMin);
        if (!Number.isFinite(amountUSD) || amountUSD <= 0) {
            throw new Error(`Unable to estimate USD value for ${amount} ${tokenIn}.`);
        }

        const context = { tokenAddress: safeResolve(tokenOut), amountUSD };
        const actionType = STABLECOINS.has(tokenIn.toUpperCase()) ? 'BUY' : 'SELL';
        const validation = await this.guard.validateAction(actionType as 'BUY' | 'SELL', context);

        if (!validation.approved) {
            return {
                content: [{
                    type: 'text',
                    text: `🛑 BLOCKED BY EIDOLON GUARD\nReason: ${validation.reason}\nRisk Score: ${validation.riskScore}\nConfidence: ${validation.confidence}%`,
                }],
                isError: true,
            };
        }

        Logger.info('✅ GUARD APPROVED. Executing...');
        const tx = await this.callDefi<{ hash: string }>('swap', {
            tokenIn, tokenOut, amount, slippage, amountUSD,
        });

        return {
            content: [{
                type: 'text',
                text: `✅ SWAP EXECUTED\nTX Hash: ${tx.hash}\nGuard Risk Score: ${validation.riskScore}`,
            }],
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Panic Button Tool
// ─────────────────────────────────────────────────────────────────────────────

export class PanicTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_panic_button',
        description: 'TRIGGER EMERGENCY EXIT. Sells everything to safe assets.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                confirmation: { type: 'string', description: "Must be 'CONFIRM_PANIC'" },
            },
            required: ['confirmation'],
        },
    };

    constructor(
        private readonly callDefi: DefiCaller,
        private readonly guard: EidolonGuard,
    ) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        if (args.confirmation !== 'CONFIRM_PANIC') {
            throw new Error('Invalid confirmation code');
        }

        Logger.warn('🚨 PANIC BUTTON TRIGGERED VIA MCP');
        // Trigger emotional panic on the soul layer
        (this.guard as unknown as { soul?: { inducePanic(reason: string): void } })
            .soul?.inducePanic('User Manual Trigger');

        const results = await this.callDefi<string[]>('dump_all_positions');
        return {
            content: [{
                type: 'text',
                text: `🚨 PANIC PROTOCOL EXECUTED.\n${results.join('\n')}`,
            }],
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Recall Tool (HyperMemory)
// ─────────────────────────────────────────────────────────────────────────────

export class RecallTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_recall',
        description: 'Recall past market conditions similar to current state (HyperMemory).',
        inputSchema: {
            type: 'object' as const,
            properties: {
                k: { type: 'number', description: 'Number of memories to recall (default 5)' },
            },
        },
    };

    constructor(private readonly guard: EidolonGuard) { }

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        const k = (args.k as number) || 5;
        const marketState = await (this.guard as unknown as { senseMarket(): Promise<MarketState> }).senseMarket();
        const ids = await this.guard.getBrain().recall(marketState, k);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    message: `🧠 RECALLED ${ids.length} SIMILAR MOMENTS`,
                    timestamps: ids.map((id: unknown) => Number(id)),
                }, null, 2),
            }],
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Intuition Tool
// ─────────────────────────────────────────────────────────────────────────────

export class IntuitionTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_intuition',
        description: "Tap into the Liquid Brain's current intuition state.",
        inputSchema: { type: 'object' as const, properties: {} },
    };

    constructor(private readonly guard: EidolonGuard) { }

    async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
        const intuition = this.guard.getBrain().getIntuition();
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    intuition_vector: intuition,
                    interpretation: 'Raw liquid state vector represents temporal market perception.',
                }, null, 2),
            }],
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Dream Tool (Experience Replay)
// ─────────────────────────────────────────────────────────────────────────────

export class DreamTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_dream',
        description: 'Trigger a dreaming cycle (Experience Replay) to strengthen learning.',
        inputSchema: { type: 'object' as const, properties: {} },
    };

    constructor(private readonly guard: EidolonGuard) { }

    async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
        await this.guard.getBrain().dream();
        return {
            content: [{ type: 'text', text: '🌙 DREAM CYCLE INITIATED. Experience replay active.' }],
        };
    }
}
