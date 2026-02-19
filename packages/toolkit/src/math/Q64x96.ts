import { WasmAdapter } from '@clawkit/soul';

/**
 * Q64.96 fixed-point helpers for UniswapV3/PancakeV3 math.
 */
export class Q64x96 {
    private static readonly adapter = WasmAdapter.getInstance();

    static mul(aRaw: bigint, bRaw: bigint): bigint {
        return this.adapter.q64Mul(aRaw, bRaw);
    }

    static div(aRaw: bigint, bRaw: bigint): bigint {
        return this.adapter.q64Div(aRaw, bRaw);
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
        return this.adapter.sqrtPriceX96ToPriceWad(
            sqrtPriceX96,
            token0Decimals,
            token1Decimals
        );
    }
}
