import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const graphEdges = new Map<string, { successes: number; failures: number }>();
const edgeKey = (cause: number, effect: number) => `${cause}->${effect}`;

const mockGraph = {
    learn: vi.fn((cause: number, effect: number, positive: boolean) => {
        const key = edgeKey(cause, effect);
        const existing = graphEdges.get(key) ?? { successes: 0, failures: 0 };
        if (positive) existing.successes += 1;
        else existing.failures += 1;
        graphEdges.set(key, existing);
    }),
    get_edge: vi.fn((cause: number, effect: number) => {
        const edge = graphEdges.get(edgeKey(cause, effect)) ?? { successes: 0, failures: 0 };
        const total = edge.successes + edge.failures;
        return {
            successes: edge.successes,
            failures: edge.failures,
            probability: total === 0 ? 0.5 : edge.successes / total
        };
    }),
    export_edges: vi.fn(() => {
        const out: Record<string, { successes: number; failures: number; probability: number }> = {};
        for (const [key, edge] of graphEdges.entries()) {
            const total = edge.successes + edge.failures;
            out[key] = {
                successes: edge.successes,
                failures: edge.failures,
                probability: total === 0 ? 0.5 : edge.successes / total
            };
        }
        return out;
    }),
    import_edges: vi.fn((edges: Record<string, { s: number; f: number }>) => {
        for (const [key, val] of Object.entries(edges)) {
            // Convert "1->0" key format if needed, but mock uses simple logic
            // The test uses names, CausalBrain converts to indices.
            // But mockGraph doesn't really care about indices vs names if we just map keys.
            // CausalBrain sends "idx->idx".
            // Mock expects this.
            graphEdges.set(key, { successes: val.s, failures: val.f });
        }
    })
};

vi.mock('../src/WasmAdapter', () => ({
    WasmAdapter: {
        getInstance: () => ({
            createCausalGraph: () => mockGraph
        })
    }
}));

import { CausalBrain } from '../src/ai/CausalBrain';

describe('CausalBrain Rust Bridge', () => {
    const originalCausalRust = process.env.EIDOLON_CAUSAL_RUST;

    beforeEach(() => {
        delete process.env.EIDOLON_CAUSAL_RUST;
        graphEdges.clear();
        mockGraph.learn.mockClear();
        mockGraph.get_edge.mockClear();
        mockGraph.export_edges.mockClear();
    });

    it('should route learn/predict through wasm graph when available', () => {
        const brain = new CausalBrain();
        expect(brain.isUsingWasm()).toBe(true);

        for (let i = 0; i < 10; i++) {
            brain.learn('WhaleNetFlow', 'PriceDelta', true);
        }
        const pred = brain.getPrediction('WhaleNetFlow', 'PriceDelta');

        expect(mockGraph.learn).toHaveBeenCalled();
        // Priors (85/15) + Learned (10/0) = 95/15. Total 110.
        // Prob = 95/110 = 0.8636...
        // Conf = 110 / (110 + 100) = 0.5238...
        expect(pred.prob).toBeCloseTo(0.86, 2);
        expect(pred.confidence).toBeCloseTo(0.52, 2);
    });

    it('should decode exported wasm edges back to named variables', () => {
        const brain = new CausalBrain();
        graphEdges.set('6->0', { successes: 8, failures: 2 }); // WhaleNetFlow -> PriceDelta
        const map = brain.getSynapticMap();
        expect(map['WhaleNetFlow->PriceDelta']).toBeDefined();
        expect(map['WhaleNetFlow->PriceDelta'].p).toBe(0.8);
    });

    it('should allow disabling wasm graph via env canary switch', () => {
        process.env.EIDOLON_CAUSAL_RUST = '0';
        const brain = new CausalBrain();
        brain.learn('WhaleNetFlow', 'PriceDelta', true);
        expect(brain.isUsingWasm()).toBe(false);
        expect(mockGraph.learn).not.toHaveBeenCalled();
    });

    afterAll(() => {
        if (originalCausalRust === undefined) {
            delete process.env.EIDOLON_CAUSAL_RUST;
            return;
        }
        process.env.EIDOLON_CAUSAL_RUST = originalCausalRust;
    });
});
