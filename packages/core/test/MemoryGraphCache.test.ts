import { describe, expect, it, vi } from 'vitest';
import { MemoryGraph } from '../src/cognitive/MemoryGraph';
import type { MemoryNode } from '../src/types/CognitiveTypes';

function makeNode(id: string, concept: string): MemoryNode {
    return {
        id,
        concept,
        embedding: [id.length, concept.length],
        connections: [],
        updated_at: Date.now(),
    };
}

describe('MemoryGraph cache behavior', () => {
    it('enforces LRU eviction for in-memory nodes', async () => {
        const graph = new MemoryGraph(undefined as any, { maxCachedNodes: 2 });
        await graph.addNode(makeNode('a', 'alpha'));
        await graph.addNode(makeNode('b', 'beta'));

        // Touch "a" so "b" becomes least-recently used.
        await graph.findRelated('alpha', 1, 1);

        await graph.addNode(makeNode('c', 'charlie'));
        const ids = graph.listNodes().map((node) => node.id);

        expect(ids).toContain('a');
        expect(ids).toContain('c');
        expect(ids).not.toContain('b');
    });

    it('hydrates from store with bounded node/edge limits', async () => {
        const listSemanticNodes = vi.fn(async (_limit?: number, _maxEdgesPerNode?: number) => [
            makeNode('n1', 'one'),
            makeNode('n2', 'two'),
            makeNode('n3', 'three'),
        ]);

        const graph = new MemoryGraph(
            { listSemanticNodes } as any,
            { maxCachedNodes: 2, hydrateLimit: 50, maxEdgesPerNode: 7 }
        );

        await graph.findRelatedByEmbedding([1, 1], 2);
        await graph.findRelatedByEmbedding([1, 1], 2);

        expect(listSemanticNodes).toHaveBeenCalledTimes(1);
        expect(listSemanticNodes).toHaveBeenCalledWith(50, 7);
        expect(graph.listNodes().length).toBeLessThanOrEqual(2);
    });
});
