import * as path from 'path';
import * as fs from 'fs';

export interface InvariantCheckResult {
    safe: boolean;
    reason?: string;
    circuit_broken: boolean; // New field
}

export interface SecurityScore {
    score: number;
    is_honeypot: boolean;
    liquidity_locked: boolean;
    liquidity_unknown?: boolean;
    contract_verified: boolean;
    owner_renounced: boolean;
    status: string; // New field: SAFE, CAUTION, DANGER, CRITICAL
}

// Mirroring the Rust struct
export interface TokenSecurityData {
    is_honeypot: boolean;
    honeypot_with_same_creator: boolean;
    buy_tax: string;
    sell_tax: string;
    cannot_buy: boolean;
    cannot_sell_all: boolean;
    is_blacklisted: boolean;
    is_whitelisted: boolean;
    is_open_source: boolean;
    is_proxy: boolean;
    is_mintable: boolean;
    owner_change_balance: boolean;
    owner_address: string;
    creator_address: string;
    liquidity_locked?: boolean;
}

export interface ValueInvariant {
    update_snapshot(total_portfolio_value: number): void;
    check_invariant(trade_value_usd: number, predicted_impact: number): InvariantCheckResult;
}

export interface AntiRug {
    add_to_whitelist(address: string): void;
    add_to_blacklist(address: string): void;
    export_lists(): unknown;
    import_lists(data: unknown): void;
    check_token_security(tokenAddress: string): SecurityScore;
    compute_score(tokenAddress: string, tokenData: TokenSecurityData): SecurityScore;
}

class MockValueInvariant implements ValueInvariant {
    private lastSnapshot = 0;

    constructor(
        private readonly maxDrawdownPerBlock: number,
        private readonly maxPositionSize: number,
        private readonly circuitBreakerThreshold: number
    ) { }

    update_snapshot(total_portfolio_value: number): void {
        if (Number.isFinite(total_portfolio_value) && total_portfolio_value >= 0) {
            this.lastSnapshot = total_portfolio_value;
        }
    }

    check_invariant(trade_value_usd: number, predicted_impact: number): InvariantCheckResult {
        if (!Number.isFinite(trade_value_usd) || trade_value_usd < 0) {
            return {
                safe: false,
                reason: 'INVALID_INPUT: Trade value is NaN or negative',
                circuit_broken: false
            };
        }

        if (trade_value_usd > this.maxPositionSize) {
            return {
                safe: false,
                reason: `INVARIANT_BREACH: Trade size ${trade_value_usd.toFixed(2)} > Max ${this.maxPositionSize.toFixed(2)}`,
                circuit_broken: false
            };
        }

        const drawdownPct = this.lastSnapshot > 0
            ? (Math.abs(predicted_impact) / this.lastSnapshot) * 100
            : 0;

        if (drawdownPct > this.circuitBreakerThreshold) {
            return {
                safe: false,
                reason: `CIRCUIT_BREAKER: Drawdown ${drawdownPct.toFixed(2)}% > Threshold ${this.circuitBreakerThreshold.toFixed(2)}%`,
                circuit_broken: true
            };
        }

        if (drawdownPct > this.maxDrawdownPerBlock) {
            return {
                safe: false,
                reason: `RISK_WARNING: Drawdown ${drawdownPct.toFixed(2)}% > Max ${this.maxDrawdownPerBlock.toFixed(2)}%`,
                circuit_broken: false
            };
        }

        return { safe: true, circuit_broken: false };
    }
}

class MockAntiRug implements AntiRug {
    private whitelist = new Set<string>();
    private blacklist = new Set<string>();

    add_to_whitelist(address: string): void {
        this.whitelist.add(address.toLowerCase());
    }

    add_to_blacklist(address: string): void {
        this.blacklist.add(address.toLowerCase());
    }

    export_lists(): unknown {
        return {
            whitelist: Array.from(this.whitelist),
            blacklist: Array.from(this.blacklist)
        };
    }

    import_lists(data: any): void {
        for (const addr of data?.whitelist ?? []) {
            this.whitelist.add(String(addr).toLowerCase());
        }
        for (const addr of data?.blacklist ?? []) {
            this.blacklist.add(String(addr).toLowerCase());
        }
    }

    check_token_security(tokenAddress: string): SecurityScore {
        if (this.blacklist.has(tokenAddress.toLowerCase())) {
            return {
                score: 0,
                is_honeypot: false,
                liquidity_locked: false,
                liquidity_unknown: true,
                contract_verified: false,
                owner_renounced: false,
                status: 'BLACKLISTED'
            };
        }

        if (this.whitelist.has(tokenAddress.toLowerCase())) {
            return {
                score: 100,
                is_honeypot: false,
                liquidity_locked: true,
                liquidity_unknown: false,
                contract_verified: true,
                owner_renounced: true,
                status: 'WHITELISTED'
            };
        }

        return {
            score: 0, // FAIL-CLOSED: Assume unsafe if checking mechanism (WASM) is offline
            is_honeypot: false,
            liquidity_locked: false,
            liquidity_unknown: true,
            contract_verified: false, // Assume unverified
            owner_renounced: false,
            status: 'UNSAFE_MOCK' // Distinct status for debugging
        };
    }

    compute_score(tokenAddress: string, tokenData: TokenSecurityData): SecurityScore {
        if (this.whitelist.has(tokenAddress.toLowerCase())) {
            return {
                score: 100,
                is_honeypot: false,
                liquidity_locked: true,
                liquidity_unknown: false,
                contract_verified: true,
                owner_renounced: true,
                status: 'WHITELISTED'
            };
        }
        if (this.blacklist.has(tokenAddress.toLowerCase()) || tokenData.is_honeypot) {
            return {
                score: 0,
                is_honeypot: true,
                liquidity_locked: false,
                liquidity_unknown: false,
                contract_verified: false,
                owner_renounced: false,
                status: 'DANGER'
            };
        }

        const verified = Boolean(tokenData.is_open_source);
        const ownerRenounced = tokenData.owner_address === '' || tokenData.owner_address === '0x0000000000000000000000000000000000000000';
        const liquidityLocked = tokenData.liquidity_locked === true;
        const liquidityUnknown = tokenData.liquidity_locked === undefined;

        let score = 65;
        if (verified) score += 15;
        if (ownerRenounced) score += 10;
        if (liquidityLocked) score += 10;
        if (!liquidityLocked && !liquidityUnknown) score -= 20;
        if (tokenData.buy_tax && Number(tokenData.buy_tax) > 10) score -= 15;
        if (tokenData.sell_tax && Number(tokenData.sell_tax) > 10) score -= 15;
        score = Math.max(0, Math.min(100, score));

        return {
            score,
            is_honeypot: false,
            liquidity_locked: liquidityLocked,
            liquidity_unknown: liquidityUnknown,
            contract_verified: verified,
            owner_renounced: ownerRenounced,
            status: score >= 80 ? 'SAFE' : score >= 50 ? 'CAUTION' : 'DANGER'
        };
    }
}

/**
 * 🦀 WASM ADAPTER
 * Bridges the gap between TypeScript (Brain) and Rust (Heart).
 * 
 * This singleton ensures the WASM module is loaded and provides
 * type-safe access to the Rust security core.
 */
export class WasmAdapter {
    private static instance: WasmAdapter;
    private coreModule: any = null;
    private fallbackMode: boolean = true;
    private initialized: boolean = false;

    private constructor() { }

    public static getInstance(): WasmAdapter {
        if (!WasmAdapter.instance) {
            WasmAdapter.instance = new WasmAdapter();
        }
        return WasmAdapter.instance;
    }

    /**
     * Resets the singleton instance.
     * Useful for testing to ensure a clean state.
     */
    public static resetInstance(): void {
        (WasmAdapter.instance as any) = null;
    }

    public async init(): Promise<void> {
        if (this.initialized) return;

        try {
            // FIX: Use dynamic import for ESM support and correct path
            // Path relative to dist/eidolon/WasmAdapter.js might be different than src
            // But usually bundlers handle this. For Node execution:
            // src/eidolon -> ../../core-rust/pkg/core_rust.js
            try {
                // 1. Import the JS Wrapper (ESM)
                // Need to use absolute path resolution for stability in tests/node
                const projectRoot = path.resolve(__dirname, '../../..'); // src/eidolon -> src -> root
                // Check if we are in dist or src. 
                // If __dirname contains 'src', we go up 2 levels to root.
                // If __dirname contains 'dist', we go up 2 levels to root.
                // Safest is to find 'core-rust' relative to this file.

                const pkgPath = path.resolve(__dirname, '../../core-rust/pkg');
                const jsPath = path.join(pkgPath, 'core_rust.js');
                const wasmPath = path.join(pkgPath, 'core_rust_bg.wasm');

                if (fs.existsSync(jsPath)) {
                    const module = await import(jsPath);

                    // 2. Initialize WASM memory with Binary (Node.js support)
                    if (fs.existsSync(wasmPath)) {
                        const buffer = fs.readFileSync(wasmPath);
                        // Call default export (init) with the buffer
                        // This populates the 'wasm' variable inside the module closure
                        if (typeof module.default === 'function') {
                            await module.default(buffer);
                        }
                    } else {
                        console.warn('⚠️ WASM binary not found at', wasmPath);
                    }

                    this.coreModule = module;
                    this.fallbackMode = false;
                    console.log('🦀 WASM Core Loaded & Initialized');
                } else {
                    console.warn('⚠️ WASM JS wrapper not found at', jsPath);
                    this.coreModule = null;
                }
            } catch (e1) {
                console.warn('⚠️ WASM load failed:', e1);
                this.coreModule = null; // Fallback
            }
        } catch (error) {
            console.warn('⚠️ WASM core unavailable. Falling back to deterministic TS mocks.', error);
            this.fallbackMode = true;
        } finally {
            this.initialized = true;
        }
    }

    /**
     * Create a new ValueInvariant instance (Rust)
     * Added: circuitBreakerThreshold
     */
    public createValueInvariant(
        maxDrawdownPerBlock: number,
        maxPositionSize: number,
        circuitBreakerThreshold: number = 15.0 // Default 15%
    ): ValueInvariant {
        const Ctor = this.coreModule?.ValueInvariant;
        if (Ctor) {
            return new Ctor(maxDrawdownPerBlock, maxPositionSize, circuitBreakerThreshold) as ValueInvariant;
        }
        return new MockValueInvariant(maxDrawdownPerBlock, maxPositionSize, circuitBreakerThreshold);
    }

    /**
     * Create a new AntiRug instance (Rust)
     */
    public createAntiRug(): AntiRug {
        const Ctor = this.coreModule?.AntiRug;
        if (Ctor) {
            return new Ctor() as AntiRug;
        }
        return new MockAntiRug();
    }

    public createCausalGraph(): unknown | null {
        const Ctor = this.coreModule?.CausalGraph;
        if (!Ctor) return null;
        return new Ctor();
    }

    public createTraumaRegistry(): unknown | null {
        const Ctor = this.coreModule?.TraumaRegistry;
        if (!Ctor) return null;
        return new Ctor();
    }

    public q64Mul(aRaw: bigint, bRaw: bigint): bigint {
        const fn = this.coreModule?.q64_96_mul;
        if (typeof fn === 'function') {
            const out = fn(aRaw.toString(), bRaw.toString());
            return BigInt(out);
        }
        return (aRaw * bRaw) >> 96n;
    }

    public q64Div(aRaw: bigint, bRaw: bigint): bigint {
        if (bRaw === 0n) throw new Error('Division by zero');
        const fn = this.coreModule?.q64_96_div;
        if (typeof fn === 'function') {
            const out = fn(aRaw.toString(), bRaw.toString());
            return BigInt(out);
        }
        return (aRaw << 96n) / bRaw;
    }

    public sqrtPriceX96ToPriceWad(
        sqrtPriceX96: bigint,
        token0Decimals: number,
        token1Decimals: number
    ): bigint {
        const fn = this.coreModule?.sqrt_price_x96_to_price_wad;
        if (typeof fn === 'function') {
            const out = fn(
                sqrtPriceX96.toString(),
                token0Decimals,
                token1Decimals
            );
            return BigInt(out);
        }

        const wad = 10n ** 18n;
        let numerator = sqrtPriceX96 * sqrtPriceX96 * wad;
        let denominator = 1n << 192n;

        if (token0Decimals > token1Decimals) {
            numerator *= 10n ** BigInt(token0Decimals - token1Decimals);
        } else if (token1Decimals > token0Decimals) {
            denominator *= 10n ** BigInt(token1Decimals - token0Decimals);
        }

        return numerator / denominator;
    }

    /**
     * Utility to check if WASM is ready (mostly for browser targets, 
     * but good practice to have)
     */
    public isReady(): boolean {
        return !this.fallbackMode;
    }
}
