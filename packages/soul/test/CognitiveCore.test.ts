import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WasmAdapter } from '../src/WasmAdapter';
import { ConversationDomainConfig, Intervenable, CounterfactualResult } from '../src/WasmAdapter';

describe('Cognitive Core Types & WasmAdapter', () => {
    let adapter: WasmAdapter;

    beforeEach(async () => {
        WasmAdapter.resetInstance();
        adapter = WasmAdapter.getInstance();
        await adapter.init();
    });

    it('should load WASM module (not fallback)', () => {
        expect(adapter.isFallbackMode).toBe(false);
    });

    it('should create ConversationDomainConfig with presets (Mock/Real)', () => {
        const peer = adapter.createConversationConfig('peer');
        expect(peer.intrusiveness_threshold).toBeCloseTo(0.3);

        const advisory = adapter.createConversationConfig('advisory');
        expect(advisory.intrusiveness_threshold).toBeCloseTo(0.6);

        const custom = adapter.createConversationConfig('custom', {
            intrusiveness_threshold: 0.9,
            trust_decay_rate: 0.1,
            trauma_severity_scale: 2.0,
            dagma_trigger_episodes: 10,
            thermo_dt: 0.5
        });
        expect(custom.intrusiveness_threshold).toBeCloseTo(0.9);
    });

    it('should create Intervenable (Mock/Real)', () => {
        const intervenable = adapter.createIntervenable();
        expect(intervenable).toBeDefined();
        // Check interface methods exist
        expect(typeof intervenable.do_intervention).toBe('function');
        expect(typeof intervenable.counterfactual).toBe('function');
    });

    it('should perform do_intervention (WASM behavior)', () => {
        const intervenable = adapter.createIntervenable();
        const graph = adapter.createCausalGraph();

        // Setup graph: Cause 1 -> Effect 12 with high probability
        for (let i = 0; i < 20; i++) graph.learn(1, 12, true);

        // Intervention: do(Cause 1 = 1.0)
        // Expected: 1.0 * prob (~0.95 with Laplace)
        const result = intervenable.do_intervention(graph, 1, 1.0, 12);

        expect(result).toBeGreaterThan(0.8);
    });

    it('should perform counterfactual analysis (WASM behavior)', () => {
        const intervenable = adapter.createIntervenable();
        const graph = adapter.createCausalGraph();

        // Setup: 
        // Action 0 (Zen) -> Quality 12 (Low prob)
        // Action 1 (Peer) -> Quality 12 (High prob)
        for (let i = 0; i < 20; i++) graph.learn(0, 12, false); // Poor outcome
        for (let i = 0; i < 20; i++) graph.learn(1, 12, true);  // Good outcome

        // Counterfactual: I did Zen (0), what if I did Peer (1)?
        const result: CounterfactualResult = intervenable.counterfactual(graph, 0, 1, 12);

        expect(result.actual_prob).toBeLessThan(0.5);
        expect(result.hypothetical_prob).toBeGreaterThan(0.5);
        expect(result.would_have_been_better).toBe(true);
        expect(result.delta).toBeGreaterThan(0);
    });
});
