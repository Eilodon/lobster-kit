import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeCallToolRequest } from '../src/tools/callToolCompat';
import { MCP_COMPATIBILITY_CONTRACT } from '../src/contracts/mcpCompatibilityContract';
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
import { createCognitiveTools } from '../src/tools/cognitive-tools';

describe('MCP compatibility contract', () => {
    it('normalizes modern and legacy CallTool payload shapes', () => {
        const modern = normalizeCallToolRequest({
            params: {
                name: 'clawkit_reason_chain',
                arguments: { draft_response: 'x' },
            },
        });
        const legacy = normalizeCallToolRequest({
            params: {
                tool: 'eidolon_defi_quote',
                input: { tokenIn: 'WBNB' },
            },
        });

        expect(modern.toolName).toBe('clawkit_reason_chain');
        expect(modern.args).toEqual({ draft_response: 'x' });
        expect(legacy.toolName).toBe('eidolon_defi_quote');
        expect(legacy.args).toEqual({ tokenIn: 'WBNB' });
    });

    it('fails fast when tool name is missing', () => {
        expect(() => normalizeCallToolRequest({ params: { arguments: {} } })).toThrow(/tool name/i);
    });

    it('keeps docs contract in sync with runtime contract constant', () => {
        const file = path.join(process.cwd(), 'docs/runtime-migration/contracts/runtime-v1/mcp-compatibility.contract.json');
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(parsed).toEqual(MCP_COMPATIBILITY_CONTRACT);
    });

    it('exposes required legacy and cognitive tools in dual-stack registry', () => {
        const registry = new McpToolRegistry();

        const callDefi = async (_action: string, _params?: Record<string, unknown>) =>
            ({ amountOutMin: '1', hash: '0x1' }) as any;
        const mockGuard = {
            validateAction: async () => ({ approved: true, reason: 'ok', riskScore: 10, confidence: 90 }),
            inducePanic: () => { },
            getBrain: () => ({
                recall: async () => [Date.now()],
                getIntuition: () => [0.1, 0.2],
                dream: async () => undefined,
            }),
            senseMarket: async () => ({
                whaleFlow: 'NEUTRAL',
                gasPrice: 'LOW',
                liquidityDepth: 'DEEP',
                sentiment: 'NEUTRAL',
                priceAction: 'RANGING',
            }),
        } as any;

        const mockStore = {
            loadUserProfile: async () => null,
            saveUserProfile: async () => undefined,
            upsertMemoryEntry: async () => undefined,
            appendReasoningTrace: async () => undefined,
            appendGeneratedToolAudit: async () => undefined,
        };

        const cognitiveTools = createCognitiveTools({
            flags: {
                reasonChainEnabled: true,
                contextCompressionEnabled: true,
                orchestratorEnabled: true,
                toolGeneratorExperimentalEnabled: true,
            },
            store: mockStore as any,
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
                    user_frustration_level: 0.2,
                    conversation_momentum: 'neutral',
                    context_depth: 'sparse',
                }),
            } as any,
            reasoningChain: {
                run: async (draft: string) => ({ response: draft, iterations: 1, final_score: 0.8, trace: { mode: 'fast', notes: [] } }),
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
                generate: async () => null,
                validateSpec: () => undefined,
            } as any,
            toolPerformance: {
                record: async () => undefined,
                listRecords: () => [],
            } as any,
            listTools: () => registry.listToolNames(),
            recommendTools: async () => [],
            registerDynamicTool: (tool) => registry.register(tool, true),
        });

        registry.registerAll([
            new OracleSenseTool(callDefi),
            new DefiQuoteTool(callDefi),
            new SecurityScanTool(callDefi),
            new PortfolioTool(callDefi),
            new ExecuteSwapTool(callDefi, mockGuard),
            new PanicTool(callDefi, mockGuard),
            new RecallTool(mockGuard),
            new IntuitionTool(mockGuard),
            new DreamTool(mockGuard),
            ...cognitiveTools,
        ]);

        const names = registry.listToolNames();

        for (const legacy of MCP_COMPATIBILITY_CONTRACT.list_tools.required_legacy_tools) {
            expect(names).toContain(legacy);
        }
        for (const cognitive of MCP_COMPATIBILITY_CONTRACT.list_tools.required_cognitive_core_tools) {
            expect(names).toContain(cognitive);
        }
    });
});
