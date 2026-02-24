

/**
 * Q64.96 fixed-point helpers for UniswapV3/PancakeV3 math.
 * Hybrid Mode:
 * - Transparently uses WASM accelerated math from @eidolon/soul if running in the full agent.
 * - Falls back to pure TypeScript implementation dynamically if running isolated.
 */
export class Q64x96 {
    static mul(aRaw: bigint, bRaw: bigint): bigint {
        const adapter = (globalThis as any).EIDOLON_WASM_ADAPTER ?? {};
        if (typeof (adapter as any).q64_96_mul === 'function') {
            return (adapter as any).q64_96_mul(aRaw, bRaw);
        }
        return (aRaw * bRaw) >> 96n;
    }

    static div(aRaw: bigint, bRaw: bigint): bigint {
        if (bRaw === 0n) throw new Error('Q64x96: division by zero');
        const adapter = (globalThis as any).EIDOLON_WASM_ADAPTER ?? {};
        if (typeof (adapter as any).q64_96_div === 'function') {
            return (adapter as any).q64_96_div(aRaw, bRaw);
        }
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
        const adapter = (globalThis as any).EIDOLON_WASM_ADAPTER ?? {};
        if (typeof (adapter as any).sqrt_price_x96_to_price_wad === 'function') {
            return (adapter as any).sqrt_price_x96_to_price_wad(sqrtPriceX96, token0Decimals, token1Decimals);
        }

        const WAD = 10n ** 18n;
        const price = (sqrtPriceX96 * sqrtPriceX96 * WAD) >> (96n * 2n);
        const decimalAdj = BigInt(10 ** Math.abs(token0Decimals - token1Decimals));
        if (token0Decimals >= token1Decimals) {
            return price * decimalAdj;
        } else {
            return price / decimalAdj;
        }
    }
}
