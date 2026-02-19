import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriceService, getPriceService } from '../src/services/PriceService';
import { getGateway } from '../src/utils/ApiGateway';

vi.mock('../src/utils/ApiGateway', () => ({
    getGateway: vi.fn(),
}));

const makeConfig = (mode?: string, fallbackBNBPrice?: number) => ({
    chainConfig: { contracts: {}, tokens: {} },
    privacyMode: mode,
    fallbackBNBPrice,
} as any);

describe('PriceService', () => {
    let gatewayGet: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        gatewayGet = vi.fn();
        vi.mocked(getGateway).mockReturnValue({ get: gatewayGet } as any);
    });

    it('should return a singleton per config via getPriceService()', () => {
        const config = makeConfig();
        expect(getPriceService(config)).toBe(getPriceService(config));
    });

    it('should use oracle when injected, without calling network', async () => {
        const svc = new PriceService(makeConfig());
        svc.setOracle({ fetchTokenPrices: vi.fn().mockResolvedValue({ BNB: 750 }) });
        const price = await svc.getBNBPrice();
        expect(price).toBe(750);
    });

    it('should use TTL cache on second call', async () => {
        const svc = new PriceService(makeConfig());
        const fetchFn = vi.fn().mockResolvedValue({ BNB: 800 });
        svc.setOracle({ fetchTokenPrices: fetchFn });

        await svc.getBNBPrice(); // First call populates cache
        await svc.getBNBPrice(); // Should hit cache

        expect(fetchFn).toHaveBeenCalledTimes(1); // Oracle only called once
    });

    it('should throw in strict mode without oracle', async () => {
        const svc = new PriceService(makeConfig('strict'));
        await expect(svc.getBNBPrice()).rejects.toThrow('strict privacy mode requires an internal oracle');
    });

    it('should use stale cache in strict mode when oracle is unavailable', async () => {
        const svc = new PriceService(makeConfig('strict'));
        (svc as any).cache.set('BNB', {
            value: 701.23,
            expiresAt: Date.now() - 1000,
        });

        const price = await svc.getBNBPrice();
        expect(price).toBe(701.23);
        expect(gatewayGet).not.toHaveBeenCalled();
    });

    it('should ignore invalid oracle price and continue with external fallback', async () => {
        const svc = new PriceService(makeConfig());
        svc.setOracle({ fetchTokenPrices: vi.fn().mockResolvedValue({ BNB: Number.NaN }) });
        gatewayGet.mockResolvedValueOnce({ binancecoin: { usd: 612.34 } });

        const price = await svc.getBNBPrice();
        expect(price).toBe(612.34);
        expect(gatewayGet).toHaveBeenCalledTimes(1);
    });

    it('should use configured fallbackBNBPrice when all live sources fail', async () => {
        const svc = new PriceService(makeConfig(undefined, 645.5));
        gatewayGet.mockRejectedValue(new Error('source down'));

        const price = await svc.getBNBPrice();
        expect(price).toBe(645.5);
        expect(gatewayGet).toHaveBeenCalledTimes(3);
    });

    it('should throw when every source returns unusable data and no fallback is configured', async () => {
        const svc = new PriceService(makeConfig());
        gatewayGet
            .mockResolvedValueOnce({ binancecoin: { usd: 0 } })
            .mockResolvedValueOnce({ price: 'NaN' })
            .mockResolvedValueOnce({ price: '-1' });

        await expect(svc.getBNBPrice()).rejects.toThrow('All BNB price sources failed');
    });

    it('should return partial results in strict mode with oracle for single symbols', async () => {
        const svc = new PriceService(makeConfig('strict'));
        svc.setOracle({ fetchTokenPrices: vi.fn().mockResolvedValue({ USDT: 1.0, CAKE: 2.5 }) });
        const prices = await svc.fetchMultiplePrices(['USDT', 'CAKE']);
        expect(prices['USDT']).toBe(1.0);
        expect(prices['CAKE']).toBe(2.5);
    });
});
