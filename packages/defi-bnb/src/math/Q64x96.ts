/**
 * Q64.96 fixed-point helpers for UniswapV3/PancakeV3 math.
 * Pure TypeScript implementation (no WASM dependency).
 * For WASM-accelerated version, use @clawkit/soul.
 */
export class Q64x96 {
    private static readonly Q96 = 1n << 96n;
    private static readonly WAD = 10n ** 18n;

    static mul(aRaw: bigint, bRaw: bigint): bigint {
        return (aRaw * bRaw) >> 96n;
    }

    static div(aRaw: bigint, bRaw: bigint): bigint {
        if (bRaw === 0n) throw new Error('Q64x96: division by zero');
        return (aRaw << 96n) / bRaw;
    }

    /**
     * Converts sqrtPriceX96 to price WAD (1e18).
     * price = token1 per token0, adjusted by decimals.
     */
    static sqrtPriceX96ToPriceWad(
        sqrtPriceX96: bigint,
        token0Decimals: number,
        token1Decimals: number
    ): bigint {
        // price = (sqrtPriceX96 / 2^96)^2 * 10^(d0-d1) * 1e18
        const price = (sqrtPriceX96 * sqrtPriceX96 * this.WAD) >> (96n * 2n);
        const decimalAdj = BigInt(10 ** Math.abs(token0Decimals - token1Decimals));
        if (token0Decimals >= token1Decimals) {
            return price * decimalAdj;
        } else {
            return price / decimalAdj;
        }
    }
}
