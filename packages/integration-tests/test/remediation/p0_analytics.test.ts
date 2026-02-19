
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsModule } from '../src/analytics';
import axios from 'axios';

// Mock types
const mockWalletClient: any = {
    getAddresses: vi.fn().mockResolvedValue(['0x123'])
};
const mockPublicClient: any = {};
const mockConfig: any = {};

vi.mock('axios');

describe('AnalyticsModule P0 Fixes', () => {
    let analytics: AnalyticsModule;

    beforeEach(() => {
        vi.clearAllMocks();
        analytics = new AnalyticsModule(mockWalletClient, mockPublicClient, mockConfig);
    });

    describe('fetchTokenPrices', () => {
        it('should return fallback prices when API fails', async () => {
            // Mock axios to reject
            vi.mocked(axios.get).mockRejectedValue(new Error('Network Error'));

            // Call fetchTokenPrices via private method access (using any cast)
            const prices = await (analytics as any).fetchTokenPrices();

            expect(prices).toBeDefined();
            expect(prices.BNB).toBe(600); // Expect fallback price
            expect(prices.USDT).toBe(1);
        });

        it('should return fallback prices on 429 rate limit', async () => {
            // Mock axios to reject with 429
            const error: any = new Error('Rate Limit');
            error.response = { status: 429 };
            vi.mocked(axios.get).mockRejectedValue(error);

            const prices = await (analytics as any).fetchTokenPrices();

            expect(prices).toBeDefined();
            expect(prices.BNB).toBe(600);
        });
    });
});
