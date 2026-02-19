import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepSeekOracle } from '../src/eidolon/ai/DeepSeekOracle';
import { MarketContext } from '../src/eidolon/ai/IOracle';
import { ReasoningWeights } from '../src/eidolon/EidolonTypes';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('DeepSeekOracle', () => {
    let oracle: DeepSeekOracle;
    const mockConfig = { apiKey: 'test-key' };

    beforeEach(() => {
        vi.resetAllMocks();
        oracle = new DeepSeekOracle(mockConfig);
    });

    const mockContext: MarketContext = {
        marketState: {
            gasPrice: 'LOW',
            whaleFlow: 'ACCUMULATING',
            sentiment: 'NEUTRAL',
            liquidityDepth: 'DEEP',
            priceAction: 'RANGING'
        },
        newsHeadlines: ['BNB hits ATH', 'Bitcoin ETF approved']
    };

    const mockResponseWeights: ReasoningWeights = {
        whaleFlow: { ACCUMULATING: 30, DUMPING: -30, NEUTRAL: 0 },
        gasPrice: { LOW: 10, MEDIUM: 0, HIGH: -10 },
        liquidityDepth: { THIN: -20, DEEP: 10 },
        sentiment: { EUPHORIC: -10, FEAR: 10, NEUTRAL: 0 },
        priceAction: { PUMPING: 20, DUMPING: -20, RANGING: 0 }
    };

    it('should construct correct prompt and parse JSON response', async () => {
        // Mock successful API response
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{
                    message: {
                        content: JSON.stringify(mockResponseWeights)
                    }
                }]
            })
        });

        const insight = await oracle.analyze(mockContext);

        // Verify result
        expect(insight.weights.whaleFlow.ACCUMULATING).toBe(30);
        expect(typeof insight.narrative).toBe('string');

        // Verify fetch call
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[0]).toContain('https://api.deepseek.com/v1');

        const body = JSON.parse(callArgs[1].body);
        expect(body.messages[1].content).toContain('BNB hits ATH');
    });

    it('should fallback to default weights on API failure', async () => {
        // Mock failure
        mockFetch.mockRejectedValue(new Error('Network Error'));

        // Silence the console.error/warn for this test
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });

        const insight = await oracle.analyze(mockContext);

        // Should be default structural weights (we check a key existence)
        expect(insight.weights.whaleFlow).toBeDefined();
        expect(insight.narrative).toContain('Oracle offline');

        consoleSpy.mockRestore();
    });
});
