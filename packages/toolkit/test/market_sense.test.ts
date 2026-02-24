import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriceService } from '../src/services/PriceService';
import { EidolonConfig } from '../src/types';

// Mock Gateway
const mockGateway = {
    get: vi.fn(),
    post: vi.fn(),
};

vi.mock('../src/utils/ApiGateway', () => ({
    getGateway: () => mockGateway,
}));

describe('Feature: Market Sense (PriceService)', () => {
    let service: PriceService;
    const mockConfig: EidolonConfig = {
        chainConfig: {} as any,
        walletConfig: {} as any,
        aiConfig: {} as any,
        privacyMode: 'standard', // Allow external calls
    };

    beforeEach(() => {
        vi.clearAllMocks();
        service = new PriceService(mockConfig);
        // Access private cache to clear it if needed, or just new instance
        (service as any).cache.clear();
    });

    it('should fetch BNB price from Pyth Network (Hermes)', async () => {
        // Mock Pyth response
        // Mock failures for CoinGecko, Binance, BinanceVision
        mockGateway.get
            .mockRejectedValueOnce(new Error('CoinGecko fail'))
            .mockRejectedValueOnce(new Error('Binance fail'))
            .mockRejectedValueOnce(new Error('BinanceVision fail'))
            // Pyth Success
            .mockResolvedValueOnce({
                parsed: [{
                    price: {
                        price: '30050000000',
                        expo: -8
                    }
                }]
            });

        const price = await service.getBNBPrice();

        expect(price).toBeCloseTo(300.5);
        expect(mockGateway.get).toHaveBeenCalledWith(expect.stringContaining('hermes.pyth.network'));
    });

    it('should fetch Token price by Address from DexScreener', async () => {
        const tokenAddr = '0x2222222222222222222222222222222222222222';

        // Mock DexScreener response
        mockGateway.get.mockResolvedValueOnce({
            pairs: [{
                priceUsd: '1.23'
            }]
        });

        const price = await service.getTokenPriceByAddress(tokenAddr);

        expect(price).toBe(1.23);
        expect(mockGateway.get).toHaveBeenCalledWith(expect.stringContaining('api.dexscreener.com'));
        expect(mockGateway.get).toHaveBeenCalledWith(expect.stringContaining(tokenAddr));
    });

    it('should fallback to 0 if DexScreener fails or returns no pairs', async () => {
        const tokenAddr = '0xDeadToken';

        // Mock DexScreener empty response
        mockGateway.get.mockResolvedValueOnce({
            pairs: []
        });

        const price = await service.getTokenPriceByAddress(tokenAddr);
        expect(price).toBe(0);
    });

    it('should respect Privacy Mode (Strict) and NOT call external APIs', async () => {
        const strictConfig = { ...mockConfig, privacyMode: 'strict' };
        const strictService = new PriceService(strictConfig as any);

        // Mock fetching BNB
        // In strict mode, getBNBPrice throws if no oracle/cache/fallback
        await expect(strictService.getBNBPrice()).rejects.toThrow();

        // DexScreener check? Logic in fetchPriceByAddress doesn't explicitly check privacyMode yet
        // TODO: Update PriceService to respect strict mode in fetchTokenPriceByAddress
    });
});
