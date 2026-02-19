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
    })
};

vi.mock('../src/eidolon/WasmAdapter', () => ({
    WasmAdapter: {
        getInstance: () => ({
            createCausalGraph: () => mockGraph
        })
    }
}));

import { CausalBrain } from '../src/eidolon/ai/CausalBrain';

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
        expect(pred.prob).toBe(1);
        expect(pred.confidence).toBe(0.5);
    });

    it('should decode exported wasm edges back to named variables', () => {
        graphEdges.set('6->0', { successes: 8, failures: 2 }); // WhaleNetFlow -> PriceDelta
        const brain = new CausalBrain();
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
