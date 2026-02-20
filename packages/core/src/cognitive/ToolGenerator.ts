import type { IOracle } from '../ai/IOracle';
import type { WorldState } from '../types/WorldState';

type OracleGenerator = Pick<IOracle, 'generate'>;

export interface GeneratedToolSpec {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, { type: string; description?: string }>;
        required?: string[];
    };
    handlerHint: string;
    capabilities: string[];
    sandbox: {
        execution: 'sandbox';
        side_effects: false;
        allowed_domains: string[];
    };
}

function extractJsonPayload(raw: string): string | null {
    const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    if ((clean.startsWith('{') && clean.endsWith('}')) || (clean.startsWith('[') && clean.endsWith(']'))) {
        return clean;
    }
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return clean.slice(firstBrace, lastBrace + 1);
    }
    return null;
}

function parseObject(raw: string): Record<string, unknown> | null {
    const payload = extractJsonPayload(raw);
    if (!payload) return null;
    try {
        const parsed = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function safeName(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
}

export class ToolGenerator {
    private static readonly MAX_NEED_LENGTH = 280;
    private static readonly NAME_PATTERN = /^clawkit_gen_[a-z0-9_]{3,64}$/;
    private static readonly SAFE_CAPABILITIES = new Set([
        'read_only',
        'text_processing',
        'summarization',
        'classification',
        'transformation',
        'retrieval',
    ]);
    private static readonly BLOCKED_PATTERNS: RegExp[] = [
        /\b(exec|execute|spawn|fork|subprocess|shell|bash|zsh|powershell)\b/i,
        /\b(rm\s+-rf|delete file|write file|chmod|chown|sudo)\b/i,
        /\b(http request|fetch url|curl|wget|socket|port scan)\b/i,
        /\b(private key|secret|token leak|credential)\b/i,
        /\b(ignore previous instructions?|override system prompt|developer message)\b/i,
        /\b(prompt injection|tool escape|bypass sandbox)\b/i,
    ];

    constructor(private readonly oracle?: OracleGenerator) { }

    public async generate<T extends object>(
        need: string,
        context: WorldState<T>
    ): Promise<GeneratedToolSpec | null> {
        const normalizedNeed = this.normalizeNeed(need);
        if (!normalizedNeed || !this.isNeedSafe(normalizedNeed)) return null;

        const slug = normalizedNeed
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 48) || 'generated_tool';

        const oracleSpec = await this.generateWithOracle(normalizedNeed, context, slug);
        if (oracleSpec) {
            this.validateSpec(oracleSpec);
            return oracleSpec;
        }

        const spec = this.fallbackSpec(need, context, slug);
        this.validateSpec(spec);
        return spec;
    }

    public validateSpec(spec: GeneratedToolSpec): void {
        if (!ToolGenerator.NAME_PATTERN.test(spec.name)) {
            throw new Error('Generated tool name rejected by sandbox policy.');
        }
        if (!spec.description || spec.description.length > 300) {
            throw new Error('Generated tool description is invalid.');
        }
        if (spec.inputSchema.type !== 'object') {
            throw new Error('Generated tool input schema must be object.');
        }
        const supportedTypes = new Set(['string', 'number', 'boolean']);
        for (const property of Object.values(spec.inputSchema.properties)) {
            if (!supportedTypes.has(property.type)) {
                throw new Error(`Unsupported generated input type: ${property.type}`);
            }
        }
        if (spec.sandbox.execution !== 'sandbox' || spec.sandbox.side_effects !== false) {
            throw new Error('Generated tool must run in sandbox read-only mode.');
        }
        if (!Array.isArray(spec.capabilities) || !spec.capabilities.includes('read_only')) {
            throw new Error('Generated tool must include read_only capability.');
        }
    }

    public async withFallback<T>(
        primary: string,
        fallbacks: string[],
        args: Record<string, unknown>,
        execute: (toolName: string, execArgs: Record<string, unknown>) => Promise<T>
    ): Promise<T> {
        const candidates = [primary, ...fallbacks];
        let lastError: unknown = null;
        for (const candidate of candidates) {
            try {
                return await execute(candidate, args);
            } catch (error) {
                lastError = error;
            }
        }
        if (lastError instanceof Error) throw lastError;
        throw new Error('All fallback tools failed.');
    }

    private async generateWithOracle<T extends object>(
        normalizedNeed: string,
        context: WorldState<T>,
        fallbackSlug: string
    ): Promise<GeneratedToolSpec | null> {
        if (!this.oracle?.generate) return null;
        const prompt = [
            'Design a read-only MCP tool spec for this need.',
            'Return JSON ONLY with keys:',
            'name, description, inputSchema, handlerHint, capabilities, allowed_domains.',
            'Rules:',
            '- name must start with clawkit_gen_',
            '- inputSchema.type must be object',
            '- property types allowed: string|number|boolean',
            '- no side effects, no network, no file writes',
            `need=${normalizedNeed}`,
            `context_domain=${context.domain}`,
            `context_meta=${JSON.stringify(context.meta ?? {})}`,
        ].join('\n');

        try {
            const raw = await this.oracle.generate(prompt, { json: true, temperature: 0.2, maxTokens: 900 });
            const parsed = parseObject(raw);
            if (!parsed) return null;
            return this.normalizeOracleSpec(parsed, context.domain, fallbackSlug);
        } catch {
            return null;
        }
    }

    private normalizeOracleSpec(
        parsed: Record<string, unknown>,
        domain: string,
        fallbackSlug: string
    ): GeneratedToolSpec {
        const rawName = typeof parsed.name === 'string' ? parsed.name : `clawkit_gen_${fallbackSlug}`;
        const normalizedName = safeName(rawName.startsWith('clawkit_gen_') ? rawName : `clawkit_gen_${rawName}`);
        const name = normalizedName.startsWith('clawkit_gen_')
            ? normalizedName
            : `clawkit_gen_${fallbackSlug}`;

        const rawDescription = typeof parsed.description === 'string'
            ? parsed.description
            : `Generated read-only helper for ${fallbackSlug}`;
        const description = rawDescription.trim().slice(0, 300);

        const properties: Record<string, { type: string; description?: string }> = {};
        const rawInputSchema = parsed.inputSchema && typeof parsed.inputSchema === 'object'
            ? parsed.inputSchema as Record<string, unknown>
            : {};
        const rawProps = rawInputSchema.properties && typeof rawInputSchema.properties === 'object'
            ? rawInputSchema.properties as Record<string, unknown>
            : {};

        let added = 0;
        for (const [key, value] of Object.entries(rawProps)) {
            if (added >= 6) break;
            const safeKey = safeName(key);
            if (!safeKey) continue;
            if (!value || typeof value !== 'object') continue;
            const rawType = String((value as Record<string, unknown>).type ?? '');
            if (!['string', 'number', 'boolean'].includes(rawType)) continue;
            const rawDesc = (value as Record<string, unknown>).description;
            properties[safeKey] = {
                type: rawType,
                description: typeof rawDesc === 'string' ? rawDesc.slice(0, 180) : undefined,
            };
            added++;
        }

        if (Object.keys(properties).length === 0) {
            properties.payload = { type: 'string', description: 'Task payload for generated tool.' };
        }
        const propertyKeys = Object.keys(properties);

        const rawRequired = Array.isArray(rawInputSchema.required)
            ? rawInputSchema.required.map((entry) => safeName(String(entry))).filter((entry) => entry in properties)
            : [];
        const required = rawRequired.length > 0
            ? rawRequired.slice(0, 6)
            : [propertyKeys[0]];

        const rawCapabilities = Array.isArray(parsed.capabilities)
            ? parsed.capabilities.map((entry) => safeName(String(entry)))
            : [];
        const capabilities = Array.from(new Set([
            'read_only',
            ...rawCapabilities.filter((entry) => ToolGenerator.SAFE_CAPABILITIES.has(entry)),
            'text_processing',
        ]));

        const rawAllowedDomains = Array.isArray(parsed.allowed_domains)
            ? parsed.allowed_domains.map((entry) => String(entry).trim()).filter(Boolean)
            : [];
        const allowedDomains = Array.from(new Set([
            domain,
            'general',
            ...rawAllowedDomains.slice(0, 3),
        ]));

        const rawHint = typeof parsed.handlerHint === 'string'
            ? parsed.handlerHint
            : `Use domain=${domain} with safe read-only behavior by default.`;
        const handlerHint = rawHint.slice(0, 280);

        return {
            name,
            description,
            inputSchema: {
                type: 'object',
                properties,
                required,
            },
            handlerHint,
            capabilities,
            sandbox: {
                execution: 'sandbox',
                side_effects: false,
                allowed_domains: allowedDomains,
            },
        };
    }

    private fallbackSpec<T extends object>(
        need: string,
        context: WorldState<T>,
        slug: string
    ): GeneratedToolSpec {
        return {
            name: `clawkit_gen_${slug}`,
            description: `Generated read-only helper for need: ${need.trim().slice(0, 180)}`,
            inputSchema: {
                type: 'object',
                properties: {
                    payload: { type: 'string', description: 'Task payload for generated tool.' },
                },
                required: ['payload'],
            },
            handlerHint: `Use domain=${context.domain} with safe read-only behavior by default.`,
            capabilities: ['read_only', 'text_processing'],
            sandbox: {
                execution: 'sandbox',
                side_effects: false,
                allowed_domains: [context.domain, 'general'].filter(Boolean),
            },
        };
    }

    private normalizeNeed(need: string): string {
        return need.trim().toLowerCase().slice(0, ToolGenerator.MAX_NEED_LENGTH);
    }

    private isNeedSafe(normalizedNeed: string): boolean {
        if (!normalizedNeed) return false;
        return !ToolGenerator.BLOCKED_PATTERNS.some((pattern) => pattern.test(normalizedNeed));
    }
}
