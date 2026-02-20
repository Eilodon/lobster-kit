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
    /**
     * Export edges as JSON: { "CauseName->EffectName": { successes, failures, prob } }
     */
    export_edges(): any;
    get_causal_effect(cause: SentinelVariable, effect: SentinelVariable): number;
    /**
     * Get full edge details (successes/failures/prob) for UI/Adapter
     */
    get_edge(cause: SentinelVariable, effect: SentinelVariable): any;
    /**
     * Import edges from JSON
     */
    import_edges(data: any): void;
    learn(cause: SentinelVariable, effect: SentinelVariable, outcome_positive: boolean): void;
    constructor();
    predict(param: SentinelVariable, observations: any): number;
}

export class ConversationDomainConfig {
    free(): void;
    [Symbol.dispose](): void;
    static advisory(): ConversationDomainConfig;
    static discovery(): ConversationDomainConfig;
    constructor(intrusiveness_threshold: number, trust_decay_rate: number, trauma_severity_scale: number, dagma_trigger_episodes: number, thermo_dt: number);
    static peer(): ConversationDomainConfig;
    dagma_trigger_episodes: number;
    intrusiveness_threshold: number;
    thermo_dt: number;
    trauma_severity_scale: number;
    trust_decay_rate: number;
}

export class CounterfactualResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    actual_prob: number;
    delta: number;
    hypothetical_prob: number;
    would_have_been_better: boolean;
}

/**
 * Result of a matched trade
 */
export class Fill {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    maker_id: number;
    price: bigint;
    quantity: bigint;
    taker_id: number;
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

export class Intervenable {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Counterfactual: "What WOULD have happened if I chose differently?"
     * actual_var: "I chose AdvisorMode (Observation)"
     * hypothetical_var: "I chose PeerMode (Intervention)"
     * query_var: "OutcomeQuality"
     */
    counterfactual(graph: CausalGraph, actual_var: SentinelVariable, hypothetical_var: SentinelVariable, query_var: SentinelVariable): CounterfactualResult;
    /**
     * Pearl's do-calculus: P(Y | do(X=x))
     * Cut all incoming edges to X, set X=x, propagate forward.
     * Simplified implementation for the DAG:
     * Since our predict() is a linear combination, observing X=1 is similar to do(X=1) IF we ignore back-door paths (confounders).
     * In our simplified CausalGraph, we treat all parents as direct causes.
     * To strictly implement do(X), we need to ensure X's value is fixed regardless of its parents.
     *
     * However, our predict() function takes `observations` list. If X is in observations, it is effectively "clamped".
     * The difference between observation `P(Y|X)` and intervention `P(Y|do(X))` matters if X has parents that also affect Y (Confounders).
     *
     * For this version, we will perform "Mutilated Graph" intervention:
     * 1. Clone graph (conceptually - we just ignore incoming edges to X).
     * 2. But `predict` logic already sums over *provided* observations.
     *    If we provide X in observations, and we compute Y based on X, we are forward propagating.
     *    Does `predict` look at X's parents? `predict` logic:
     *    `weighted_sum += value * w` for each observed cause.
     *    It assumes observations are the *only* active causes or the *known* state of causes.
     *    It does NOT recursivley calculate unobserved causes.
     *    So in our specific implementation, `predict(Y, [X=x])` IS effectively `P(Y|do(X=x))` because we don't back-propagate to confounders.
     *
     * So we can wrap `predict` but with explicit semantic meaning.
     */
    do_intervention(graph: CausalGraph, intervention_var: SentinelVariable, intervention_value: number, query_var: SentinelVariable): number;
    constructor();
}

export class LiquidBrain {
    free(): void;
    [Symbol.dispose](): void;
    forward(input: Float32Array): Float32Array;
    constructor(input_size: number, hidden_size: number);
    optimize(reward_signal: number): void;
    reset(): void;
}

/**
 * Result of LP value calculation
 */
export class LpValue {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    amount_a: bigint;
    amount_b: bigint;
}

/**
 * High-performance order book using BTreeMap
 * Bids: sorted by price descending (highest first)
 * Asks: sorted by price ascending (lowest first)
 */
export class OrderBook {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get order book ask depth (number of price levels)
     */
    ask_depth(): number;
    /**
     * Get total ask volume at a price level
     */
    ask_volume_at(price: bigint): bigint;
    /**
     * Get best ask price
     */
    best_ask(): bigint;
    /**
     * Get best bid price
     */
    best_bid(): bigint;
    /**
     * Get order book bid depth (number of price levels)
     */
    bid_depth(): number;
    /**
     * Get total bid volume at a price level
     */
    bid_volume_at(price: bigint): bigint;
    /**
     * Cancel an order
     */
    cancel_order(order_id: number, side: OrderSide): boolean;
    constructor();
    /**
     * Place a limit order
     * Returns order ID
     */
    place_order(price: bigint, quantity: bigint, side: OrderSide, owner_id: number): number;
    /**
     * Set current timestamp (for order priority)
     */
    set_time(time: bigint): void;
    /**
     * Get spread in fixed-point
     */
    spread(): bigint;
}

export enum OrderSide {
    Buy = 0,
    Sell = 1,
}

export enum OrderStatus {
    Open = 0,
    PartialFill = 1,
    Filled = 2,
    Cancelled = 3,
}

export class RiskCalculator {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Calculate liquidation price
     */
    calculate_liquidation_price(side: number, entry_price: number, leverage: number, maintenance_margin_rate: number): number;
    /**
     * Calculate margin level: (Equity / Margin) * 100
     */
    calculate_margin_level(equity: number, margin: number): number;
    /**
     * Calculate required margin for a position
     */
    calculate_margin_required(quantity: number, price: number, leverage: number): number;
    /**
     * Calculate position size for given risk percentage
     */
    calculate_position_size(equity: number, price: number, leverage: number, risk_percent: number): number;
    /**
     * Calculate stop loss price for given max loss
     */
    calculate_stop_loss(side: number, entry_price: number, quantity: number, max_loss: number): number;
    /**
     * Check if new position is allowed
     */
    can_open_position(account_margin_level: number, account_risk_level: RiskLevel, leverage: number, current_positions: number): boolean;
    /**
     * Determine risk level from margin level
     */
    determine_risk_level(margin_level: number): RiskLevel;
    constructor(config: RiskConfig);
}

export class RiskConfig {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    static with_levels(liquidation: number, warning: number): RiskConfig;
    liquidation_level: number;
    max_leverage: number;
    max_positions: number;
    warning_level: number;
}

export enum RiskLevel {
    Low = 0,
    Medium = 1,
    High = 2,
    Liquidation = 3,
}

export class Sentinel {
    free(): void;
    [Symbol.dispose](): void;
    get_mode(): SentinelMode;
    /**
     * Return current thermodynamic state (Arousal/Entropy levels)
     */
    get_thermo_state(): Float32Array;
    constructor();
    set_mode(mode: SentinelMode): void;
    tick(gas_price: number, whale_flow: number): string;
}

export enum SentinelMode {
    Stalking = 0,
    Berserk = 1,
    Arbitrage = 2,
    Liquidation = 3,
    Snipe = 4,
    Emergency = 5,
    Zen = 6,
}

export enum SentinelVariable {
    PriceDelta = 0,
    VolumeSpike = 1,
    Volatility = 2,
    Momentum = 3,
    GasPriceGwei = 4,
    MempoolPendingCnt = 5,
    WhaleNetFlow = 6,
    LiquidityImbalance = 7,
    SmartMoneyActivity = 8,
    PortfolioRisk = 9,
    UserAction = 10,
    Sentiment = 11,
    MacroFactor = 12,
}

export class TradingDomainConfig {
    free(): void;
    [Symbol.dispose](): void;
    static aggressive(): TradingDomainConfig;
    static conservative(): TradingDomainConfig;
    constructor();
    gas_limit_gwei: number;
    max_leverage: number;
    max_slippage_bps: number;
    min_liquidity_threshold: bigint;
    risk_aversion_factor: number;
}

export class TraumaRegistry {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Export records as JSON for persistence
     */
    export_records(): any;
    /**
     * Get remaining inhibition time in milliseconds
     */
    get_remaining_ms(mode: SentinelMode, action_name: string, now_ts_ms: bigint): bigint;
    /**
     * Remove trauma record (heal)
     */
    heal(mode: SentinelMode, action_name: string): void;
    /**
     * Import records from JSON
     */
    import_records(data: any): void;
    /**
     * Check if action is inhibited
     */
    is_inhibited(mode: SentinelMode, action_name: string, now_ts_ms: bigint): boolean;
    constructor();
    /**
     * Record a negative outcome ("Trauma")
     */
    record_trauma(mode: SentinelMode, action_name: string, severity: number, now_ts_ms: bigint): void;
}

export class ValueInvariant {
    free(): void;
    [Symbol.dispose](): void;
    check_invariant(trade_value_usd: number, predicted_impact: number): any;
    constructor(max_drawdown_per_block: number, max_position_size: number, circuit_breaker_threshold: number);
    update_snapshot(total_portfolio_value: number): void;
}

/**
 * Batch calculate equity from balance and unrealized PnL
 */
export function batch_calculate_equity(balances: Float32Array, unrealized_pnl: Float32Array, equity: Float32Array, count: number): void;

/**
 * Calculate margin levels for multiple accounts
 */
export function batch_calculate_margin_levels(equity: Float32Array, margin: Float32Array, margin_level: Float32Array, count: number): void;

/**
 * Batch check accounts for liquidation
 * Returns indices of accounts that need liquidation
 */
export function batch_check_liquidation(margin_levels: Float32Array, liquidation_threshold: number): Uint32Array;

/**
 * Update positions PnL from mark prices
 * This operates directly on SharedArrayBuffer data
 */
export function batch_update_pnl(position_entry: Float32Array, position_quantity: Float32Array, position_side: Uint8Array, position_pnl: Float32Array, mark_price: number, count: number): void;

/**
 * Batch update risk levels based on margin levels
 */
export function batch_update_risk_levels(margin_levels: Float32Array, risk_levels: Uint8Array, liquidation_threshold: number, warning_threshold: number, count: number): void;

/**
 * Calculate LP token value from reserves
 * xy = k formula for constant product AMM
 */
export function calculate_lp_value(reserve_a: bigint, reserve_b: bigint, total_supply: bigint, lp_tokens: bigint): LpValue;

/**
 * Calculate price impact for a swap
 * Returns impact in basis points (100 = 1%)
 */
export function calculate_price_impact(amount_in: bigint, reserve_in: bigint, reserve_out: bigint): number;

/**
 * Calculate swap output for constant product AMM (x * y = k)
 * fee_bps: fee in basis points (30 = 0.3%)
 */
export function calculate_swap_output(amount_in: bigint, reserve_in: bigint, reserve_out: bigint, fee_bps: number): bigint;

/**
 * Convert from one decimal precision to another
 */
export function convert_decimals(amount: bigint, from_decimals: number, to_decimals: number): bigint;

/**
 * Health check - returns true if WASM module is working
 */
export function health_check(): boolean;

/**
 * Initialize the WASM module with panic hook for better error messages
 */
export function init(): void;

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

/**
 * Divide two token amounts with proper decimal handling
 */
export function token_divide(numerator: bigint, denominator: bigint, decimals: number): bigint;

/**
 * Multiply two token amounts with proper decimal handling
 * Returns result in the same decimal precision as input
 */
export function token_multiply(amount_a: bigint, amount_b: bigint, decimals: number): bigint;

/**
 * Calculate percentage (basis points: 10000 = 100%)
 */
export function token_percentage(amount: bigint, bps: number): bigint;

/**
 * Get the version of the WASM core
 */
export function version(): string;
