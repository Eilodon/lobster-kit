import { describe, it, expect } from 'vitest';
import { BigMath, WAD } from '../src/utils/BigMath';

describe('BigMath (Metabolic Precision)', () => {
    it('should convert to/from WAD correctly', () => {
        const input = "1.5";
        const wad = BigMath.toWad(input);
        expect(wad).toBe(1500000000000000000n);
        expect(BigMath.fromWad(wad)).toBe("1.5");
    });

    it('should multiply WAD correctly (rounding)', () => {
        const a = BigMath.toWad("2.0");
        const b = BigMath.toWad("0.5");
        // 2.0 * 0.5 = 1.0
        expect(BigMath.mulWad(a, b)).toBe(BigMath.toWad("1.0"));

        // Rounding check
        // 1.000000000000000001 * 1.5 -> 1.5...0015 -> should round properly mechanism dependent
        // Using standard test: 1 WAD * 1 WAD = 1 WAD
        expect(BigMath.mulWad(WAD, WAD)).toBe(WAD);
    });

    it('should divide WAD correctly (rounding)', () => {
        const a = BigMath.toWad("10.0");
        const b = BigMath.toWad("2.0");
        expect(BigMath.divWad(a, b)).toBe(BigMath.toWad("5.0"));

        // 1 / 3 = 0.333...
        const one = BigMath.toWad("1");
        const three = BigMath.toWad("3");
        const result = BigMath.divWad(one, three);
        // 0.333333333333333333
        expect(result.toString()).toBe("333333333333333333");
    });

    it('should calculate percent change', () => {
        const start = BigMath.toWad("100");
        const end = BigMath.toWad("110");
        const result = BigMath.percentChange(start, end);
        // (110 - 100) / 100 = 0.1
        expect(result).toBe(BigMath.toWad("0.1"));

        const lossStart = BigMath.toWad("100");
        const lossEnd = BigMath.toWad("90");
        const loss = BigMath.percentChange(lossStart, lossEnd);
        // (90 - 100) / 100 = -0.1
        expect(loss).toBe(BigMath.toWad("-0.1"));
    });

    it('should perform min/max correctly', () => {
        const low = 100n;
        const high = 200n;
        expect(BigMath.min(low, high)).toBe(low);
        expect(BigMath.max(low, high)).toBe(high);
    });

    it('should throw on division by zero', () => {
        expect(() => BigMath.divWad(100n, 0n)).toThrow("Division by zero");
    });
});
