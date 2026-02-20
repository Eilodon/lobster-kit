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

    it('rebuilds ANN index when embeddings change without id/order changes', async () => {
        const queryVector = vectorize('critical rollout incident');
        const oracle = {
            async embed(_state: { sensory: Record<string, unknown> }) {
                return queryVector;
            },
        };
        const graph = new MemoryGraph();
        const now = Date.now();
        const entries = [
            {
                id: 'a',
                content: 'critical rollout incident',
                embedding: queryVector.slice(),
                stability: 1,
                last_accessed: now,
                created_at: now,
                importance: 0.7,
            },
            {
                id: 'b',
                content: 'generic memory',
                embedding: vectorize('generic memory'),
                stability: 1,
                last_accessed: now - 1,
                created_at: now - 1,
                importance: 0.5,
            },
            {
                id: 'c',
                content: 'misc note',
                embedding: vectorize('misc note'),
                stability: 1,
                last_accessed: now - 2,
                created_at: now - 2,
                importance: 0.3,
            },
        ];

        const router = new MemoryRouter(
            oracle as any,
            graph,
            async () => entries,
            async () => []
        );

        const worldState = createWorldState('conversation', { query: 'critical rollout incident' });
        const first = await router.query({ query: 'critical rollout incident', worldState });
        expect(first[0]?.id).toBe('a');

        entries[0].content = 'gardening tips and recipes';
        entries[0].embedding = vectorize('gardening tips and recipes');
        entries[1].content = 'critical rollout incident mirrored';
        entries[1].embedding = queryVector.slice();

        const second = await router.query({ query: 'critical rollout incident', worldState });
        expect(second[0]?.id).toBe('b');
    });
});
