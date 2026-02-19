/**
 * 🦀 Phase 4: WASM Bridge Regression Tests
 *
 * All 3 bugs (B1/B2/B3) are fixed via TS proxy wrappers. These tests now assert
 * the CORRECT behavior and will catch any regression.
 *
 * Bug history:
 *  B1: predict() — NaN obs → proxy filters before WASM call → result always finite
 *  B2: get_edge() probability — proxy recomputes via Laplace from raw counts → correct
 *  B3: export_records() empty → proxy shadow Map → always populated correctly
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    WasmAdapter,
    ValueInvariant,
    AntiRug,
    CausalGraph,
    TraumaRegistry,
} from '../../packages/soul/src/WasmAdapter';

let adapter: WasmAdapter;

beforeEach(async () => {
    WasmAdapter.resetInstance();
    adapter = WasmAdapter.getInstance();
    await adapter.init();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. ValueInvariant
// ─────────────────────────────────────────────────────────────────────────────

describe('ValueInvariant Bridge', () => {
    let inv: ValueInvariant;

    beforeEach(() => {
        inv = adapter.createValueInvariant(5, 10_000, 15);
        inv.update_snapshot(100_000);
    });

    it('allows a safe trade', () => {
        const r = inv.check_invariant(5_000, 2_000);
        expect(r.safe).toBe(true);
        expect(r.circuit_broken).toBe(false);
    });

    it('blocks trade exceeding max position size', () => {
        const r = inv.check_invariant(15_000, 1_000);
        expect(r.safe).toBe(false);
        expect(r.reason).toMatch(/INVARIANT_BREACH|Max/);
        expect(r.circuit_broken).toBe(false);
    });

    it('triggers soft drawdown warning', () => {
        const r = inv.check_invariant(5_000, 7_000);
        expect(r.safe).toBe(false);
        expect(r.reason).toMatch(/RISK_WARNING|drawdown/i);
        expect(r.circuit_broken).toBe(false);
    });

    it('triggers circuit breaker for extreme drawdown', () => {
        const r = inv.check_invariant(5_000, 20_000);
        expect(r.safe).toBe(false);
        expect(r.circuit_broken).toBe(true);
    });

    it('rejects NaN trade value (fail-closed, no throw)', () => {
        expect(() => inv.check_invariant(NaN, 1_000)).not.toThrow();
        expect(inv.check_invariant(NaN, 1_000).safe).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AntiRug
// ─────────────────────────────────────────────────────────────────────────────

describe('AntiRug Bridge', () => {
    let rug: AntiRug;
    const HONEYPOT = '0xdeadc0de0000000000000000000000000000dead';
    const SAFE = '0x2170ed0880ac9a755fd29b2688956bd959f933f8';
    const UNKNOWN = '0xaabbccdd0000000000000000000000000000ffff';

    beforeEach(() => { rug = adapter.createAntiRug(); });

    it('blacklist → score 0', () => {
        rug.add_to_blacklist(HONEYPOT);
        const s = rug.compute_score(HONEYPOT, {
            is_honeypot: false, honeypot_with_same_creator: false,
            buy_tax: '0', sell_tax: '0', cannot_buy: false, cannot_sell_all: false,
            is_blacklisted: false, is_whitelisted: false, is_open_source: true,
            is_proxy: false, is_mintable: false, owner_change_balance: false,
            owner_address: '', creator_address: '',
        });
        expect(s.score).toBe(0);
        expect(s.status).toMatch(/BLACKLISTED|DANGER/);
    });

    it('whitelist → score 100', () => {
        rug.add_to_whitelist(SAFE);
        const s = rug.compute_score(SAFE, {
            is_honeypot: false, honeypot_with_same_creator: false,
            buy_tax: '50', sell_tax: '50', cannot_buy: false, cannot_sell_all: false,
            is_blacklisted: false, is_whitelisted: false, is_open_source: false,
            is_proxy: true, is_mintable: true, owner_change_balance: false,
            owner_address: '0xsomeone', creator_address: '',
        });
        expect(s.score).toBe(100);
    });

    it('is_honeypot → instant score 0', () => {
        const s = rug.compute_score(UNKNOWN, {
            is_honeypot: true, honeypot_with_same_creator: false,
            buy_tax: '0', sell_tax: '0', cannot_buy: false, cannot_sell_all: false,
            is_blacklisted: false, is_whitelisted: false, is_open_source: true,
            is_proxy: false, is_mintable: false, owner_change_balance: false,
            owner_address: '', creator_address: '',
        });
        expect(s.score).toBe(0);
        expect(s.is_honeypot).toBe(true);
    });

    it('open source + renounced + locked liquidity → SAFE (≥80)', () => {
        const s = rug.compute_score(UNKNOWN, {
            is_honeypot: false, honeypot_with_same_creator: false,
            buy_tax: '0', sell_tax: '0', cannot_buy: false, cannot_sell_all: false,
            is_blacklisted: false, is_whitelisted: false, is_open_source: true,
            is_proxy: false, is_mintable: false, owner_change_balance: false,
            owner_address: '0x0000000000000000000000000000000000000000',
            creator_address: '', liquidity_locked: true,
        });
        expect(s.score).toBeGreaterThanOrEqual(80);
        expect(s.status).toMatch(/SAFE/);
    });

    it('export_lists / import_lists round-trip', () => {
        rug.add_to_whitelist(SAFE);
        rug.add_to_blacklist(HONEYPOT);
        const exported = rug.export_lists() as { whitelist: string[]; blacklist: string[] };
        const rug2 = adapter.createAntiRug();
        rug2.import_lists(exported);
        const s = rug2.compute_score(SAFE, {
            is_honeypot: false, honeypot_with_same_creator: false,
            buy_tax: '99', sell_tax: '99', cannot_buy: false, cannot_sell_all: false,
            is_blacklisted: false, is_whitelisted: false, is_open_source: false,
            is_proxy: false, is_mintable: false, owner_change_balance: false,
            owner_address: '', creator_address: '',
        });
        expect(s.score).toBe(100);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CausalGraph — B1 + B2 fixed by WasmCausalGraphProxy
// ─────────────────────────────────────────────────────────────────────────────

describe('CausalGraph Bridge', () => {
    let graph: CausalGraph;

    beforeEach(() => { graph = adapter.createCausalGraph(); });

    it('learn records outcomes correctly', () => {
        for (let i = 0; i < 10; i++) graph.learn(0, 1, true);
        graph.learn(0, 1, false);
        const edge = graph.get_edge(0, 1);
        expect(edge.successes).toBe(10);
        expect(edge.failures).toBe(1);
        // Laplace: (10+1)/(10+1+2) = 11/13 ≈ 0.846
        expect(edge.probability).toBeCloseTo(11 / 13, 3);
    });

    it('predict with no known edges returns 0', () => {
        expect(graph.predict(99, [[200, 1.0]])).toBe(0);
    });

    /**
     * B1 FIXED: WasmCausalGraphProxy.predict() strips NaN/Inf before WASM call.
     * Result MUST be 0 (all obs filtered) or a valid finite number.
     */
    it('B1 fixed: predict with all-NaN obs returns 0 (proxy filters them)', () => {
        graph.learn(0, 1, true);
        const result = graph.predict(1, [[0, NaN], [0, Infinity]]);
        expect(result).toBe(0); // all obs stripped → no edges matched → 0
    });

    it('export_edges / import_edges round-trip', () => {
        graph.learn(1, 2, true);
        graph.learn(1, 2, true);
        graph.learn(1, 2, false);
        const exported = graph.export_edges();

        const graph2 = adapter.createCausalGraph();
        graph2.import_edges(exported);
        const edge = graph2.get_edge(1, 2);
        expect(edge.successes).toBe(2);
        expect(edge.failures).toBe(1);
        expect(edge.probability).toBeGreaterThan(0.5);
    });

    /**
     * B2 FIXED: WasmCausalGraphProxy.get_edge() recomputes probability from
     * raw counts via Laplace — never returns 1.0 for a single-success edge.
     */
    it('B2 fixed: Laplace probability (1 success, 0 failures) ≈ 0.667, not 1.0', () => {
        graph.learn(7, 9, true); // edge (7,9): no canonical prior
        const edge = graph.get_edge(7, 9);
        expect(edge.successes).toBe(1);
        expect(edge.failures).toBe(0);
        // (1+1)/(1+0+2) = 2/3
        expect(edge.probability).toBeCloseTo(2 / 3, 3);
        expect(edge.probability).toBeLessThan(1.0); // never overconfident
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. TraumaRegistry — B3 fixed by WasmTraumaRegistryProxy shadow Map
// ─────────────────────────────────────────────────────────────────────────────

describe('TraumaRegistry Bridge', () => {
    let registry: TraumaRegistry;
    const NOW = BigInt(Date.now());
    const ONE_HOUR = 60n * 60n * 1000n;

    beforeEach(() => { registry = adapter.createTraumaRegistry(); });

    it('first trauma inhibits for ~1 hour', () => {
        registry.record_trauma(0, 'SELL', 3.0, NOW);
        expect(registry.is_inhibited(0, 'SELL', NOW)).toBe(true);
        expect(registry.is_inhibited(0, 'SELL', NOW + 2n * ONE_HOUR)).toBe(false);
    });

    it('inhibition window grows on repeat trauma', () => {
        registry.record_trauma(0, 'SELL', 3.0, NOW);
        const r1 = registry.get_remaining_ms(0, 'SELL', NOW);
        registry.record_trauma(0, 'SELL', 3.0, NOW);
        const r2 = registry.get_remaining_ms(0, 'SELL', NOW);
        expect(r2 > r1).toBe(true);
    });

    it('heal removes inhibition immediately', () => {
        registry.record_trauma(1, 'BUY', 5.0, NOW);
        expect(registry.is_inhibited(1, 'BUY', NOW)).toBe(true);
        registry.heal(1, 'BUY');
        expect(registry.is_inhibited(1, 'BUY', NOW)).toBe(false);
    });

    it('different mode/action keys are independent', () => {
        registry.record_trauma(0, 'SELL', 5.0, NOW);
        expect(registry.is_inhibited(1, 'SELL', NOW)).toBe(false);
        expect(registry.is_inhibited(0, 'BUY', NOW)).toBe(false);
    });

    /**
     * B3 FIXED: WasmTraumaRegistryProxy.export_records() reads from shadow Map.
     * Result is always populated — no dependency on broken WASM i64 serialization.
     */
    it('B3 fixed: export_records returns populated snapshot (shadow Map)', () => {
        registry.record_trauma(0, 'SELL', 2.5, NOW);
        const snapshot = registry.export_records();
        expect(Object.keys(snapshot).length).toBeGreaterThan(0);
        const hit = snapshot['0:SELL'];
        expect(hit).toBeDefined();
        expect(hit.sev_eff).toBeCloseTo(2.5, 2);
        expect(hit.count).toBe(1);
    });

    it('export_records / import_records full round-trip', () => {
        registry.record_trauma(0, 'SELL', 2.5, NOW);
        const snapshot = registry.export_records();

        const registry2 = adapter.createTraumaRegistry();
        registry2.import_records(snapshot);

        // After import, shadow is populated → export_records works
        const restored = registry2.export_records();
        expect(restored['0:SELL']).toBeDefined();

        // Also: WASM inhibition state should be restored via import
        // (if WASM import_records is available in pkg — proxy attempts it silently)
        expect(registry2.is_inhibited(0, 'SELL', NOW)).toBe(true);
    });
});
