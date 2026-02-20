export interface NormalizedCallToolRequest {
    toolName: string;
    args: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function pickString(source: Record<string, unknown>, fields: string[]): string {
    for (const field of fields) {
        const raw = source[field];
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
    return '';
}

function pickArgs(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
    for (const field of fields) {
        const raw = source[field];
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return raw as Record<string, unknown>;
        }
    }
    return {};
}

export function normalizeCallToolRequest(request: unknown): NormalizedCallToolRequest {
    const requestObj = asObject(request);
    const params = asObject(requestObj.params);
    const toolName = pickString(params, ['name', 'tool']);
    if (!toolName) {
        throw new Error('CallTool request missing required tool name (expected params.name or params.tool).');
    }
    const args = pickArgs(params, ['arguments', 'input']);
    return { toolName, args };
}
