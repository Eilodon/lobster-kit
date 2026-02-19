/**
 * 🔌 IMcpTool — The Universal MCP Tool Interface
 *
 * Every tool exposed through the MCP server implements this interface.
 * The McpToolRegistry uses it to dispatch tool calls dynamically,
 * replacing the monolithic switch-case in mcp-server.ts.
 *
 * Benefits:
 * - Adding a new tool = adding one class (no edits to mcp-server.ts)
 * - Tools are independently testable
 * - Tool definitions (schema) are co-located with their execution
 */

export interface McpToolInputSchema {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
}

/** Describes a tool to MCP clients (what to show in ListTools). */
export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: McpToolInputSchema;
}

/** The raw output returned to the MCP caller. */
export interface McpToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

/**
 * Every MCP tool implements this interface.
 * Tools self-describe via `definition` and self-execute via `execute`.
 */
export interface IMcpTool {
    /** Static metadata — used by ListTools and registry lookup. */
    readonly definition: McpToolDefinition;

    /**
     * Execute this tool.
     * @param args - Validated arguments from the MCP request.
     * @returns McpToolResult to send back to the MCP client.
     */
    execute(args: Record<string, unknown>): Promise<McpToolResult>;
}
