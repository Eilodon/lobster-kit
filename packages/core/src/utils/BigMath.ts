// Native BigInt formatUnits/parseUnits — zero external dependencies
function formatUnits(value: bigint, decimals: number): string {
    const divisor = 10n ** BigInt(decimals);
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const intPart = abs / divisor;
    const fracPart = abs % divisor;
    const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '');
    const sign = negative ? '-' : '';
    return fracStr ? `${sign}${intPart}.${fracStr}` : `${sign}${intPart}`;
}

function parseUnits(value: string, decimals: number): bigint {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [intPart = '0', fracPart = ''] = unsigned.split('.');
    const paddedFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
    const raw = BigInt(intPart + paddedFrac);
    return negative ? -raw : raw;
}

export const WAD = 1_000_000_000_000_000_000n; // 1e18
export const RAY = 1_000_000_000_000_000_000_000_000_000n; // 1e27
export const HALF_WAD = WAD / 2n;
export const HALF_RAY = RAY / 2n;

/**
 * 🧮 BigMath: Metabolic Precision Engine
 * Zero-entropy arithmetic for financial calculations.
 * Replaces lossy `Number` logic with 18/27 decimal fixed-point math.
 */
export class BigMath {
    private static decimalToScaledInt(value: string | number, scale: number): bigint {
        const normalized = String(value).trim();
        if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
            throw new Error(`BigMath: Invalid decimal input '${value}'`);
        }

        const negative = normalized.startsWith('-');
        const unsigned = negative ? normalized.slice(1) : normalized;
        const [intPart, fracPart = ''] = unsigned.split('.');
        const base = 10n ** BigInt(scale);
        const whole = BigInt(intPart) * base;
        const frac = BigInt((fracPart + '0'.repeat(scale)).slice(0, scale) || '0');
        const scaled = whole + frac;
        return negative ? -scaled : scaled;
    }

    /**
     * Safe multiplication for WAD (18 decimals)
     * (a * b) / WAD
     */
    static mulWad(a: bigint, b: bigint): bigint {
        const product = a * b;
        // Handle signed rounding
        if (product >= 0n) {
            return (product + HALF_WAD) / WAD;
        } else {
            return (product - HALF_WAD) / WAD;
        }
    }

    /**
     * Safe division for WAD (18 decimals)
     * (a * WAD) / b
     */
    static divWad(a: bigint, b: bigint): bigint {
        if (b === 0n) throw new Error("BigMath: Division by zero");

        // Check if result will be negative (different signs)
        const resultNegative = (a < 0n && b > 0n) || (a > 0n && b < 0n);

        // Work with absolute values to ensure consistent rounding away from zero (for 0.5)
        // This ensures -0.5 rounds to -1 and 0.5 rounds to 1, maintaining symmetry
        const absA = a < 0n ? -a : a;
        const absB = b < 0n ? -b : b;

        const absNum = absA * WAD;
        const absResult = (absNum + absB / 2n) / absB;

        return resultNegative ? -absResult : absResult;
    }

    /**
     * Safe multiplication for RAY (27 decimals)
     */
    static mulRay(a: bigint, b: bigint): bigint {
        const product = a * b;
        // Handle signed rounding
        if (product >= 0n) {
            return (product + HALF_RAY) / RAY;
        } else {
            return (product - HALF_RAY) / RAY;
        }
    }

    /**
     * Safe division for RAY (27 decimals)
     */
    static divRay(a: bigint, b: bigint): bigint {
        if (b === 0n) throw new Error("BigMath: Division by zero");

        const resultNegative = (a < 0n && b > 0n) || (a > 0n && b < 0n);
        const absA = a < 0n ? -a : a;
        const absB = b < 0n ? -b : b;

        const absNum = absA * RAY;
        const absResult = (absNum + absB / 2n) / absB;

        return resultNegative ? -absResult : absResult;
    }

    /**
     * Convert string/number to WAD bigint
     * "1.5" -> 1500000000000000000n
     */
    static toWad(value: string | number): bigint {
        return parseUnits(value.toString(), 18);
    }

    /**
     * Converts percentage to basis points without float multiplication.
     * Example: 0.5 (%) => 50 bps.
     */
    static percentToBps(percent: string | number): bigint {
        return this.decimalToScaledInt(percent, 2);
    }

    /**
     * Convert WAD bigint to formatted string
     * 1500000000000000000n -> "1.5"
     */
    static fromWad(value: bigint, decimals: number = 4): string {
        const formatted = formatUnits(value, 18);
        // Trim to specified decimals if needed, but prefer keeping precision
        const [int, frac] = formatted.split('.');
        if (!frac) return int;
        return `${int}.${frac.slice(0, decimals)}`;
    }

    /**
     * Convert bigint units to number via decimal string.
     * Avoids lossy direct Number(bigint) coercion.
     */
    static unitsToNumber(value: bigint, decimals: number): number {
        const formatted = formatUnits(value, decimals);
        const parsed = Number(formatted);
        if (!Number.isFinite(parsed)) {
            throw new Error('BigMath: unitsToNumber overflow');
        }
        return parsed;
    }

    /**
     * Calculate percentage change (Slippage/ROI) in WAD
     * Returns: (current - start) / start * WAD
     */
    static percentChange(start: bigint, current: bigint): bigint {
        if (start === 0n) return 0n;
        const delta = current - start;
        return this.divWad(delta, start);
    }

    /**
     * Min function for bigints
     */
    static min(a: bigint, b: bigint): bigint {
        return a < b ? a : b;
    }

    /**
     * Max function for bigints
     */
    static max(a: bigint, b: bigint): bigint {
        return a > b ? a : b;
    }

    /**
     * Absolute value
     */
    static abs(n: bigint): bigint {
        return n < 0n ? -n : n;
    }
}
