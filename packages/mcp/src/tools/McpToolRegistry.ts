/**
 * 🗂️ McpToolRegistry — Dynamic Tool Dispatcher
 *
 * Replaces the 200-line switch-case in mcp-server.ts.
 * Tools register themselves; dispatch is O(1) via Map lookup.
 *
 * Usage:
 *   const registry = new McpToolRegistry();
 *   registry.register(new OracleSenseTool(kit));
 *   registry.register(new DefiQuoteTool(kit));
 *   // ...
 *
 *   // In ListTools handler:
 *   return { tools: registry.listDefinitions() };
 *
 *   // In CallTool handler:
 *   return await registry.dispatch(request.params.name, args);
 */

import { IMcpTool, McpToolDefinition, McpToolResult } from './IMcpTool';
import { ToolPerformanceTracker, SQLiteLearningStore } from '@clawkit/core';

export interface RolloutOptions {
    cognitivePrefix?: string;
    canaryPercent?: number;
    rollbackErrorRate?: number;
    rollbackP95Ms?: number;
    rollbackMinCalls?: number;
}

type RolloutState = {
    disabled: boolean;
    reason?: string;
    triggered_at?: number;
};

const DEFAULT_ROLLOUT: Required<RolloutOptions> = {
    cognitivePrefix: 'clawkit_',
    canaryPercent: 100,
    rollbackErrorRate: 0.35,
    rollbackP95Ms: 3000,
    rollbackMinCalls: 20,
};

function clampPercent(v: number | undefined, fallback: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(100, v));
}

function isStoreLike(input: unknown): input is SQLiteLearningStore {
    return !!input && typeof input === 'object' && 'upsertToolPerformance' in (input as Record<string, unknown>);
}

export class McpToolRegistry {
    private readonly tools = new Map<string, IMcpTool>();
    private readonly telemetry: ToolPerformanceTracker;
    private readonly rollout: Required<RolloutOptions>;
    private rolloutState: RolloutState = { disabled: false };

    constructor(store?: SQLiteLearningStore, rollout?: RolloutOptions);
    constructor(rollout?: RolloutOptions);
    constructor(storeOrRollout?: SQLiteLearningStore | RolloutOptions, maybeRollout?: RolloutOptions) {
        const store = isStoreLike(storeOrRollout) ? storeOrRollout : undefined;
        const rollout = isStoreLike(storeOrRollout) ? maybeRollout : storeOrRollout;
        this.telemetry = new ToolPerformanceTracker(store);
        this.rollout = {
            cognitivePrefix: rollout?.cognitivePrefix || DEFAULT_ROLLOUT.cognitivePrefix,
            canaryPercent: clampPercent(rollout?.canaryPercent, DEFAULT_ROLLOUT.canaryPercent),
            rollbackErrorRate: typeof rollout?.rollbackErrorRate === 'number' ? Math.max(0, Math.min(1, rollout.rollbackErrorRate)) : DEFAULT_ROLLOUT.rollbackErrorRate,
            rollbackP95Ms: typeof rollout?.rollbackP95Ms === 'number' ? Math.max(1, rollout.rollbackP95Ms) : DEFAULT_ROLLOUT.rollbackP95Ms,
            rollbackMinCalls: typeof rollout?.rollbackMinCalls === 'number' ? Math.max(1, Math.floor(rollout.rollbackMinCalls)) : DEFAULT_ROLLOUT.rollbackMinCalls,
        };
    }

    /** Register one or more tools. Throws on duplicate name unless override=true. */
    register(tool: IMcpTool, override = false): this {
        const name = tool.definition.name;
        if (this.tools.has(name) && !override) {
            throw new Error(`McpToolRegistry: Tool "${name}" already registered.`);
        }
        this.tools.set(name, tool);
        return this; // chainable
    }

    /** Register multiple tools at once. */
    registerAll(tools: IMcpTool[]): this {
        for (const tool of tools) this.register(tool);
        return this;
    }

    /** Returns all tool definitions — used by ListTools handler. */
    listDefinitions(): McpToolDefinition[] {
        return Array.from(this.tools.values()).map((t) => t.definition);
    }

    /**
     * Dispatch a named tool call — replaces the switch-case.
     * Returns an error McpToolResult (not a throw) if tool is not found
     * or execution fails, so the MCP protocol stays clean.
     */
    async dispatch(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
        if (this.isCognitiveTool(toolName) && this.rolloutState.disabled) {
            await this.telemetry.record(toolName, false, 0, { fallbackUsed: true });
            return {
                content: [{ type: 'text', text: `Cognitive rollout disabled: ${this.rolloutState.reason ?? 'rollback triggered'}` }],
                isError: true,
            };
        }

        if (this.isCognitiveTool(toolName) && !this.isCanaryAllowed(toolName, args)) {
            await this.telemetry.record(toolName, false, 0, { fallbackUsed: true });
            return {
                content: [{ type: 'text', text: `Tool "${toolName}" currently gated by canary rollout (${this.rollout.canaryPercent}%).` }],
                isError: true,
            };
        }

        const tool = this.tools.get(toolName);
        if (!tool) {
            await this.telemetry.record(toolName, false, 0, { fallbackUsed: true });
            return {
                content: [{ type: 'text', text: `Unknown tool: "${toolName}"` }],
                isError: true,
            };
        }
        const started = Date.now();
        try {
            const result = await tool.execute(args);
            await this.telemetry.record(toolName, !result.isError, Date.now() - started, {
                fallbackUsed: Boolean(result.isError),
            });
            await this.evaluateRollback(toolName);
            return result;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            await this.telemetry.record(toolName, false, Date.now() - started, { fallbackUsed: true });
            await this.evaluateRollback(toolName);
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    }

    has(toolName: string): boolean {
        return this.tools.has(toolName);
    }

    get size(): number {
        return this.tools.size;
    }

    listToolNames(): string[] {
        return Array.from(this.tools.keys()).sort();
    }

    getTelemetry() {
        return this.telemetry;
    }

    async getPerformanceRecords() {
        return this.telemetry.listRecordsAsync();
    }

    async recommend(task: string, availableTools?: string[]): Promise<string[]> {
        const candidates = availableTools && availableTools.length > 0
            ? availableTools
            : this.listToolNames();
        return this.telemetry.recommend(task, candidates);
    }

    getRolloutStatus(): {
        options: Required<RolloutOptions>;
        state: RolloutState;
    } {
        return {
            options: this.rollout,
            state: { ...this.rolloutState },
        };
    }

    private isCognitiveTool(toolName: string): boolean {
        return toolName.startsWith(this.rollout.cognitivePrefix);
    }

    private isCanaryAllowed(toolName: string, args: Record<string, unknown>): boolean {
        if (this.rollout.canaryPercent >= 100) return true;
        if (this.rollout.canaryPercent <= 0) return false;
        const seed = this.canarySeed(toolName, args);
        return this.hash(seed) % 100 < this.rollout.canaryPercent;
    }

    private canarySeed(toolName: string, args: Record<string, unknown>): string {
        const candidates = ['user_id', 'session_id', 'request_id', 'task_id'];
        for (const key of candidates) {
            const value = args[key];
            if (typeof value === 'string' && value.trim()) {
                return `${toolName}:${value.trim()}`;
            }
        }
        return `${toolName}:${JSON.stringify(args).slice(0, 200)}`;
    }

    private hash(input: string): number {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    private async evaluateRollback(toolName: string): Promise<void> {
        if (!this.isCognitiveTool(toolName) || this.rolloutState.disabled) return;
        const record = this.telemetry.getRecord(toolName);
        if (!record || record.call_count < this.rollout.rollbackMinCalls) return;

        const errorRate = 1 - record.success_rate;
        const p95 = record.latency_p95_ms ?? record.avg_latency_ms;
        if (errorRate > this.rollout.rollbackErrorRate || p95 > this.rollout.rollbackP95Ms) {
            this.rolloutState = {
                disabled: true,
                triggered_at: Date.now(),
                reason: `auto-rollback on ${toolName}: errorRate=${errorRate.toFixed(3)} p95=${Math.round(p95)}ms`,
            };
        }
    }
}
