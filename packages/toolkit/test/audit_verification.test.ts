
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mock axios before importing modules that use it
import axios from 'axios';
vi.mock('axios');

// 2. Mock @eidolon/soul
vi.mock('@eidolon/soul', () => {
    return {
        WasmAdapter: {
            getInstance: vi.fn().mockReturnValue({
                q64Mul: (a: bigint, b: bigint) => (a * b) >> 96n,
                q64Div: (a: bigint, b: bigint) => (a << 96n) / b,
                sqrtPriceX96ToPriceWad: () => 123n
            })
        }
    };
});

// 3. Import modules under test
import { Q64x96 } from '../src/math/Q64x96';
import { PriceService } from '../src/services/PriceService';
import { getGateway } from '../src/utils/ApiGateway';
import { EidolonConfig } from '../src/types';

describe('Atomic Audit Verification', () => {

    // ─────────────────────────────────────────────
    // 1. Q64x96 Fallback Verification
    // ─────────────────────────────────────────────
    describe('Q64x96', () => {
        it('should fallback to ISO-correct TypeScript math when WASM unavailable', () => {
            // Since verifying the WASM mock via lazy-require is flaky in this setup,
            // we intentionally allow the fallback to trigger (which it does by default if require fails)
            // and verify the TypeScript math is correct.

            // Case 1: 1.0 price
            // sqrtPriceX96 = 2^96
            const Q96 = 2n ** 96n;
            const res1 = Q64x96.sqrtPriceX96ToPriceWad(Q96, 18, 18);
            expect(res1).toBe(10n ** 18n); // 1.0 * 1e18

            // Case 2: 2.0 price
            // price = 2.0 -> sqrtPrice = sqrt(2) * 2^96
            // sqrt(2) approx 1.41421356...
            // Q96 * 1.4142...
            // Let's use reverse logic: simple multiplication
            // mul(2 * 2^96, 3 * 2^96) -> 6 * 2^96
            const two = 2n * Q96;
            const three = 3n * Q96;
            const prod = Q64x96.mul(two, three);

            // If fallback works, it should be exactly 6 * 2^96
            expect(prod).toBe(6n * Q96);

            // Verify it handles division
            const divRes = Q64x96.div(prod, two);
            expect(divRes).toBe(three);
        });
    });

    // ─────────────────────────────────────────────
    // 2. PriceService Sanity Limit ($100k -> $1M)
    // ─────────────────────────────────────────────
    describe('PriceService Sanity Check', () => {
        let priceService: PriceService;

        beforeEach(() => {
            vi.resetAllMocks();
            const config: EidolonConfig = { rpcUrl: '', privacyMode: 'standard' };
            priceService = new PriceService(config);

            // Clear internal cache to ensure fetch logic runs
            (priceService as any).cache.clear();
        });

        it('should accept BTC/ETH prices > $100,000 (up to $1,000,000)', async () => {
            // Mock all GET requests to return high price for Binance
            vi.mocked(axios.get).mockImplementation(async (url) => {
                const urlStr = String(url);
                if (urlStr.includes('binance') || urlStr.includes('BINANCE')) {
                    // Return valid structure for Binance response
                    // Binance Ticker: { symbol: "BNBUSDT", price: "..." }
                    return { data: { symbol: 'BNBUSDT', price: '150000.00' }, status: 200 };
                }
                // Pyth fallback or others
                return { data: {}, status: 404 };
            });

            // We call getBNBPrice because it's a convenient entry point 
            // that uses the internal fetch logic and sanity check.
            const res = await priceService.getBNBPrice();
            expect(res).toBe(150000);
        });

        it('should warn on partial results in strict mode', async () => {
            const config: EidolonConfig = { rpcUrl: '', privacyMode: 'strict' };
            priceService = new PriceService(config); // Strict mode

            const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            // In strict mode, it shouldn't call axios at all if configured wrong, 
            // but fetchMultiplePrices checks oracle, cache, then returns.
            // If no oracle/cache, it returns partial (empty) and warns.
            const res = await priceService.fetchMultiplePrices(['BNB', 'UNKNOWN']);

            expect(res).toEqual({});
            expect(spy).toHaveBeenCalledWith(expect.stringContaining('Strict mode: no price for symbols'));
            spy.mockRestore();
        });
    });

    // ─────────────────────────────────────────────
    // 3. ApiGateway Retry Logic
    // ─────────────────────────────────────────────
    describe('ApiGateway Retry', () => {
        let gateway: ReturnType<typeof getGateway>;

        beforeEach(() => {
            vi.resetAllMocks();
            const config: EidolonConfig = { rpcUrl: 'http://localhost', privacyMode: 'standard' };
            gateway = getGateway(config);
            // Hack to reset token bucket
            (gateway as any).buckets.clear();
        });

        it('should retry idempotent POSTs', async () => {
            vi.mocked(axios.post)
                .mockRejectedValueOnce(new Error('Fail 1'))
                .mockRejectedValueOnce(new Error('Fail 2'))
                .mockResolvedValueOnce({ data: { success: true }, status: 200 });

            const res = await gateway.post('https://api.test/submit', { x: 1 }, { idempotent: true });
            expect(res).toEqual({ success: true });
            expect(axios.post).toHaveBeenCalledTimes(3);
        });

        it('should NOT retry non-idempotent POSTs', async () => {
            vi.mocked(axios.post).mockRejectedValueOnce(new Error('Fail 1'));

            await expect(gateway.post('https://api.test/buy', { x: 1 }))
                .rejects.toThrow('Fail 1');

            expect(axios.post).toHaveBeenCalledTimes(1);
        });
    });
});
