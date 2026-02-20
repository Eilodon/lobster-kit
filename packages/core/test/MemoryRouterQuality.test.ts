import { describe, expect, it } from 'vitest';
import { createWorldState, MemoryGraph, MemoryRouter } from '../src';

function vectorize(text: string, dim = 32): number[] {
    const out = new Array(dim).fill(0);
    const normalized = text.toLowerCase();
    for (let i = 0; i < normalized.length; i++) {
        const idx = (normalized.charCodeAt(i) + i * 17) % dim;
        out[idx] += 1;
    }
    const norm = Math.sqrt(out.reduce((acc, v) => acc + v * v, 0));
    if (norm <= 0) return out;
    return out.map((v) => v / norm);
}

describe('MemoryRouter quality and scale', () => {
    it('prioritizes semantically similar episodic memory', async () => {
        const oracle = {
            async embed(state: { sensory: Record<string, unknown> }) {
                return vectorize(JSON.stringify(state.sensory));
            },
        };
        const graph = new MemoryGraph();
        const entries = [
            {
                id: 'swap_1',
                content: 'Swap route failed due to liquidity error on opBNB.',
                embedding: vectorize('swap route liquidity error'),
                stability: 1,
                last_accessed: Date.now(),
                created_at: Date.now(),
                importance: 0.7,
            },
            {
                id: 'misc_1',
                content: 'User asked for meal ideas and travel tips.',
                embedding: vectorize('meal travel tips'),
                stability: 1,
                last_accessed: Date.now(),
                created_at: Date.now(),
                importance: 0.4,
            },
        ];
        const router = new MemoryRouter(
            oracle as any,
            graph,
            async () => entries,
            async () => []
        );

        const results = await router.query({
            query: 'swap liquidity error',
            worldState: createWorldState('conversation', { query: 'swap liquidity error' }),
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toBe('swap_1');
    });

    it('keeps query latency stable as dataset grows', async () => {
        const oracle = {
            async embed(state: { sensory: Record<string, unknown> }) {
                return vectorize(JSON.stringify(state.sensory));
            },
        };
        const graph = new MemoryGraph();
        const makeEntries = (size: number) => Array.from({ length: size }, (_, i) => ({
            id: `mem_${i}`,
            content: i % 15 === 0 ? `swap failure pattern ${i}` : `generic memory ${i}`,
            embedding: vectorize(i % 15 === 0 ? 'swap failure pattern' : `generic ${i}`),
            stability: 1 + (i % 3),
            last_accessed: Date.now() - i * 1000,
            created_at: Date.now() - i * 2000,
            importance: i % 15 === 0 ? 0.8 : 0.2,
        }));

        const smallRouter = new MemoryRouter(
            oracle as any,
            graph,
            async () => makeEntries(250),
            async () => []
        );
        const largeRouter = new MemoryRouter(
            oracle as any,
            graph,
            async () => makeEntries(2500),
            async () => []
        );

        const worldState = createWorldState('conversation', { query: 'swap failure pattern' });
        const t1 = Date.now();
        await smallRouter.query({ query: 'swap failure pattern', worldState });
        const smallMs = Date.now() - t1;

        const t2 = Date.now();
        await largeRouter.query({ query: 'swap failure pattern', worldState });
        const largeMs = Date.now() - t2;

        expect(largeMs).toBeLessThan(2500);
        expect(largeMs).toBeLessThan(Math.max(35, smallMs * 35));
    });
});

