import { IOracle, MarketContext, OracleInsight } from './IOracle';
import { DEFAULT_WEIGHTS, ReasoningWeights } from '../EidolonTypes';

export interface DeepSeekConfig {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    timeout?: number;
}

export class DeepSeekOracle implements IOracle {
    private config: DeepSeekConfig;

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
        try {
            const prompt = this.buildPrompt(context);
            const response = await this.callLLM(prompt);
            return this.parseResponse(response);
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
                    temperature: 0.1, // Low temp for deterministic logic
                    max_tokens: 1000
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.choices?.[0]?.message?.content || '{}';
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private parseResponse(raw: string): OracleInsight {
        try {
            // Clean markdown code blocks if present
            const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
            const json = JSON.parse(clean);

            // Basic validation (ensure structure exists)
            if (!json.whaleFlow || !json.priceAction) {
                throw new Error('Invalid JSON structure from Oracle');
            }

            return {
                weights: json as ReasoningWeights,
                narrative: json.explanation || 'No explanation provided.'
            };
        } catch (e) {
            console.error('Failed to parse Oracle response:', raw);
            throw e;
        }
    }
}
