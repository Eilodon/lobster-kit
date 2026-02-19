import { z } from 'zod';
import { IOracle, MarketContext, OracleInsight } from './IOracle';
import { DEFAULT_WEIGHTS, ReasoningWeights } from '../EidolonTypes';
import { withRetry } from '../../utils/Resilience';

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
            const response = await this.callLLM(prompt);
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

    private async callLLM(prompt: string): Promise<string> {
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
                            { role: 'system', content: 'You are a JSON-only API. Output raw JSON.' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 1000
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
}
