import { describe, it, expect, beforeAll } from 'vitest';
import { WasmAdapter } from '../src/WasmAdapter';
import { ApproxVectorIndex } from '@clawkit/core';

describe('ApproxVectorIndex WASM Bridge', () => {
    beforeAll(async () => {
        const adapter = WasmAdapter.getInstance();
        console.log("Before init:", adapter.isReady());
        await adapter.init();
        console.log("After init:", adapter.isReady());

        const coreAdapter = (await import('@clawkit/core')).WasmAdapter.getInstance();
        console.log("Core adapter has createApproxVectorIndex:", typeof (coreAdapter as any).createApproxVectorIndex === 'function');
        console.log("Is CoreAdapter overridden:", coreAdapter === adapter);
    });

    it('should initialize and perform vector search via WASM', () => {
        // Since we are in @clawkit/soul, WasmAdapter will intercept and return the WASM index
        const index = new ApproxVectorIndex({ hyperplanes: 8, probes: 2 });

        // Mock vectors
        const vectors = [
            { id: 'mem1', vector: [1.0, 0.0, 0.0, 0.5] },
            { id: 'mem2', vector: [0.0, 1.0, 0.0, 0.1] },
            { id: 'mem3', vector: [0.9, 0.1, 0.0, 0.4] } // highly similar to mem1
        ];

        // This triggers the WASM float32 array ingestion
        index.rebuild(vectors);

        expect(index.size()).toBe(3);

        // Search for something close to mem1
        const results = index.search([1.0, 0.1, 0.0, 0.5], 2);

        expect(results.length).toBe(2);
        expect(results[0].id).toBe('mem3'); // mem3 is mathematically closer (cosine sim = 0.9994 vs 0.996)
        expect(results[1].id).toBe('mem1');
    });
});
