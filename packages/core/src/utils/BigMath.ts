const POW10_CACHE = new Map<number, bigint>([[0, 1n]]);

function pow10(decimals: number): bigint {
    if (!Number.isInteger(decimals) || decimals < 0) {
        throw new Error(`BigMath: Invalid decimals '${decimals}'`);
    }
    const cached = POW10_CACHE.get(decimals);
    if (cached !== undefined) return cached;

    const computed = 10n ** BigInt(decimals);
    POW10_CACHE.set(decimals, computed);
    return computed;
}

function trimTrailingZeros(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 48) {
        end--;
    }
    return end === value.length ? value : value.slice(0, end);
}

function isDigits(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 48 || code > 57) return false;
    }
    return true;
}

type ParsedDecimal = {
    negative: boolean;
    intPart: string;
    fracPart: string;
};

function parseDecimal(value: string): ParsedDecimal {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`BigMath: Invalid decimal input '${value}'`);
    }

    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    if (!unsigned) {
        throw new Error(`BigMath: Invalid decimal input '${value}'`);
    }

    const firstDot = unsigned.indexOf('.');
    const lastDot = unsigned.lastIndexOf('.');
    if (firstDot !== lastDot) {
        throw new Error(`BigMath: Invalid decimal input '${value}'`);
    }

    const intPartRaw = firstDot >= 0 ? unsigned.slice(0, firstDot) : unsigned;
    const fracPart = firstDot >= 0 ? unsigned.slice(firstDot + 1) : '';
    const intPart = intPartRaw || '0';

    if (!isDigits(intPart) || !isDigits(fracPart)) {
        throw new Error(`BigMath: Invalid decimal input '${value}'`);
    }
    if (!intPartRaw && !fracPart) {
        throw new Error(`BigMath: Invalid decimal input '${value}'`);
    }

    return { negative, intPart, fracPart };
}

// Native BigInt formatUnits/parseUnits — zero external dependencies
function formatUnits(value: bigint, decimals: number): string {
    const divisor = pow10(decimals);
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const intPart = abs / divisor;
    const sign = negative ? '-' : '';

    if (decimals === 0) return `${sign}${intPart}`;

    const fracPart = abs % divisor;
    if (fracPart === 0n) return `${sign}${intPart}`;

    let fracStr = fracPart.toString();
    if (fracStr.length < decimals) {
        fracStr = `${'0'.repeat(decimals - fracStr.length)}${fracStr}`;
    }
    fracStr = trimTrailingZeros(fracStr);
    return fracStr ? `${sign}${intPart}.${fracStr}` : `${sign}${intPart}`;
}

function parseUnits(value: string, decimals: number): bigint {
    const { negative, intPart, fracPart } = parseDecimal(value);
    const base = pow10(decimals);
    const whole = BigInt(intPart) * base;

    if (decimals === 0) {
        return negative ? -whole : whole;
    }

    const clampedFrac = fracPart.length > decimals ? fracPart.slice(0, decimals) : fracPart;
    const paddedFrac = clampedFrac.padEnd(decimals, '0');
    const frac = paddedFrac ? BigInt(paddedFrac) : 0n;
    const raw = whole + frac;
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
        return parseUnits(String(value), scale);
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
