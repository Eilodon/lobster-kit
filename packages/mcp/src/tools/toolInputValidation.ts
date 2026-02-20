import type { McpToolInputSchema } from './IMcpTool';

type ValidationError = {
    field: string;
    expected: string;
    received: string;
};

export type ToolInputValidationResult = {
    ok: true;
} | {
    ok: false;
    errors: ValidationError[];
};

function typeOfValue(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTypeCompatible(expected: string, value: unknown): boolean {
    switch (expected) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'object':
            return isObjectLike(value);
        default:
            return true;
    }
}

export function validateArgsAgainstSchema(
    schema: McpToolInputSchema,
    args: Record<string, unknown>
): ToolInputValidationResult {
    if (schema.type !== 'object') {
        return {
            ok: false,
            errors: [{
                field: '$',
                expected: 'object schema',
                received: String(schema.type),
            }],
        };
    }

    if (!isObjectLike(args)) {
        return {
            ok: false,
            errors: [{
                field: '$',
                expected: 'object',
                received: typeOfValue(args),
            }],
        };
    }

    const errors: ValidationError[] = [];
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
        if (args[key] === undefined || args[key] === null) {
            errors.push({
                field: key,
                expected: 'required',
                received: 'missing',
            });
        }
    }

    const properties = schema.properties ?? {};
    for (const [key, value] of Object.entries(args)) {
        const def = properties[key];
        if (!def || typeof def.type !== 'string') continue;

        if (!isTypeCompatible(def.type, value)) {
            errors.push({
                field: key,
                expected: def.type,
                received: typeOfValue(value),
            });
        }
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true };
}
