import { z } from 'zod';
import { IOracle, MarketContext, OracleGenerationOptions, OracleInsight } from './IOracle';
import { DEFAULT_WEIGHTS, ReasoningWeights } from '../eidolon/EidolonTypes';
import { withRetry } from '@clawkit/core';
import type { CriticResult, WorldState } from '@clawkit/core';

const BoundedNumber = z.number().finite().min(-50).max(50);
const OracleWeightsSchema = z.object({
    whaleFlow: z.object({ ACCUMULATING: BoundedNumber, DUMPING: BoundedNumber, NEUTRAL: BoundedNumber }),
    gasPrice: z.object({ LOW: BoundedNumber, MEDIUM: BoundedNumber, HIGH: BoundedNumber }),
    liquidityDepth: z.object({ THIN: BoundedNumber, DEEP: BoundedNumber }),
    sentiment: z.object({ EUPHORIC: BoundedNumber, FEAR: BoundedNumber, NEUTRAL: BoundedNumber }),
    priceAction: z.object({ PUMPING: BoundedNumber, DUMPING: BoundedNumber, RANGING: BoundedNumber })
});

const OracleResponseSchema = z.object({
    ...OracleWeightsSchema.shape,
    explanation: z.string().optional()
});

export interface DeepSeekConfig {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    timeout?: number;
    embeddingModel?: string;
    embeddingEndpoint?: string;
    embeddingDimensions?: number;
}

interface OracleApiError extends Error {
    response?: {
        status?: number;
    };
}

export class DeepSeekOracle implements IOracle {
    private config: DeepSeekConfig;
    private responseCache: { result: OracleInsight; expiry: number } | null = null;
    private static readonly CACHE_TTL_MS = 30_000; // 30s cache

    constructor(config: DeepSeekConfig) {
        this.config = {
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-chat',
            timeout: 5000,
            embeddingModel: 'text-embedding-3-small',
            embeddingEndpoint: '',
            embeddingDimensions: 64,
            ...config
        };
    }

    public getName(): string {
        return `DeepSeekOracle (${this.config.model})`;
    }

    public async analyze(context: MarketContext): Promise<OracleInsight> {
        // FIX: Response cache — avoid hammering LLM on rapid ticks
        if (this.responseCache && Date.now() < this.responseCache.expiry) {
            return this.responseCache.result;
        }

        try {
            const sanitized = this.sanitizeContext(context);
            const prompt = this.buildPrompt(sanitized);
            const response = await this.callLLM(prompt, {
                temperature: 0.1,
                maxTokens: 1000,
                jsonOnly: true,
            });
            const result = this.parseResponse(response);

            // Cache successful result
            this.responseCache = {
                result,
                expiry: Date.now() + DeepSeekOracle.CACHE_TTL_MS
            };
            return result;
        } catch (error) {
            console.error('🔮 Oracle Vision Failed:', error);
            console.warn('⚠️ Falling back to static instincts.');
            return {
                weights: DEFAULT_WEIGHTS,
                narrative: '🔮 Oracle offline. Using instinctive weights.'
            };
        }
    }

    public async embed<T extends object>(worldState: WorldState<T>): Promise<number[]> {
        const payload = JSON.stringify(worldState);
        try {
            const embedding = await this.callEmbeddingApi(payload);
            if (embedding.length > 0) return embedding;
        } catch {
            // ignore and fallback to deterministic embedding
        }
        return this.deterministicEmbedding(payload, this.config.embeddingDimensions ?? 64);
    }

    public async interpretConversation(
        messages: string,
        current_mode: number,
        user_profile?: unknown
    ): Promise<unknown> {
        if (!this.config.apiKey) {
            // Fallback mock
            return {
                user_expertise_signal: 'novice',
                user_intent: 'get_validation',
                user_frustration_level: 0.1,
                context_depth: 'sparse',
                thermo_state: [0.5, 0.5, 0.3, 0.5, 0.3]
            };
        }

        const prompt = `
        ANALYZE CONVERSATION STATE
        Current Mode: ${current_mode}
        User Profile: ${JSON.stringify(user_profile || {})}
        Messages:
        ${messages.slice(-2000)}

        Return JSON matching ConversationSensory:
        {
            "user_expertise_signal": "expert" | "intermediate" | "novice",
            "user_intent": "share_and_be_heard" | "get_validation" | "brainstorm_together" | "debug_problem" | "learn_something" | "vent",
            "user_frustration_level": number (0.0-1.0),
            "context_depth": "rich" | "sparse",
            "thermo_state": [engagement, trust, cognitive_load, rapport, momentum] (0.0-1.0)
        }
        `;

        const response = await this.callLLM(prompt, { jsonOnly: true });
        try {
            return JSON.parse(response);
        } catch {
            return {
                user_expertise_signal: 'novice',
                user_intent: 'share_and_be_heard',
                user_frustration_level: 0.1,
                context_depth: 'sparse',
                thermo_state: [0.5, 0.5, 0.5, 0.5, 0.5]
            };
        }
    }

    public async counterfactual(
        actual_pattern: string,
        hypothetical_pattern: string,
        context: unknown
    ): Promise<{ would_have_been_better: boolean; delta: number; reasoning: string }> {
        if (!this.config.apiKey) {
            return { would_have_been_better: false, delta: 0, reasoning: "Oracle offline" };
        }

        const prompt = `
        COUNTERFACTUAL ANALYSIS
        Context: ${JSON.stringify(context)}
        Actual Action: ${actual_pattern}
        Hypothetical Action: ${hypothetical_pattern}

        Did the hypothetical action have a better expected outcome?
        Return JSON:
        {
            "would_have_been_better": boolean,
            "delta": number (-1.0 to 1.0, positive means better),
            "reasoning": "string"
        }
        `;

        const response = await this.callLLM(prompt, { jsonOnly: true });
        try {
            return JSON.parse(response);
        } catch {
            return { would_have_been_better: false, delta: 0, reasoning: "Oracle JSON Parse Error" };
        }
    }

    public async refine(draft: string, critique: CriticResult): Promise<string> {
        if (!this.config.apiKey) {
            return this.refineDeterministic(draft, critique);
        }

        try {
            const prompt = [
                'You are a response refiner.',
                `Draft: ${draft}`,
                `Issues: ${critique.issues.join('; ')}`,
                `Suggestions: ${critique.suggestions.join('; ')}`,
                'Return only improved final response text.'
            ].join('\n');
            const refined = await this.callLLM(prompt);
            const clean = refined.replace(/```[\s\S]*?```/g, '').trim();
            if (!clean) return this.refineDeterministic(draft, critique);
            return clean;
        } catch {
            return this.refineDeterministic(draft, critique);
        }
    }

    public async generate(prompt: string, options: OracleGenerationOptions = {}): Promise<string> {
        if (!this.config.apiKey) {
            return this.generateDeterministic(prompt, options);
        }

        try {
            const raw = await this.callLLM(prompt, {
                temperature: options.temperature ?? 0.2,
                maxTokens: options.maxTokens ?? 1200,
                jsonOnly: options.json ?? false,
            });
            if (!raw || !raw.trim()) {
                return this.generateDeterministic(prompt, options);
            }
            if (options.json) {
                const normalized = this.extractFirstJson(raw);
                return normalized ?? this.generateDeterministic(prompt, options);
            }
            return raw.trim();
        } catch {
            return this.generateDeterministic(prompt, options);
        }
    }

    private buildPrompt(context: MarketContext): string {
        return `
You are Eidolon-V, a God-tier Quantitative AI Agent for BNB Chain.
Your job is to adjust the internal 'Reasoning Weights' of the trading engine based on the current market context.

CURRENT CONTEXT:
- Market State: ${JSON.stringify(context.marketState, null, 2)}
- News/Macro: ${context.newsHeadlines?.join(', ') || 'None'}
- Social Sentiment: ${context.twitterSentiment || 'Unknown'}

TASK:
Output a JSON object representing the 'ReasoningWeights' for this specific moment.
If the market is volatile, punish risk. If 'Banana Zone', boost momentum.

Expected JSON Structure (matches this exact schema, values between -50 and +50):
{
    "whaleFlow": { "ACCUMULATING": number, "DUMPING": number, "NEUTRAL": number },
    "gasPrice": { "LOW": number, "MEDIUM": number, "HIGH": number },
    "liquidityDepth": { "THIN": number, "DEEP": number },
    "sentiment": { "EUPHORIC": number, "FEAR": number, "NEUTRAL": number },
    "priceAction": { "PUMPING": number, "DUMPING": number, "RANGING": number },
    "explanation": "One sentence explaining WHY you set these weights."
}

Provide ONLY raw JSON. No markdown formatting.
`;
    }

    private async callLLM(
        prompt: string,
        options: {
            temperature?: number;
            maxTokens?: number;
            jsonOnly?: boolean;
        } = {}
    ): Promise<string> {
        if (!this.config.apiKey) {
            throw new Error('No API Key provided for DeepSeekOracle');
        }

        // FIX: Wrap in withRetry for 429/5xx resilience
        return withRetry(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

            try {
                const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.apiKey}`
                    },
                    body: JSON.stringify({
                        model: this.config.model,
                        messages: [
                            {
                                role: 'system',
                                content: options.jsonOnly
                                    ? 'You are a JSON-only API. Output raw JSON.'
                                    : 'You are a precise assistant. Follow formatting instructions exactly.'
                            },
                            { role: 'user', content: prompt }
                        ],
                        temperature: options.temperature ?? 0.1,
                        max_tokens: options.maxTokens ?? 1000
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    const err: OracleApiError = new Error(`API Error: ${response.status} ${response.statusText}`);
                    err.response = { status: response.status };
                    throw err;
                }

                const data = await response.json();
                return data.choices?.[0]?.message?.content || '{}';
            } finally {
                clearTimeout(timeoutId);
            }
        }, {
            maxAttempts: 3,
            baseDelay: 1000,
            shouldRetry: (e: unknown) => {
                const status = (typeof e === 'object' && e !== null && 'response' in e)
                    ? (e as OracleApiError).response?.status
                    : undefined;
                // Retry on 429 (rate limit) and 5xx; abort on 4xx auth errors
                return !status || status === 429 || status >= 500;
            }
        });
    }

    private async callEmbeddingApi(input: string): Promise<number[]> {
        if (!this.config.apiKey) {
            throw new Error('No API key configured for embedding calls.');
        }

        const endpoint = this.config.embeddingEndpoint?.trim()
            || `${this.config.baseUrl}/embeddings`;
        const model = this.config.embeddingModel || 'text-embedding-3-small';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                body: JSON.stringify({
                    model,
                    input
                }),
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error(`Embedding API error: ${response.status}`);
            }
            const data = await response.json();
            const embedding = data?.data?.[0]?.embedding;
            if (!Array.isArray(embedding)) {
                throw new Error('Embedding API returned invalid payload.');
            }
            return embedding.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n));
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private parseResponse(raw: string): OracleInsight {
        try {
            // Clean markdown code blocks if present
            const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
            // Basic JSON parse first
            const json = JSON.parse(clean);

            // Zod Validation
            const parsed = OracleResponseSchema.parse(json);

            // Construct ReasoningWeights safely
            const weights: ReasoningWeights = {
                whaleFlow: parsed.whaleFlow,
                gasPrice: parsed.gasPrice,
                liquidityDepth: parsed.liquidityDepth,
                sentiment: parsed.sentiment,
                priceAction: parsed.priceAction
            };

            return {
                weights,
                narrative: parsed.explanation || 'No explanation provided.'
            };
        } catch (e) {
            console.error('Failed to parse Oracle response:', raw, e);
            throw e;
        }
    }

    /**
     * FIX: Sanitize context to prevent prompt injection and privacy leaks.
     * Strips raw user content, limits headline length, removes URLs/scripts.
     */
    private sanitizeContext(context: MarketContext): MarketContext {
        const safeHeadlines = (context.newsHeadlines ?? [])
            .slice(0, 5)
            .map((headline) => this.sanitizeForPrompt(headline))
            .filter((headline) => headline.length > 0);

        const safeSentiment = this.sanitizeForPrompt(context.twitterSentiment);

        return {
            ...context,
            newsHeadlines: safeHeadlines.length > 0 ? safeHeadlines : undefined,
            twitterSentiment: safeSentiment || 'Unknown',
        };
    }

    private sanitizeForPrompt(input: string | undefined, maxLength: number = 200): string {
        if (!input) return '';

        let text = input
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/\{\{.*?\}\}/g, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/https?:\/\/\S+/g, '[URL]');

        const injectionPatterns = [
            /\bignore\b/gi,
            /\bdisregard\b/gi,
            /\boverride\b/gi,
            /\bprevious instructions?\b/gi,
            /\bsystem prompt\b/gi,
            /\bdeveloper message\b/gi
        ];
        for (const pattern of injectionPatterns) {
            text = text.replace(pattern, '[FILTERED]');
        }

        text = text
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLength);

        return text;
    }

    private deterministicEmbedding(input: string, dimensions: number): number[] {
        const dim = Math.max(8, dimensions);
        const out = new Array(dim).fill(0);
        const normalized = input.toLowerCase();
        for (let i = 0; i < normalized.length; i++) {
            const charCode = normalized.charCodeAt(i);
            const bucket = (charCode + i * 31) % dim;
            out[bucket] += (charCode % 13) / 13;
        }
        const norm = Math.sqrt(out.reduce((acc, v) => acc + v * v, 0));
        if (norm <= 0) return out;
        return out.map((v) => v / norm);
    }

    private refineDeterministic(draft: string, critique: CriticResult): string {
        if (critique.suggestions.length === 0) return draft;
        const guidance = critique.suggestions.slice(0, 3).map((s, idx) => `${idx + 1}. ${s}`).join('\n');
        return `${draft}\n\nRefinement checklist:\n${guidance}`.trim();
    }

    private generateDeterministic(prompt: string, options: OracleGenerationOptions): string {
        if (options.json) return '{}';
        const compact = prompt.replace(/\s+/g, ' ').trim();
        return compact.slice(0, 600);
    }

    private extractFirstJson(raw: string): string | null {
        const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        if ((clean.startsWith('{') && clean.endsWith('}')) || (clean.startsWith('[') && clean.endsWith(']'))) {
            return clean;
        }

        const firstBrace = clean.indexOf('{');
        const lastBrace = clean.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return clean.slice(firstBrace, lastBrace + 1);
        }

        const firstBracket = clean.indexOf('[');
        const lastBracket = clean.lastIndexOf(']');
        if (firstBracket >= 0 && lastBracket > firstBracket) {
            return clean.slice(firstBracket, lastBracket + 1);
        }

        return null;
    }
}
