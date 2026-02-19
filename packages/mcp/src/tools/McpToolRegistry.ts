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

export class McpToolRegistry {
    private readonly tools = new Map<string, IMcpTool>();

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
        const tool = this.tools.get(toolName);
        if (!tool) {
            return {
                content: [{ type: 'text', text: `Unknown tool: "${toolName}"` }],
                isError: true,
            };
        }
        try {
            return await tool.execute(args);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
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
}
