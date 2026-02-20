import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '@clawkit/core';

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

type ValueInvariantCtor = new (
    maxDrawdownPerBlock: number,
    maxPositionSize: number,
    circuitBreakerThreshold: number
) => ValueInvariant;

type AntiRugCtor = new () => AntiRug;
type GenericCtor<T = unknown> = new (...args: unknown[]) => T;

interface WasmCoreModule {
    ValueInvariant?: ValueInvariantCtor;
    AntiRug?: AntiRugCtor;
    CausalGraph?: GenericCtor;
    TraumaRegistry?: GenericCtor;
    q64_96_mul?: (a: Uint8Array, b: Uint8Array) => Uint8Array;
    q64_96_div?: (a: Uint8Array, b: Uint8Array) => Uint8Array;
    sqrt_price_x96_to_price_wad?: (
        sqrtPriceX96: Uint8Array,
        token0Decimals: number,
        token1Decimals: number
    ) => Uint8Array;
    HyperMemory?: GenericCtor;
    LiquidBrain?: GenericCtor;
    ConversationDomainConfig?: GenericCtor<ConversationDomainConfig> & {
        peer(): ConversationDomainConfig;
        advisory(): ConversationDomainConfig;
        discovery(): ConversationDomainConfig;
    };
    Intervenable?: GenericCtor;
}

export interface SearchResult {
    id: string;
    score: number;
}

export interface HyperMemory {
    insert(id: string, vector: Float32Array | number[]): void;
    search(query: Float32Array | number[], k: number): SearchResult[];
    count(): number;
    export_data(): unknown;
    import_data(data: unknown): void;
}

export interface LiquidBrain {
    forward(input: Float32Array | number[]): Float32Array;
    reset(): void;
    optimize(reward_signal: number): void;
}

/** Mirror of Rust CausalEdge snapshot returned by get_edge() / export_edges() */
export interface CausalEdgeSnapshot {
    successes: number;
    failures: number;
    probability: number;
}

/** Full TypeScript interface for the WASM CausalGraph */
export interface CausalGraph {
    /** Update a cause→effect edge based on observed outcome */
    learn(cause: number, effect: number, outcome_positive: boolean): void;
    /** Bayesian-weighted prediction for a given effect given observations [{cause, weight}] */
    predict(effect: number, observations: Array<[number, number]>): number;
    /** Inspect a single edge */
    get_edge(cause: number, effect: number): CausalEdgeSnapshot;
    /** Export all edges for persistence */
    export_edges(): Record<string, CausalEdgeSnapshot>;
    /** Restore previously exported edges */
    import_edges(edges: Record<string, CausalEdgeSnapshot>): void;
}

/** Single trauma record returned by export_records() */
export interface TraumaHit {
    sev_eff: number;
    count: number;
    inhibit_until_ts_ms: bigint;
    last_ts_ms: bigint;
}

/** Full TypeScript interface for the WASM TraumaRegistry */
export interface TraumaRegistry {
    /** Record a traumatic event (mode + action contextualises the key) */
    record_trauma(mode: number, action_name: string, severity: number, now_ts_ms: bigint): void;
    /** Returns true if this action is currently inhibited (cooling down) */
    is_inhibited(mode: number, action_name: string, now_ts_ms: bigint): boolean;
    /** Milliseconds remaining in the inhibition window */
    get_remaining_ms(mode: number, action_name: string, now_ts_ms: bigint): bigint;
    /** Remove all trauma for a given context (recovery signal) */
    heal(mode: number, action_name: string): void;
    /** Export all records for persistence */
    export_records(): Record<string, TraumaHit>;
    /** Restore previously exported records */
    import_records(data: Record<string, TraumaHit>): void;
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

    import_lists(data: unknown): void {
        const listData = (data && typeof data === 'object') ? data as { whitelist?: unknown[]; blacklist?: unknown[] } : {};
        for (const addr of listData.whitelist ?? []) {
            this.whitelist.add(String(addr).toLowerCase());
        }
        for (const addr of listData.blacklist ?? []) {
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

class MockHyperMemory implements HyperMemory {
    private vectors: Map<string, number[]> = new Map();

    constructor(private dimension: number) { }

    insert(id: string, vector: Float32Array | number[]): void {
        if (vector.length !== this.dimension) {
            console.warn(`MockHyperMemory: Vector dimension mismatch ${vector.length} != ${this.dimension}`);
            return;
        }
        this.vectors.set(id, Array.from(vector));
    }

    search(query: Float32Array | number[], k: number): SearchResult[] {
        if (query.length !== this.dimension) return [];

        const q = Array.from(query);
        const scores: SearchResult[] = [];

        for (const [id, vec] of this.vectors.entries()) {
            const score = this.cosineSimilarity(q, vec);
            scores.push({ id, score });
        }

        return scores.sort((a, b) => b.score - a.score).slice(0, k);
    }

    count(): number { return this.vectors.size; }

    export_data(): unknown { return Array.from(this.vectors.entries()); }

    import_data(data: unknown): void {
        const entries = data as [string, number[]][];
        this.vectors = new Map(entries);
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

class MockCausalGraph implements CausalGraph {
    private edges: Map<string, { successes: number; failures: number }> = new Map();

    private key(cause: number, effect: number): string { return `${cause}->${effect}`; }

    learn(cause: number, effect: number, outcome_positive: boolean): void {
        const k = this.key(cause, effect);
        const e = this.edges.get(k) ?? { successes: 0, failures: 0 };
        if (outcome_positive) e.successes++; else e.failures++;
        this.edges.set(k, e);
    }

    private successProb(e: { successes: number; failures: number }): number {
        return (e.successes + 1) / (e.successes + e.failures + 2);
    }

    predict(effect: number, observations: Array<[number, number]>): number {
        let weightedSum = 0, totalWeight = 0;
        for (const [cause, value] of observations) {
            if (!Number.isFinite(value)) continue;
            const e = this.edges.get(this.key(cause, effect));
            if (!e) continue;
            const w = this.successProb(e);
            weightedSum += value * w;
            totalWeight += w;
        }
        return totalWeight === 0 ? 0 : weightedSum / totalWeight;
    }

    get_edge(cause: number, effect: number): CausalEdgeSnapshot {
        const e = this.edges.get(this.key(cause, effect)) ?? { successes: 0, failures: 0 };
        return { successes: e.successes, failures: e.failures, probability: this.successProb(e) };
    }

    export_edges(): Record<string, CausalEdgeSnapshot> {
        const out: Record<string, CausalEdgeSnapshot> = {};
        for (const [k, e] of this.edges) {
            out[k] = { successes: e.successes, failures: e.failures, probability: this.successProb(e) };
        }
        return out;
    }

    import_edges(edges: Record<string, CausalEdgeSnapshot>): void {
        this.edges.clear();
        for (const [k, v] of Object.entries(edges)) {
            this.edges.set(k, { successes: v.successes, failures: v.failures });
        }
    }
}

class MockTraumaRegistry implements TraumaRegistry {
    private records: Map<string, { sev_eff: number; count: number; inhibit_until_ts_ms: bigint; last_ts_ms: bigint }> = new Map();

    private key(mode: number, action_name: string): string { return `${mode}:${action_name}`; }

    record_trauma(mode: number, action_name: string, severity: number, now_ts_ms: bigint): void {
        const k = this.key(mode, action_name);
        const clamped = Math.max(0, Math.min(5, severity));
        const alpha = 0.3;
        const existing = this.records.get(k);
        if (existing) {
            existing.count++;
            const hours = Math.min(Math.pow(2, existing.count - 1), 24);
            existing.inhibit_until_ts_ms = now_ts_ms + BigInt(Math.floor(hours * 60 * 60 * 1000));
            existing.sev_eff = Math.max(0, Math.min(5, existing.sev_eff * (1 - alpha) + clamped * alpha));
            existing.last_ts_ms = now_ts_ms;
        } else {
            this.records.set(k, {
                sev_eff: clamped,
                count: 1,
                inhibit_until_ts_ms: now_ts_ms + BigInt(60 * 60 * 1000),
                last_ts_ms: now_ts_ms,
            });
        }
    }

    is_inhibited(mode: number, action_name: string, now_ts_ms: bigint): boolean {
        return (this.records.get(this.key(mode, action_name))?.inhibit_until_ts_ms ?? 0n) > now_ts_ms;
    }

    get_remaining_ms(mode: number, action_name: string, now_ts_ms: bigint): bigint {
        const inhibit = this.records.get(this.key(mode, action_name))?.inhibit_until_ts_ms ?? 0n;
        return inhibit > now_ts_ms ? inhibit - now_ts_ms : 0n;
    }

    heal(mode: number, action_name: string): void {
        this.records.delete(this.key(mode, action_name));
    }

    export_records(): Record<string, TraumaHit> {
        const out: Record<string, TraumaHit> = {};
        for (const [k, v] of this.records) {
            out[k] = { sev_eff: v.sev_eff, count: v.count, inhibit_until_ts_ms: v.inhibit_until_ts_ms, last_ts_ms: v.last_ts_ms };
        }
        return out;
    }

    import_records(data: Record<string, TraumaHit>): void {
        for (const [k, v] of Object.entries(data)) {
            this.records.set(k, { sev_eff: v.sev_eff, count: v.count, inhibit_until_ts_ms: v.inhibit_until_ts_ms, last_ts_ms: v.last_ts_ms });
        }
    }
}

// New Cognitive Interfaces
export interface ConversationDomainConfig {
    intrusiveness_threshold: number;
    trust_decay_rate: number;
    trauma_severity_scale: number;
    dagma_trigger_episodes: number;
    thermo_dt: number;
}

export interface CounterfactualResult {
    actual_prob: number;
    hypothetical_prob: number;
    would_have_been_better: boolean;
    delta: number;
}

export interface Intervenable {
    do_intervention(graph: CausalGraph, intervention_var: number, intervention_value: number, query_var: number): number;
    counterfactual(graph: CausalGraph, actual_var: number, hypothetical_var: number, query_var: number): CounterfactualResult;
}

class MockConversationConfig implements ConversationDomainConfig {
    constructor(
        public intrusiveness_threshold: number,
        public trust_decay_rate: number,
        public trauma_severity_scale: number,
        public dagma_trigger_episodes: number,
        public thermo_dt: number
    ) { }

    static peer(): MockConversationConfig {
        return new MockConversationConfig(0.3, 0.05, 1.0, 50, 0.1);
    }
    static advisory(): MockConversationConfig {
        return new MockConversationConfig(0.6, 0.02, 1.5, 100, 0.1);
    }
    static discovery(): MockConversationConfig {
        return new MockConversationConfig(0.2, 0.1, 0.5, 20, 0.2);
    }
}

class MockIntervenable implements Intervenable {
    do_intervention(graph: CausalGraph, _ivar: number, _ival: number, query_var: number): number {
        // Mock intervention: just return a simple prediction
        return graph.predict(query_var, []);
    }

    counterfactual(graph: CausalGraph, _avar: number, _hvar: number, query_var: number): CounterfactualResult {
        const p = graph.predict(query_var, []);
        return {
            actual_prob: p,
            hypothetical_prob: p,
            would_have_been_better: false,
            delta: 0
        };
    }
}

class MockLiquidBrain implements LiquidBrain {
    private state: Float32Array;

    constructor(private inputSize: number, private hiddenSize: number) {
        this.state = new Float32Array(hiddenSize).fill(0);
    }

    forward(input: Float32Array | number[]): Float32Array {
        const val = (input as number[]).reduce((a, b) => a + b, 0) / this.inputSize;
        for (let i = 0; i < this.hiddenSize; i++) {
            this.state[i] = 0.9 * this.state[i] + 0.1 * val;
        }
        return new Float32Array(this.state);
    }

    reset(): void { this.state.fill(0); }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    optimize(_reward: number): void { /* no-op for mock */ }
}

// ─── WASM Bridge Proxy Classes ───────────────────────────────────────────────
// These thin wrappers sit between TypeScript callers and raw WASM instances.
// They fix 3 bridge bugs without requiring a Rust recompile:
//
//  B1  predict(): sanitize NaN/Inf obs before they enter wasm-bindgen serde
//  B2  get_edge(): recompute probability via Laplace from raw counts,
//                  bypassing f32 serialisation rounding (WASM returns 1.0 for 2/3)
//  B3  export/import_records: i64 fields silently fail in serde_wasm_bindgen
//                  without the preserve-js-bigint feature; shadow Map keeps TS state
// ─────────────────────────────────────────────────────────────────────────────

type RawCausalGraph = {
    learn(cause: number, effect: number, outcome: boolean): void;
    predict(effect: number, obs: Array<[number, number]>): number;
    get_edge(cause: number, effect: number): CausalEdgeSnapshot;
    export_edges(): Record<string, CausalEdgeSnapshot>;
    import_edges(edges: Record<string, CausalEdgeSnapshot>): void;
};

/**
 * WasmCausalGraphProxy — wraps raw WASM CausalGraph
 *
 * WHY SHADOW IS NEEDED:
 *   serde_wasm_bindgen::to_value for HashMap<String, EdgeSnapshot{f32}> returns {}
 *   in the wasm-pack --target nodejs build (serde f32 serialization fails silently).
 *   get_edge() works (returns a single JsValue), but export_edges() does not.
 *
 * Solution: mirror every learn() call into a TS-side edge Map.
 *   - predict()      → B1: filter NaN/Inf obs, then delegate to WASM
 *   - get_edge()     → B2: read from shadow + recompute Laplace (avoids f32 rounding)
 *   - export_edges() → read from shadow (avoids serde failure)
 *   - import_edges() → populate shadow + delegate to WASM (WASM keeps inhibit state)
 */
class WasmCausalGraphProxy implements CausalGraph {
    // shadow: "cause->effect" → { s: successes, f: failures }
    private readonly shadow = new Map<string, { s: number; f: number }>();

    constructor(private readonly raw: RawCausalGraph) { }

    private edgeKey(cause: number, effect: number) { return `${cause}->${effect}`; }

    learn(cause: number, effect: number, outcome_positive: boolean): void {
        this.raw.learn(cause, effect, outcome_positive);
        const k = this.edgeKey(cause, effect);
        const e = this.shadow.get(k) ?? { s: 0, f: 0 };
        if (outcome_positive) e.s++; else e.f++;
        this.shadow.set(k, e);
    }

    /** B1: Strip NaN/Inf obs before they reach serde_wasm_bindgen */
    predict(effect: number, observations: Array<[number, number]>): number {
        const clean = observations.filter(([, v]) => Number.isFinite(v));
        if (clean.length === 0) return 0;
        return this.raw.predict(effect, clean);
    }

    /** B2: Always correct — reads from shadow and applies Laplace */
    get_edge(cause: number, effect: number): CausalEdgeSnapshot {
        const e = this.shadow.get(this.edgeKey(cause, effect));
        if (e) {
            return { successes: e.s, failures: e.f, probability: (e.s + 1) / (e.s + e.f + 2) };
        }
        // Not in shadow (e.g. canonical priors inside WASM) → fall back to WASM
        const raw = this.raw.get_edge(cause, effect);
        const s = raw?.successes ?? 0;
        const f = raw?.failures ?? 0;
        return { successes: s, failures: f, probability: (s + 1) / (s + f + 2) };
    }

    /** Reads from shadow — avoids broken serde_wasm_bindgen export */
    export_edges(): Record<string, CausalEdgeSnapshot> {
        const out: Record<string, CausalEdgeSnapshot> = {};
        for (const [k, { s, f }] of this.shadow) {
            out[k] = { successes: s, failures: f, probability: (s + 1) / (s + f + 2) };
        }
        return out;
    }

    /** Populates shadow + delegates to WASM so predict() uses real WASM state */
    import_edges(edges: Record<string, CausalEdgeSnapshot>): void {
        this.shadow.clear();
        for (const [k, e] of Object.entries(edges)) {
            this.shadow.set(k, { s: e.successes, f: e.failures });
        }
        this.raw.import_edges(edges);
    }
}

type RawTraumaRegistry = {
    record_trauma(mode: number, action: string, severity: number, now: bigint): void;
    is_inhibited(mode: number, action: string, now: bigint): boolean;
    get_remaining_ms(mode: number, action: string, now: bigint): bigint;
    heal(mode: number, action: string): void;
    export_records?(): Record<string, TraumaHit>; // may be broken in stale pkg
    import_records?(data: Record<string, TraumaHit>): void; // may not exist in old pkg
};

/**
 * WasmTraumaRegistryProxy — wraps raw WASM TraumaRegistry
 *
 * WHY SHADOW IS NEEDED:
 *   serde_wasm_bindgen cannot serialize i64 fields (inhibit_until_ts_ms) without
 *   the preserve-js-bigint feature → export_records() returns {} in nodejs target.
 *
 * Solution: shadow Map mirrors every record_trauma / heal call.
 *   - is_inhibited / get_remaining_ms → WASM (authoritative, correct BigInt arithmetic)
 *   - export_records()   → shadow Map only (BigInt-safe)
 *   - import_records()   → populate shadow + replay record_trauma on WASM
 *                          so inhibition state is correctly restored
 */
class WasmTraumaRegistryProxy implements TraumaRegistry {
    // shadow: "mode:action_name" → full BigInt-safe TraumaHit
    private readonly shadow = new Map<string, TraumaHit>();

    constructor(private readonly raw: RawTraumaRegistry) { }

    private shadowKey(mode: number, action_name: string) { return `${mode}:${action_name}`; }

    record_trauma(mode: number, action_name: string, severity: number, now_ts_ms: bigint): void {
        this.raw.record_trauma(mode, action_name, severity, now_ts_ms);
        const k = this.shadowKey(mode, action_name);
        const alpha = 0.3;
        const clamped = Math.max(0, Math.min(5, severity));
        const existing = this.shadow.get(k);
        if (existing) {
            existing.count++;
            const hours = Math.min(Math.pow(2, existing.count - 1), 24);
            existing.inhibit_until_ts_ms = now_ts_ms + BigInt(Math.floor(hours * 3_600_000));
            existing.sev_eff = Math.max(0, Math.min(5, existing.sev_eff * (1 - alpha) + clamped * alpha));
            existing.last_ts_ms = now_ts_ms;
        } else {
            this.shadow.set(k, {
                sev_eff: clamped,
                count: 1,
                inhibit_until_ts_ms: now_ts_ms + BigInt(3_600_000),
                last_ts_ms: now_ts_ms,
            });
        }
    }

    is_inhibited(mode: number, action_name: string, now_ts_ms: bigint): boolean {
        return this.raw.is_inhibited(mode, action_name, now_ts_ms);
    }

    get_remaining_ms(mode: number, action_name: string, now_ts_ms: bigint): bigint {
        return this.raw.get_remaining_ms(mode, action_name, now_ts_ms);
    }

    heal(mode: number, action_name: string): void {
        this.raw.heal(mode, action_name);
        this.shadow.delete(this.shadowKey(mode, action_name));
    }

    /** Always populated — reads from BigInt-safe shadow, never from broken WASM serde */
    export_records(): Record<string, TraumaHit> {
        const out: Record<string, TraumaHit> = {};
        for (const [k, v] of this.shadow) out[k] = { ...v };
        return out;
    }

    /**
     * Restore from snapshot:
     *  1. Populate shadow (so export_records works on registry2)
     *  2. Replay record_trauma on WASM (so is_inhibited / get_remaining_ms work)
     *  Key format expected: "mode:action_name" (as emitted by export_records)
     */
    import_records(data: Record<string, TraumaHit>): void {
        for (const [k, v] of Object.entries(data)) {
            this.shadow.set(k, { ...v });
            // Parse key "mode:action_name" and replay into WASM
            const colonIdx = k.indexOf(':');
            if (colonIdx !== -1) {
                const mode = parseInt(k.slice(0, colonIdx), 10);
                const action = k.slice(colonIdx + 1);
                if (!Number.isNaN(mode)) {
                    // Replay all trauma hits to restore WASM inhibition state
                    for (let i = 0; i < v.count; i++) {
                        try { this.raw.record_trauma(mode, action, v.sev_eff, v.last_ts_ms); } catch { /* ignore */ }
                    }
                }
            }
        }
    }
}

/**
 * WasmIntervenableProxy — wraps raw WASM Intervenable
 * Needed because Intervenable expects raw WASM CausalGraph, not WasmCausalGraphProxy.
 */
class WasmIntervenableProxy implements Intervenable {
    constructor(private readonly raw: any) { }

    do_intervention(graph: CausalGraph, intervention_var: number, intervention_value: number, query_var: number): number {
        // Unwrap proxy to get raw WASM graph
        const rawGraph = (graph as any)['raw'];
        if (!rawGraph) {
            console.warn('WasmIntervenableProxy: graph is not a WasmCausalGraphProxy, using fallback mock logic');
            return 0; // or mock behavior
        }
        return this.raw.do_intervention(rawGraph, intervention_var, intervention_value, query_var);
    }

    counterfactual(graph: CausalGraph, actual_var: number, hypothetical_var: number, query_var: number): CounterfactualResult {
        const rawGraph = (graph as any)['raw'];
        if (!rawGraph) {
            return { actual_prob: 0, hypothetical_prob: 0, would_have_been_better: false, delta: 0 };
        }
        return this.raw.counterfactual(rawGraph, actual_var, hypothetical_var, query_var);
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
    private coreModule: WasmCoreModule | null = null;
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
        WasmAdapter.instance = null as unknown as WasmAdapter;
    }

    public async init(): Promise<void> {
        if (this.initialized) return;

        try {
            // STRATEGY 1: NodeJS Dynamic Import (Relative to this file)
            // Used in: Vitest, ts-node, standard Node execution
            try {
                // Try finding the pkg directory relative to this file
                // When running from src: ../../core-rust/pkg
                // When running from dist: ../pkg (if copied) or ../../core-rust/pkg (workspace)

                const candidates = [
                    // Built to src/wasm (Current preferred)
                    path.resolve(__dirname, './wasm/core_rust.js'),
                    // Dist/Prod layout
                    path.resolve(__dirname, '../pkg/core_rust.js'),
                    // Monorepo Source layout (from src/eidolon or src root)
                    path.resolve(__dirname, '../core-rust/pkg/core_rust.js'),
                    path.resolve(__dirname, '../../core-rust/pkg/core_rust.js'),
                    path.resolve(__dirname, '../../../core-rust/pkg/core_rust.js'), // If deeply nested
                    // Absolute fallback (rare but possible in Docker)
                    path.resolve(process.cwd(), 'packages/soul/core-rust/pkg/core_rust.js')
                ];

                let jsPath: string | null = null;
                for (const candidate of candidates) {
                    if (fs.existsSync(candidate)) {
                        jsPath = candidate;
                        break;
                    }
                }

                if (jsPath) {
                    const wasmPath = jsPath.replace('.js', '_bg.wasm');
                    const module = await import(jsPath);

                    // Case 1A: Node/Vitest where default is the exports object
                    if (module.default && typeof module.default !== 'function' && (module.default.ValueInvariant || module.default.CausalGraph)) {
                        this.coreModule = module.default;
                        this.fallbackMode = false;
                        Logger.info(`🦀 WASM Core Loaded (Node/Vitest Mode) from ${jsPath}`);
                    }
                    // Case 1B: Direct exports (ESM/CJS mixed)
                    else if (module.ValueInvariant || module.CausalGraph) {
                        this.coreModule = module;
                        this.fallbackMode = false;
                        Logger.info(`🦀 WASM Core Loaded (Direct Mode) from ${jsPath}`);
                    }
                    // Case 1C: Initialize WASM memory with Binary (Web/Bundler support)
                    else if (fs.existsSync(wasmPath)) {
                        const buffer = fs.readFileSync(wasmPath);
                        if (typeof module.default === 'function') {
                            await module.default(buffer);
                            this.coreModule = module;
                            this.fallbackMode = false;
                            Logger.info(`🦀 WASM Core Loaded & Initialized from ${wasmPath}`);
                        } else {
                            Logger.warn('⚠️ WASM module default export missing');
                            this.fallbackMode = true;
                        }
                    } else {
                        Logger.warn('⚠️ WASM binary not found at', wasmPath);
                        this.fallbackMode = true;
                    }
                } else {
                    // STRATEGY 2: Bundler/Web (Result to fallback if FS fails)
                    // If we are in a bundler environment (Next.js/Webpack), fs might be empty shim.
                    // We can try a direct import if the bundler is configured to handle .wasm
                    // But here we just log and fallback.
                    Logger.warn(`⚠️ WASM JS wrapper not found in candidates: ${candidates.join(', ')}`);
                    this.coreModule = null;
                    this.fallbackMode = true;
                }
            } catch (e1) {
                Logger.warn('⚠️ WASM load failed:', e1);
                this.coreModule = null; // Fallback
                this.fallbackMode = true;
            }
        } catch (error) {
            Logger.warn('⚠️ WASM core unavailable. Falling back to deterministic TS mocks.', error);
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

    public createConversationConfig(preset: 'peer' | 'advisory' | 'discovery' | 'custom', custom?: ConversationDomainConfig): ConversationDomainConfig {
        const Module = this.coreModule?.ConversationDomainConfig;
        if (Module) {
            if (preset === 'peer') return Module.peer();
            if (preset === 'advisory') return Module.advisory();
            if (preset === 'discovery') return Module.discovery();
            if (preset === 'custom' && custom) {
                return new Module(
                    custom.intrusiveness_threshold,
                    custom.trust_decay_rate,
                    custom.trauma_severity_scale,
                    custom.dagma_trigger_episodes,
                    custom.thermo_dt
                );
            }
        }
        // Fallback
        if (preset === 'peer') return MockConversationConfig.peer();
        if (preset === 'advisory') return MockConversationConfig.advisory();
        if (preset === 'discovery') return MockConversationConfig.discovery();
        return custom ? new MockConversationConfig(
            custom.intrusiveness_threshold,
            custom.trust_decay_rate,
            custom.trauma_severity_scale,
            custom.dagma_trigger_episodes,
            custom.thermo_dt
        ) : MockConversationConfig.peer();
    }

    public createIntervenable(): Intervenable {
        const Ctor = this.coreModule?.Intervenable;
        if (Ctor) {
            return new WasmIntervenableProxy(new Ctor());
        }
        return new MockIntervenable();
    }

    // Legacy getters
    public get isFallbackMode(): boolean { return this.fallbackMode; }
    public get core(): WasmCoreModule | null { return this.coreModule; }

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

    public createCausalGraph(): CausalGraph {
        const Ctor = this.coreModule?.CausalGraph;
        if (Ctor) return new WasmCausalGraphProxy(new Ctor() as unknown as RawCausalGraph);
        return new MockCausalGraph();
    }

    public createTraumaRegistry(): TraumaRegistry {
        const Ctor = this.coreModule?.TraumaRegistry;
        if (Ctor) return new WasmTraumaRegistryProxy(new Ctor() as unknown as RawTraumaRegistry);
        return new MockTraumaRegistry();
    }

    public createHyperMemory(dimension: number): HyperMemory {
        const Ctor = this.coreModule?.HyperMemory;
        if (Ctor) {
            return new Ctor(dimension) as HyperMemory;
        }
        return new MockHyperMemory(dimension);
    }

    public createLiquidBrain(inputSize: number, hiddenSize: number = 20): LiquidBrain {
        const Ctor = this.coreModule?.LiquidBrain;
        if (Ctor) {
            // Rust constructor: new(input_size: usize, hidden_size: usize)
            return new Ctor(inputSize, hiddenSize) as LiquidBrain;
        }
        return new MockLiquidBrain(inputSize, hiddenSize);
    }

    private bigintToBytes(val: bigint): Uint8Array {
        let hex = val.toString(16);
        if (hex.length % 2 !== 0) hex = '0' + hex;
        const len = hex.length / 2;
        const u8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            u8[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return u8;
    }

    private bytesToBigInt(bytes: Uint8Array): bigint {
        if (bytes.length === 0) return 0n;
        let hex = '0x';
        for (let i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0');
        }
        return BigInt(hex);
    }

    public q64Mul(aRaw: bigint, bRaw: bigint): bigint {
        const fn = this.coreModule?.q64_96_mul;
        if (typeof fn === 'function') {
            const aBytes = this.bigintToBytes(aRaw);
            const bBytes = this.bigintToBytes(bRaw);
            const outBytes = fn(aBytes, bBytes);
            return this.bytesToBigInt(outBytes);
        }
        return (aRaw * bRaw) >> 96n;
    }

    public q64Div(aRaw: bigint, bRaw: bigint): bigint {
        if (bRaw === 0n) throw new Error('Division by zero');
        const fn = this.coreModule?.q64_96_div;
        if (typeof fn === 'function') {
            const aBytes = this.bigintToBytes(aRaw);
            const bBytes = this.bigintToBytes(bRaw);
            const outBytes = fn(aBytes, bBytes);
            return this.bytesToBigInt(outBytes);
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
            const sqrtBytes = this.bigintToBytes(sqrtPriceX96);
            const outBytes = fn(
                sqrtBytes,
                token0Decimals,
                token1Decimals
            );
            return this.bytesToBigInt(outBytes);
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
