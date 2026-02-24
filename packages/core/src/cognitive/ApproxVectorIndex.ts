type IndexedVector = {
    id: string;
    vector: number[];
};

type SearchResult = {
    id: string;
    score: number;
};

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

function compareDesc(a: SearchResult, b: SearchResult): number {
    return b.score - a.score;
}

/**
 * Lightweight ANN index for episodic memory.
 * Uses deterministic random-hyperplane signatures (SimHash-like buckets).
 */
export class ApproxVectorIndex {
    private dimension = 0;
    private items: IndexedVector[] = [];
    private wasmIndex: any = null;

    constructor(options?: { hyperplanes?: number; probes?: number }) {
        const adapter = (globalThis as any).EIDOLON_WASM_ADAPTER as any;
        if (adapter && typeof adapter.createApproxVectorIndex === 'function') {
            this.wasmIndex = adapter.createApproxVectorIndex(options?.hyperplanes, options?.probes);
        }
    }

    public rebuild(vectors: IndexedVector[]): void {
        this.items = vectors;
        this.dimension = vectors.find((entry) => entry.vector.length > 0)?.vector.length ?? 0;

        if (!this.wasmIndex) {
            console.warn('ApproxVectorIndex requires WASM for rebuild. Simulation disabled.');
            return;
        }

        if (this.dimension === 0 || vectors.length === 0) return;

        // Flatten vectors into Float32Array for zero-allocation WASM transfer
        const flatVec = new Float32Array(vectors.length * this.dimension);
        for (let i = 0; i < vectors.length; i++) {
            const vec = vectors[i].vector;
            if (vec.length !== this.dimension) continue;
            flatVec.set(vec, i * this.dimension);
        }

        this.wasmIndex.rebuild(flatVec, this.dimension);
    }

    public size(): number {
        if (this.wasmIndex) return this.wasmIndex.size();
        return this.items.length;
    }

    public search(query: number[], k: number, candidateMultiplier = 12): SearchResult[] {
        if (!this.wasmIndex) return [];
        if (k <= 0 || this.items.length === 0 || query.length !== this.dimension) return [];

        const queryArray = new Float32Array(query);
        const results = this.wasmIndex.search(queryArray, k, candidateMultiplier) as any[];

        return results.map(r => ({
            id: this.items[r.id].id,
            score: r.score
        }));
    }
}
