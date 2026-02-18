import { formatUnits, parseUnits } from 'viem';

/**
 * Type-safe token amount with explicit decimals.
 * Prevents cross-token arithmetic bugs and accidental float coercion.
 */
export class TokenAmount {
    public readonly raw: bigint;
    public readonly decimals: number;
    public readonly symbol?: string;

    constructor(raw: bigint, decimals: number, symbol?: string) {
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
            throw new Error(`Invalid token decimals: ${decimals}`);
        }
        this.raw = raw;
        this.decimals = decimals;
        this.symbol = symbol;
    }

    static fromHuman(amount: string, decimals: number, symbol?: string): TokenAmount {
        return new TokenAmount(parseUnits(amount, decimals), decimals, symbol);
    }

    static fromRaw(raw: bigint, decimals: number, symbol?: string): TokenAmount {
        return new TokenAmount(raw, decimals, symbol);
    }

    toHuman(maxFractionDigits: number = Math.min(6, this.decimals)): string {
        const full = formatUnits(this.raw, this.decimals);
        const [whole, frac = ''] = full.split('.');
        if (maxFractionDigits <= 0 || frac.length === 0) return whole;
        return `${whole}.${frac.slice(0, maxFractionDigits)}`.replace(/\.$/, '');
    }

    convert(newDecimals: number): TokenAmount {
        if (newDecimals === this.decimals) {
            return new TokenAmount(this.raw, this.decimals, this.symbol);
        }
        if (newDecimals > this.decimals) {
            const factor = 10n ** BigInt(newDecimals - this.decimals);
            return new TokenAmount(this.raw * factor, newDecimals, this.symbol);
        }
        const factor = 10n ** BigInt(this.decimals - newDecimals);
        return new TokenAmount(this.raw / factor, newDecimals, this.symbol);
    }

    add(other: TokenAmount): TokenAmount {
        this.assertCompatible(other);
        return new TokenAmount(this.raw + other.raw, this.decimals, this.symbol);
    }

    sub(other: TokenAmount): TokenAmount {
        this.assertCompatible(other);
        return new TokenAmount(this.raw - other.raw, this.decimals, this.symbol);
    }

    mulBps(bps: bigint): TokenAmount {
        return new TokenAmount((this.raw * bps) / 10000n, this.decimals, this.symbol);
    }

    percentage(percent: number): TokenAmount {
        const bps = BigInt(Math.round(percent * 100));
        return this.mulBps(bps);
    }

    private assertCompatible(other: TokenAmount): void {
        if (this.decimals !== other.decimals) {
            throw new Error(
                `Token decimals mismatch: ${this.decimals} vs ${other.decimals}`
            );
        }
    }
}
