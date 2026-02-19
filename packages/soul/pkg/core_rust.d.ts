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

export class TraumaRegistry {
    free(): void;
    [Symbol.dispose](): void;
    export_records(): any;
    get_remaining_ms(mode: number, action_name: string, now_ts_ms: bigint): bigint;
    heal(mode: number, action_name: string): void;
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

export function q64_96_div(a_raw: string, b_raw: string): string;

export function q64_96_mul(a_raw: string, b_raw: string): string;

export function sqrt_price_x96_to_price_wad(sqrt_price_x96_raw: string, token0_decimals: number, token1_decimals: number): string;
