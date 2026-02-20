import { describe, expect, it } from 'vitest';
import { McpToolRegistry } from '../src/tools/McpToolRegistry';
import type { IMcpTool, McpToolResult } from '../src/tools/IMcpTool';

class CognitiveFailTool implements IMcpTool {
    readonly definition = {
        name: 'clawkit_fail_tool',
        description: 'Always fails for rollback test.',
        inputSchema: { type: 'object' as const, properties: {} },
    };

    async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
        return {
            content: [{ type: 'text', text: 'forced failure' }],
            isError: true,
        };
    }
}

class LegacyOkTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_legacy_ok',
        description: 'Legacy tool must keep working.',
        inputSchema: { type: 'object' as const, properties: {} },
    };

    async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
        return {
            content: [{ type: 'text', text: 'ok' }],
        };
    }
}

class TypedCountTool implements IMcpTool {
    readonly definition = {
        name: 'eidolon_typed_count',
        description: 'Requires numeric count argument.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                count: { type: 'number' },
            },
            required: ['count'],
        },
    };

    async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
        return {
            content: [{ type: 'text', text: 'ok' }],
        };
    }
}

class CognitiveCounterTool implements IMcpTool {
    public calls = 0;
    readonly definition = {
        name: 'clawkit_counter_tool',
        description: 'Mutating cognitive tool for shadow safety checks.',
        inputSchema: { type: 'object' as const, properties: {} },
    };

    async execute(_args: Record<string, unknown>): Promise<McpToolResult> {
        this.calls += 1;
        return {
            content: [{ type: 'text', text: 'counted' }],
        };
    }
}

class ReadOnlyShadowProbeTool implements IMcpTool {
    public sawShadow = false;
    readonly definition = {
        name: 'clawkit_shadow_probe',
        description: 'Read-only tool should execute in shadow mode.',
        inputSchema: { type: 'object' as const, properties: {} },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };

    async execute(args: Record<string, unknown>): Promise<McpToolResult> {
        this.sawShadow = args.__shadow === true;
        return {
            content: [{ type: 'text', text: 'ok' }],
        };
    }
}

describe('MCP rollout gates', () => {
    it('gates cognitive tools by canary percent without impacting legacy tools', async () => {
        const registry = new McpToolRegistry({
            canaryPercent: 0,
            rollbackMinCalls: 2,
        });
        registry.register(new CognitiveFailTool());
        registry.register(new LegacyOkTool());

        const cognitive = await registry.dispatch('clawkit_fail_tool', { user_id: 'u1' });
        const legacy = await registry.dispatch('eidolon_legacy_ok', {});

        expect(cognitive.isError).toBe(true);
        expect(cognitive.content[0]?.text.toLowerCase()).toContain('canary rollout');
        expect(legacy.isError).toBeFalsy();
    });

    it('auto-rolls back cognitive tools when error rate breaches threshold', async () => {
        const registry = new McpToolRegistry({
            canaryPercent: 100,
            rollbackErrorRate: 0.2,
            rollbackP95Ms: 999_999,
            rollbackMinCalls: 2,
        });
        registry.register(new CognitiveFailTool());
        registry.register(new LegacyOkTool());

        await registry.dispatch('clawkit_fail_tool', {});
        await registry.dispatch('clawkit_fail_tool', {});
        const afterRollback = await registry.dispatch('clawkit_fail_tool', {});
        const legacy = await registry.dispatch('eidolon_legacy_ok', {});
        const status = registry.getRolloutStatus();

        expect(afterRollback.isError).toBe(true);
        expect(afterRollback.content[0]?.text.toLowerCase()).toContain('rollout disabled');
        expect(status.state.disabled).toBe(true);
        expect(legacy.isError).toBeFalsy();
    });

    it('runs shadow execution for canary-gated cognitive tools when enabled', async () => {
        const registry = new McpToolRegistry({
            canaryPercent: 0,
            shadowModeEnabled: true,
            shadowSamplePercent: 100,
        });
        registry.register(new CognitiveFailTool());

        const response = await registry.dispatch('clawkit_fail_tool', { user_id: 'shadow-user' });
        expect(response.isError).toBe(true);
        expect(response.structuredContent).toMatchObject({
            code: 'canary_rollout_gated',
            shadow_mode_enabled: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
        const shadow = registry.getTelemetry().getRecord('shadow:clawkit_fail_tool');
        expect(shadow?.call_count).toBeGreaterThan(0);
    });

    it('skips non-read-only shadow execution to avoid side effects', async () => {
        const registry = new McpToolRegistry({
            canaryPercent: 0,
            shadowModeEnabled: true,
            shadowSamplePercent: 100,
        });
        const counterTool = new CognitiveCounterTool();
        registry.register(counterTool);

        const response = await registry.dispatch('clawkit_counter_tool', { user_id: 'shadow-safe' });
        expect(response.isError).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 10));

        const shadow = registry.getTelemetry().getRecord('shadow:clawkit_counter_tool');
        expect(shadow?.call_count).toBeGreaterThan(0);
        expect(counterTool.calls).toBe(0);
    });

    it('executes read-only tools in shadow mode with __shadow marker', async () => {
        const registry = new McpToolRegistry({
            canaryPercent: 0,
            shadowModeEnabled: true,
            shadowSamplePercent: 100,
        });
        const probe = new ReadOnlyShadowProbeTool();
        registry.register(probe);

        const response = await registry.dispatch('clawkit_shadow_probe', { user_id: 'shadow-probe' });
        expect(response.isError).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(probe.sawShadow).toBe(true);
    });

    it('rejects invalid payload shape before tool execution', async () => {
        const registry = new McpToolRegistry();
        registry.register(new TypedCountTool());

        const invalid = await registry.dispatch('eidolon_typed_count', { count: 'not-a-number' });
        expect(invalid.isError).toBe(true);
        expect(invalid.content[0]?.text).toContain('Invalid args');
        expect(invalid.structuredContent).toMatchObject({
            code: 'invalid_tool_arguments',
            tool: 'eidolon_typed_count',
        });
    });
});
