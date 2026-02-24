import { describe, expect, it } from 'vitest';
import { Q64x96 } from '../src/math/Q64x96';

describe('Q64x96 Hybrid Mode (TS + WASM)', () => {
    it('should multiply and divide fixed-point values', () => {
        const q96 = 1n << 96n;
        const twoQ96 = 2n << 96n;
        expect(Q64x96.mul(q96, twoQ96)).toBe(twoQ96);
        expect(Q64x96.div(twoQ96, q96)).toBe(twoQ96);
    });

    it('should convert sqrtPriceX96 to price WAD', () => {
        const q96 = 1n << 96n;
        const priceWad = Q64x96.sqrtPriceX96ToPriceWad(q96, 18, 18);
        expect(priceWad).toBe(1000000000000000000n);
    });

    it('should account for token decimal difference', () => {
        const q96 = 1n << 96n;
        const priceWad = Q64x96.sqrtPriceX96ToPriceWad(q96, 18, 6);
        expect(priceWad).toBe(1000000000000000000000000000000n); // 1e30
    });
});
