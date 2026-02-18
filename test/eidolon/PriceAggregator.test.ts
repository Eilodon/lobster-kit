import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriceAggregator } from '../../src/eidolon/sensors/PriceAggregator';
import * as types from '../../src/types';

// Verify module types to confirm where getTokenDecimals comes from.
// It is imported as: import { getTokenDecimals } from '../../types';

vi.mock('../../src/types', () => ({
    getTokenDecimals: vi.fn().mockReturnValue(18) // Assume 18 for test simplicity
}));

// Mock dependencies
const mockKit = {
    defi: {
        getRealQuote: vi.fn()
    }
};

const mockPyth = {
    getPrice: vi.fn()
};

const mockAxios = {
    get: vi.fn()
};

vi.mock('axios', () => ({
    default: {
        get: (...args: any[]) => mockAxios.get(...args)
    }
}));

describe('PriceAggregator', () => {
    let aggregator: PriceAggregator;

    beforeEach(() => {
        vi.clearAllMocks();
        aggregator = new PriceAggregator(mockKit as any, mockPyth as any);
    });

    it('should return MEDIAN price when all sources agree', async () => {
        // 1. Pyth = 600
        mockPyth.getPrice.mockResolvedValue(600);

        // 2. Binance = 602
        mockAxios.get.mockResolvedValue({ data: { price: "602" } });

        // 3. DEX = 601
        // 601 * 1e18 (since we mocked decimals to 18)
        mockKit.defi.getRealQuote.mockResolvedValue({
            amountOutMin: 601n * 1000000000000000000n
        });

        const price = await aggregator.getPrice('BNB');

        // Sorted: 600, 601, 602 -> Median is 601
        expect(price).toBe(601);
    });

    it('should REJECT outlier source (Divergence check)', async () => {
        const consoleSpy = vi.spyOn(console, 'warn');

        // 1. Pyth = 600 (Median)
        mockPyth.getPrice.mockResolvedValue(600);

        // 2. Binance = 600 (Median)
        mockAxios.get.mockResolvedValue({ data: { price: "600" } });

        // 3. DEX = 700 (Outlier > 5%)
        mockKit.defi.getRealQuote.mockResolvedValue({
            amountOutMin: 700n * 1000000000000000000n
        });

        const price = await aggregator.getPrice('BNB');

        expect(price).toBe(600);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('PRICE DIVERGENCE'));
    });

    it('should THROW if all sources fail', async () => {
        mockPyth.getPrice.mockRejectedValue(new Error('Pyth Down'));
        mockAxios.get.mockRejectedValue(new Error('API Down'));
        mockKit.defi.getRealQuote.mockRejectedValue(new Error('RPC Error'));

        await expect(aggregator.getPrice('BNB')).rejects.toThrow('CRITICAL: All price sources failed');
    });

    it('should handle partial failure (Pyth + Binance only)', async () => {
        mockPyth.getPrice.mockResolvedValue(600);
        mockAxios.get.mockResolvedValue({ data: { price: "602" } });
        mockKit.defi.getRealQuote.mockRejectedValue(new Error('RPC Error'));

        const price = await aggregator.getPrice('BNB');

        // With 2 sources (600, 602), median logic might average them or pick one.
        // Implementation: (600 + 602) / 2 = 601
        expect(price).toBe(601);
    });
});
