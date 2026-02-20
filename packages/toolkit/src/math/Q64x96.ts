/**
 * Q64.96 fixed-point helpers for UniswapV3/PancakeV3 math.
 *
 * Primary path: @clawkit/soul WASM (Rust, higher precision)
 * Fallback path: Pure TypeScript (standard Uniswap V3 formulas)
 */

// ─── TypeScript Fallback Math ──────────────────────────────────────────────────

const Q96 = 2n ** 96n;
const WAD = 10n ** 18n;

/** (a * b) >> 96 — standard Q64.96 multiply */
function tsMul(a: bigint, b: bigint): bigint {
    return (a * b) >> 96n;
}

/** (a << 96) / b — standard Q64.96 divide. Throws on divide-by-zero. */
function tsDiv(a: bigint, b: bigint): bigint {
    if (b === 0n) throw new Error('Q64x96: division by zero');
    return (a << 96n) / b;
}

/**
 * sqrtPriceX96 → price WAD (1e18)
 * Formula: price = (sqrtRatio / 2^96)^2 × (10^d0 / 10^d1)
 */
function tsSqrtPriceX96ToPriceWad(
    sqrtPriceX96: bigint,
    token0Decimals: number,
    token1Decimals: number
): bigint {
    // price = sqrtRatio^2 / Q96^2
    const numerator = sqrtPriceX96 * sqrtPriceX96 * WAD;
    const denominator = Q96 * Q96;
    const rawPrice = numerator / denominator;

    // Adjust for decimal difference
    const decimalDiff = token0Decimals - token1Decimals;
    if (decimalDiff > 0) {
        return rawPrice * (10n ** BigInt(decimalDiff));
    } else if (decimalDiff < 0) {
        return rawPrice / (10n ** BigInt(-decimalDiff));
    }
    return rawPrice;
}

// ─── WasmAdapter lazy import (avoids hard dep crash if soul not available) ─────

let _adapter: {
    q64Mul: (a: bigint, b: bigint) => bigint;
    q64Div: (a: bigint, b: bigint) => bigint;
    sqrtPriceX96ToPriceWad: (sq: bigint, d0: number, d1: number) => bigint;
} | null | undefined = undefined; // undefined = not yet tried, null = WASM unavailable

function getAdapter() {
    if (_adapter !== undefined) return _adapter;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { WasmAdapter } = require('@clawkit/soul') as { WasmAdapter: { getInstance: () => typeof _adapter } };
        _adapter = WasmAdapter.getInstance() ?? null;
    } catch {
        _adapter = null;
        console.warn('⚠️ [Q64x96] @clawkit/soul WASM unavailable — using TypeScript fallback');
    }
    return _adapter;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export class Q64x96 {
    static mul(aRaw: bigint, bRaw: bigint): bigint {
        try {
            const adapter = getAdapter();
            if (adapter) return adapter.q64Mul(aRaw, bRaw);
        } catch { /* fall through */ }
        return tsMul(aRaw, bRaw);
    }

    static div(aRaw: bigint, bRaw: bigint): bigint {
        try {
            const adapter = getAdapter();
            if (adapter) return adapter.q64Div(aRaw, bRaw);
        } catch { /* fall through */ }
        return tsDiv(aRaw, bRaw);
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
        try {
            const adapter = getAdapter();
            if (adapter) return adapter.sqrtPriceX96ToPriceWad(sqrtPriceX96, token0Decimals, token1Decimals);
        } catch { /* fall through */ }
        return tsSqrtPriceX96ToPriceWad(sqrtPriceX96, token0Decimals, token1Decimals);
    }
}

