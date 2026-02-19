
import { describe, it, expect, beforeEach } from 'vitest';
import { WasmAdapter } from '../packages/soul/src/WasmAdapter';

describe('Hyper-Dimensional Memory (Vector DB)', () => {
    let adapter: WasmAdapter;

    beforeEach(async () => {
        WasmAdapter.resetInstance();
        adapter = WasmAdapter.getInstance();
        await adapter.init();
    });

    it('should initialize HyperMemory with correct dimensions', () => {
        const memory = adapter.createHyperMemory(4);
        expect(memory).toBeDefined();
        expect(memory.count()).toBe(0);
    });

    it('should insert and search vectors', () => {
        const memory = adapter.createHyperMemory(4);

        // Insert some vectors
        // A: [1, 0, 0, 0]
        // B: [0, 1, 0, 0]
        // C: [0.9, 0.1, 0, 0] (Similar to A)
        // D: [0, 0, 1, 0] (Diff)

        memory.insert('A', [1, 0, 0, 0]);
        memory.insert('B', [0, 1, 0, 0]);
        memory.insert('C', [0.9, 0.1, 0, 0]);
        memory.insert('D', [0, 0, 1, 0]);

        expect(memory.count()).toBe(4);

        // Search for vector close to A
        const query = [1, 0, 0, 0];
        const results = memory.search(query, 2);

        expect(results.length).toBe(2);
        expect(results[0].id).toBe('A');
        expect(results[0].score).toBeGreaterThan(0.99);

        expect(results[1].id).toBe('C');
        expect(results[1].score).toBeGreaterThan(0.8);
    });

    it('should handle updates (overwrite)', () => {
        const memory = adapter.createHyperMemory(2);
        memory.insert('X', [1, 0]);
        expect(memory.count()).toBe(1);

        memory.insert('X', [0, 1]); // Update X
        expect(memory.count()).toBe(1);

        const res = memory.search([0, 1], 1);
        expect(res[0].id).toBe('X');
        expect(res[0].score).toBeGreaterThan(0.99);
    });

    it('should export and import data', () => {
        const memory1 = adapter.createHyperMemory(2);
        memory1.insert('A', [1, 0]);
        memory1.insert('B', [0, 1]);

        const data = memory1.export_data();

        const memory2 = adapter.createHyperMemory(2);
        memory2.import_data(data);

        expect(memory2.count()).toBe(2);

        const res = memory2.search([1, 0], 1);
        expect(res[0].id).toBe('A');
    });
});
