import {
    ValueInvariant,
    AntiRug
} from '../../pkg/core_rust';

export interface InvariantCheckResult {
    safe: boolean;
    reason?: string;
    circuit_broken: boolean; // New field
}

export interface SecurityScore {
    score: number;
    is_honeypot: boolean;
    liquidity_locked: boolean;
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
    private initialized: boolean = false;

    private constructor() {
        // Private constructor for singleton
    }

    public static getInstance(): WasmAdapter {
        if (!WasmAdapter.instance) {
            WasmAdapter.instance = new WasmAdapter();
        }
        return WasmAdapter.instance;
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
        // In Node.js WASM build, the module is loaded synchronously via require.
        // So we can just instantiate the class.
        return new ValueInvariant(maxDrawdownPerBlock, maxPositionSize, circuitBreakerThreshold);
    }

    /**
     * Create a new AntiRug instance (Rust)
     */
    public createAntiRug(): AntiRug {
        return new AntiRug();
    }

    /**
     * Utility to check if WASM is ready (mostly for browser targets, 
     * but good practice to have)
     */
    public isReady(): boolean {
        return true; // Node.js target is sync
    }
}

// Re-export types for convenience
export type { ValueInvariant, AntiRug };
