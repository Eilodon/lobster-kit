import { describe, expect, it } from 'vitest';
import { TokenAmount } from '../src/math/TokenAmount';

describe('TokenAmount', () => {
    it('should parse and format human amounts safely', () => {
        const amount = TokenAmount.fromHuman('1.5', 6, 'USDT');
        expect(amount.raw).toBe(1500000n);
        expect(amount.toHuman(2)).toBe('1.5');
    });

    it('should convert decimals correctly', () => {
        const usdt = TokenAmount.fromHuman('2', 6, 'USDT');
        const as18 = usdt.convert(18);
        expect(as18.raw).toBe(2000000000000000000n);
        expect(as18.decimals).toBe(18);
    });

    it('should block arithmetic on mismatched decimals', () => {
        const a = TokenAmount.fromHuman('1', 6, 'USDT');
        const b = TokenAmount.fromHuman('1', 18, 'WBNB');
        expect(() => a.add(b)).toThrow('Token decimals mismatch');
    });
});
