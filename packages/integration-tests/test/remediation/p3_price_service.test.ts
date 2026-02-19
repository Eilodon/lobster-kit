import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriceService, getPriceService } from '../src/services/PriceService';

const makeConfig = (mode?: string) => ({ chainConfig: { contracts: {}, tokens: {} }, privacyMode: mode } as any);

describe('PriceService', () => {

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

    it('should return partial results in strict mode with oracle for single symbols', async () => {
        const svc = new PriceService(makeConfig('strict'));
        svc.setOracle({ fetchTokenPrices: vi.fn().mockResolvedValue({ USDT: 1.0, CAKE: 2.5 }) });
        const prices = await svc.fetchMultiplePrices(['USDT', 'CAKE']);
        expect(prices['USDT']).toBe(1.0);
        expect(prices['CAKE']).toBe(2.5);
    });
});
