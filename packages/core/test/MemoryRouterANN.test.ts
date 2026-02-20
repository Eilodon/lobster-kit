import { describe, expect, it } from 'vitest';
import { createWorldState } from '../src/types/WorldState';
import { MemoryGraph } from '../src/cognitive/MemoryGraph';
import { MemoryRouter } from '../src/cognitive/MemoryRouter';

function vectorize(text: string, dim = 64): number[] {
    const out = new Array(dim).fill(0);
    const normalized = text.toLowerCase();
    for (let i = 0; i < normalized.length; i++) {
        const idx = (normalized.charCodeAt(i) + i * 13) % dim;
        out[idx] += 1;
    }
    const norm = Math.sqrt(out.reduce((acc, value) => acc + value * value, 0));
    if (norm <= 0) return out;
    return out.map((value) => value / norm);
}

describe('MemoryRouter ANN path', () => {
    it('retrieves highly similar episodic memory from large corpus', async () => {
        const now = Date.now();
        const queryVector = vectorize('swap route failure liquidity slippage');
        const entries = Array.from({ length: 4000 }, (_, i) => ({
            id: `mem_${i}`,
            content: i === 1777
                ? 'swap route failure due to liquidity imbalance and slippage spike'
                : `generic memory chunk ${i}`,
            embedding: i === 1777
                ? queryVector
                : vectorize(`generic vector seed_${i}`),
            stability: 1 + (i % 3),
            last_accessed: now - i * 10,
            created_at: now - i * 50,
            importance: i === 1777 ? 0.95 : 0.2,
            source: 'test',
        }));

        const oracle = {
            async embed(_state: { sensory: Record<string, unknown> }) {
                return queryVector;
            },
        };

        const router = new MemoryRouter(
            oracle as any,
            new MemoryGraph(),
            async () => entries,
            async () => []
        );

        const queryState = createWorldState('conversation', {
            query: 'swap route failure liquidity slippage',
        });
        const results = await router.query({
            query: 'swap route failure liquidity slippage',
            worldState: queryState,
        });

        expect(results.length).toBeGreaterThan(0);
        const topIds = results.slice(0, 3).map((entry) => entry.id);
        expect(topIds).toContain('mem_1777');
    });
});
