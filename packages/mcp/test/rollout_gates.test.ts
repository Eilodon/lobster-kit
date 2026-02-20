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
});
