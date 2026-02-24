import type { MemoryNode } from '../types/CognitiveTypes';
import type { SQLiteLearningStore } from '../memory/SQLiteLearningStore';

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let an = 0;
    let bn = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        an += a[i] * a[i];
        bn += b[i] * b[i];
    }
    if (an === 0 || bn === 0) return 0;
    return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

function lexicalScore(query: string, concept: string): number {
    const q = query.toLowerCase();
    const c = concept.toLowerCase();
    if (q === c) return 1;
    if (c.includes(q) || q.includes(c)) return 0.8;
    const qTokens = new Set(q.split(/\s+/).filter(Boolean));
    const cTokens = new Set(c.split(/\s+/).filter(Boolean));
    let overlap = 0;
    for (const token of qTokens) {
        if (cTokens.has(token)) overlap++;
    }
    return qTokens.size === 0 ? 0 : overlap / qTokens.size;
}

export class MemoryGraph {
    private readonly nodes = new Map<string, MemoryNode>();
    private readonly maxCachedNodes: number;
    private readonly hydrateLimit: number;
    private readonly maxEdgesPerNode: number;
    private hydrated = false;

    constructor(
        private readonly store?: SQLiteLearningStore,
        options: {
            maxCachedNodes?: number;
            hydrateLimit?: number;
            maxEdgesPerNode?: number;
        } = {}
    ) {
        this.maxCachedNodes = Math.max(1, options.maxCachedNodes ?? 2000);
        this.hydrateLimit = Math.max(1, options.hydrateLimit ?? 1000);
        this.maxEdgesPerNode = Math.max(1, options.maxEdgesPerNode ?? 64);
    }

    public async addNode(node: MemoryNode): Promise<void> {
        const normalized: MemoryNode = {
            ...node,
            updated_at: Date.now(),
            connections: node.connections ?? [],
        };
        this.setNode(node.id, normalized);
        if (this.store?.upsertSemanticNode) {
            await this.store.upsertSemanticNode(normalized);
            for (const edge of normalized.connections) {
                await this.store.upsertSemanticEdge(normalized.id, edge.to, edge.relation, edge.weight);
            }
        }
    }

    public async findRelated(concept: string, depth = 2, limit = 10): Promise<MemoryNode[]> {
        await this.hydrateFromStore();
        const scored = Array.from(this.nodes.values())
            .map((node) => ({ node, score: lexicalScore(concept, node.concept) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(limit, depth * 3));
        const out = scored.map((entry) => entry.node);
        this.touchMany(out);
        return out;
    }

    public async findRelatedByEmbedding(embedding: number[], limit = 10): Promise<MemoryNode[]> {
        await this.hydrateFromStore();
        const scored = Array.from(this.nodes.values())
            .map((node) => ({ node, score: cosineSimilarity(embedding, node.embedding) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        const out = scored.map((entry) => entry.node);
        this.touchMany(out);
        return out;
    }

    public async merge(a: string, b: string): Promise<void> {
        await this.hydrateFromStore();
        const left = this.nodes.get(a);
        const right = this.nodes.get(b);
        if (!left || !right) return;

        const mergedConnections = new Map<string, { to: string; relation: string; weight: number }>();
        for (const edge of [...left.connections, ...right.connections]) {
            const key = `${edge.to}:${edge.relation}`;
            const existing = mergedConnections.get(key);
            if (!existing || edge.weight > existing.weight) mergedConnections.set(key, edge);
        }

        const mergedEmbedding = left.embedding.length === right.embedding.length && left.embedding.length > 0
            ? left.embedding.map((v, i) => (v + right.embedding[i]) / 2)
            : left.embedding;

        const merged: MemoryNode = {
            id: a,
            concept: `${left.concept} | ${right.concept}`,
            embedding: mergedEmbedding,
            connections: Array.from(mergedConnections.values()),
            updated_at: Date.now(),
        };
        this.setNode(a, merged);
        this.nodes.delete(b);

        if (this.store?.upsertSemanticNode) {
            await this.store.upsertSemanticNode(merged);
            await this.store.deleteSemanticNode?.(b);
        }
    }

    public listNodes(): MemoryNode[] {
        return Array.from(this.nodes.values());
    }

    private async hydrateFromStore(): Promise<void> {
        if (!this.store?.listSemanticNodes) return;
        if (this.hydrated) return;
        const nodes = await this.store.listSemanticNodes(this.hydrateLimit, this.maxEdgesPerNode);
        for (const node of nodes) {
            this.setNode(node.id, node);
        }
        this.hydrated = true;
    }

    private setNode(id: string, node: MemoryNode): void {
        // Map insertion order is used as LRU order.
        this.nodes.delete(id);
        this.nodes.set(id, node);
        this.evictIfNeeded();
    }

    private touchMany(nodes: MemoryNode[]): void {
        for (const node of nodes) {
            this.touch(node.id);
        }
    }

    private touch(id: string): void {
        const node = this.nodes.get(id);
        if (!node) return;
        this.nodes.delete(id);
        this.nodes.set(id, node);
    }

    private evictIfNeeded(): void {
        while (this.nodes.size > this.maxCachedNodes) {
            const oldest = this.nodes.keys().next().value;
            if (!oldest) break;
            this.nodes.delete(oldest);
        }
    }
}
