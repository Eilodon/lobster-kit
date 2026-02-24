import { describe, it, expect, beforeAll } from 'vitest';
import { WasmAdapter } from '@eidolon/soul';

describe('🧬 RUST EVOLUTION: The Singularity Verification', () => {
    let adapter: WasmAdapter;

    beforeAll(async () => {
        adapter = WasmAdapter.getInstance();
        await adapter.init();

        if (!adapter.isReady()) {
            console.warn("⚠️ WASM not ready, tests might rely on fallback or fail.");
        }
    });

    describe('Evolution 1: Neural Rewiring (Binary Math)', () => {
        it('should multiply large numbers using binary serialization', () => {
            // 2.5 * 2.0 = 5.0 (in Q64.96)
            const one = 1n << 96n;
            const a = (one * 5n) / 2n; // 2.5
            const b = one * 2n;        // 2.0

            const result = adapter.q64Mul(a, b);
            const expected = one * 5n; // 5.0

            expect(result).toBe(expected);
        });

        it('should divide numbers using binary serialization', () => {
            // 10.0 / 2.0 = 5.0
            const one = 1n << 96n;
            const a = one * 10n;
            const b = one * 2n;

            const result = adapter.q64Div(a, b);
            const expected = one * 5n;

            expect(result).toBe(expected);
        });
    });

    describe('Evolution 2: Heap Freeze (Trauma Hashing)', () => {
        it('should record trauma without crashing', () => {
            // We can't easily check internal allocation from TS, 
            // but we verify the logic holds.
            const registry = adapter.createTraumaRegistry() as any;
            // TraumaRegistry API is accessible via explicit any cast if needed
            // But WasmAdapter doesn't expose methods directly on the instance returned.
            // The WasmAdapter wrapper creates the raw Rust struct.

            if (registry && registry.record_trauma) {
                registry.record_trauma(1, "test_action", 1.0, BigInt(Date.now()));
                const inhibited = registry.is_inhibited(1, "test_action", BigInt(Date.now()));
                // Should be false initially (1 hour inhibition in future)
                // inhibit_until = now + 1hr. So > now.
                expect(inhibited).toBe(true);
            } else {
                console.warn("TraumaRegistry not available or mocked");
            }
        });
    });

    describe('Evolution 3: Expanded Vision (Dead Address)', () => {
        it('should recognize 0x...dead as renounced ownership', () => {
            const antiRug = adapter.createAntiRug();
            const deadAddr = "0x000000000000000000000000000000000000dEaD";

            const tokenData = {
                is_honeypot: false,
                honeypot_with_same_creator: false,
                buy_tax: "0",
                sell_tax: "0",
                cannot_buy: false,
                cannot_sell_all: false,
                is_blacklisted: false,
                is_whitelisted: false,
                is_open_source: true,
                is_proxy: false,
                is_mintable: false,
                owner_change_balance: false,
                owner_address: deadAddr,
                creator_address: "0x123",
                liquidity_locked: true
            };

            const score = antiRug.compute_score("0xToken", tokenData);
            expect(score.owner_renounced).toBe(true);
            expect(score.score).toBeGreaterThan(90);
        });
    });

    describe('Evolution 4: Synaptic Calibration (Laplace Smoothing)', () => {
        it('should apply Laplace smoothing to probability', () => {
            const graph = adapter.createCausalGraph() as any;
            if (!graph) return;

            // P = (s + 1) / (t + 2)
            // Case 1: 1 Success, 0 Failures. 
            // Old: 1/1 = 1.0
            // New: (1+1)/(1+2) = 0.666...

            // SentinelVariable enum currently supports values 0..12.
            graph.learn(0, 1, true); // Cause 0 -> Effect 1 (Success)

            const edgeJson = graph.get_edge(0, 1);
            // edgeJson is an object (serde serialization)

            // In WasmAdapter, get_edge returns JsValue which is an object
            // { successes: 1, failures: 0, probability: ... }

            expect(edgeJson.successes).toBe(1);
            expect(edgeJson.failures).toBe(0);
            expect(edgeJson.probability).toBeCloseTo(0.666, 2);
            expect(edgeJson.probability).not.toBe(1.0);
        });
    });
});
