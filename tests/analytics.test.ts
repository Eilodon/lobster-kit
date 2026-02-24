import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsModule } from '../src/analytics';
import { EidolonConfig } from '../src/types';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock viem clients
const mockWalletClient = {
    getAddresses: vi.fn().mockResolvedValue(['0xuser'])
};

const mockPublicClient = {
    readContract: vi.fn(),
    getBalance: vi.fn().mockResolvedValue(0n)
};

describe('AnalyticsModule', () => {
    let analytics: AnalyticsModule;
    const config: EidolonConfig = {};

    beforeEach(() => {
        analytics = new AnalyticsModule(mockWalletClient as any, mockPublicClient as any, config);
        vi.clearAllMocks();
    });

    describe('Real APY Fetching', () => {
        it('should fetch Venus APY correctly', async () => {
            // Mock Venus API response
            (axios.get as any).mockResolvedValue({
                data: {
                    markets: [
                        { underlyingSymbol: 'BNB', supplyApy: '5.5' },
                        { underlyingSymbol: 'USDT', supplyApy: '12.2' }
                    ]
                }
            });

            const apy = await analytics.calculateAPY('Venus', 'BNB');
            expect(apy).toBe(5.5);

            const usdtApy = await analytics.calculateAPY('Venus', 'USDT');
            expect(usdtApy).toBe(12.2);
        });

        it('should fetch PancakeSwap APY correctly', async () => {
            // Mock Pancake API response
            (axios.get as any).mockResolvedValue({
                data: [
                    { lpSymbol: 'BNB-USDT LP', apr: 25.4 },
                    { lpSymbol: 'CAKE-BNB LP', apr: 40.1 }
                ]
            });

            const apy = await analytics.calculateAPY('PancakeSwap', 'BNB-USDT LP');
            expect(apy).toBe(25.4);
        });

        it('should handle API errors gracefully', async () => {
            (axios.get as any).mockRejectedValue(new Error('API Error'));

            const apy = await analytics.calculateAPY('Venus', 'BNB');
            expect(apy).toBe(0);
        });
    });
});
