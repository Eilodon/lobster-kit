import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGraph = {
    learn: vi.fn(),
    get_edge: vi.fn(() => ({ successes: 0, failures: 0, probability: 0.5 })),
    export_edges: vi.fn(() => ({})),
    import_edges: vi.fn()
};

import { WasmAdapter as CoreWasmAdapter } from '@eidolon/core';
import { CausalBrain } from '@eidolon/core';

describe('CausalBrain WASM schema regression', () => {
    beforeEach(() => {
        mockGraph.learn.mockClear();
        mockGraph.get_edge.mockClear();
        mockGraph.export_edges.mockClear();
        mockGraph.import_edges.mockClear();
        CoreWasmAdapter.setInstance({
            createCausalGraph: () => mockGraph
        } as any);
    });

    it('should send named edge keys with successes/failures when importing synaptic map', () => {
        const brain = new CausalBrain();
        brain.importSynapticMap({
            'WhaleNetFlow->PriceDelta': { s: 5, f: 1 }
        });

        expect(mockGraph.import_edges).toHaveBeenCalled();
        const payload = mockGraph.import_edges.mock.calls.at(-1)?.[0] as Record<string, { successes: number; failures: number }>;
        expect(payload['WhaleNetFlow->PriceDelta']).toEqual({ successes: 5, failures: 1 });
    });

    it('should replay full edge counts to wasm graph when import_edges fails', () => {
        mockGraph.import_edges.mockImplementation(() => {
            throw new Error('schema mismatch');
        });

        const brain = new CausalBrain();
        brain.importSynapticMap({
            'WhaleNetFlow->PriceDelta': { s: 100, f: 50 }
        });

        expect(mockGraph.learn).toHaveBeenCalled();
    });
});
