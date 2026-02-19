/* tslint:disable */
/* eslint-disable */

export class AntiRug {
    free(): void;
    [Symbol.dispose](): void;
    add_to_blacklist(address: string): void;
    add_to_whitelist(address: string): void;
    check_token_security(_token_address: string): any;
    /**
     *
     *     * compute_score
     *     * Real logic: Takes raw API data and computes a rigorous safety score.
     *
     */
    compute_score(token_address: string, data: any): any;
    /**
     * Export whitelist + blacklist as JSON for persistence
     */
    export_lists(): any;
    /**
     * Import previously persisted whitelist + blacklist from JSON
     */
    import_lists(data: any): void;
    constructor();
}

export class CausalGraph {
    free(): void;
    [Symbol.dispose](): void;
    export_edges(): any;
    get_edge(cause: number, effect: number): any;
    import_edges(edges: any): void;
    learn(cause: number, effect: number, outcome_positive: boolean): void;
    constructor();
    predict(effect: number, observations: any): number;
}

export class HyperMemory {
    free(): void;
    [Symbol.dispose](): void;
    count(): number;
    export_data(): any;
    import_data(data: any): void;
    insert(id: string, vector: Float32Array): void;
    constructor(dimension: number);
    search(query_vector: Float32Array, k: number): any;
}

export class LiquidBrain {
    free(): void;
    [Symbol.dispose](): void;
    forward(input: Float32Array): Float32Array;
    constructor(input_size: number, hidden_size: number);
    optimize(reward_signal: number): void;
    reset(): void;
}

export class TraumaRegistry {
    free(): void;
    [Symbol.dispose](): void;
    export_records(): any;
    get_remaining_ms(mode: number, action_name: string, now_ts_ms: bigint): bigint;
    heal(mode: number, action_name: string): void;
    /**
     * Restore a previously exported registry snapshot.
     * BUG FIX #2: import_records was missing — TraumaRegistry could not survive agent restarts.
     *
     * Expects the same format as export_records:
     * `{ "<hex_hash>": { sev_eff, count, inhibit_until_ts_ms, last_ts_ms }, ... }`
     */
    import_records(data: any): void;
    is_inhibited(mode: number, action_name: string, now_ts_ms: bigint): boolean;
    constructor();
    record_trauma(mode: number, action_name: string, severity: number, now_ts_ms: bigint): void;
}

export class ValueInvariant {
    free(): void;
    [Symbol.dispose](): void;
    check_invariant(trade_value_usd: number, predicted_impact: number): any;
    constructor(max_drawdown_per_block: number, max_position_size: number, circuit_breaker_threshold: number);
    update_snapshot(total_portfolio_value: number): void;
}

/**
 * Divide two Q64.96 numbers: (a << 96) / b
 */
export function q64_96_div(a_bytes: Uint8Array, b_bytes: Uint8Array): Uint8Array;

/**
 * Multiply two Q64.96 numbers and shift right by 96 bits.
 * a_bytes × b_bytes → (a × b) >> 96
 */
export function q64_96_mul(a_bytes: Uint8Array, b_bytes: Uint8Array): Uint8Array;

/**
 * Convert Uniswap V3 sqrtPriceX96 → price WAD (1e18 scale).
 *
 * Formula: price_wad = (sqrt^2 / 2^192) × 10^18 × 10^(d0 - d1)
 * All arithmetic: stack-allocated U256/U512, zero heap allocation.
 */
export function sqrt_price_x96_to_price_wad(sqrt_price_x96_bytes: Uint8Array, token0_decimals: number, token1_decimals: number): Uint8Array;
