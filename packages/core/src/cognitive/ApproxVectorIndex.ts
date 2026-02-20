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
    private readonly hyperplanes: number;
    private readonly probes: number;
    private dimension = 0;
    private planes: number[][] = [];
    private buckets = new Map<number, number[]>();
    private items: IndexedVector[] = [];

    constructor(options?: { hyperplanes?: number; probes?: number }) {
        this.hyperplanes = Math.max(4, Math.min(30, Math.floor(options?.hyperplanes ?? 18)));
        this.probes = Math.max(0, Math.min(16, Math.floor(options?.probes ?? 6)));
    }

    public rebuild(vectors: IndexedVector[]): void {
        this.items = [];
        this.buckets.clear();
        this.dimension = vectors.find((entry) => entry.vector.length > 0)?.vector.length ?? 0;
        if (this.dimension === 0) return;

        this.planes = this.buildDeterministicPlanes(this.dimension, this.hyperplanes);
        for (const entry of vectors) {
            if (entry.vector.length !== this.dimension) continue;
            const itemIndex = this.items.length;
            this.items.push(entry);
            const signature = this.signature(entry.vector);
            const list = this.buckets.get(signature) ?? [];
            list.push(itemIndex);
            this.buckets.set(signature, list);
        }
    }

    public size(): number {
        return this.items.length;
    }

    public search(query: number[], k: number, candidateMultiplier = 12): SearchResult[] {
        if (k <= 0 || this.items.length === 0 || query.length !== this.dimension) return [];

        const candidates = this.collectCandidates(query, Math.max(k * candidateMultiplier, 48));
        const scored: SearchResult[] = candidates.map((idx) => ({
            id: this.items[idx].id,
            score: cosineSimilarity(query, this.items[idx].vector),
        }));

        const take = Math.min(k, scored.length);
        if (take === 0) return [];
        scored.sort(compareDesc);
        return scored.slice(0, take);
    }

    private collectCandidates(query: number[], targetCount: number): number[] {
        const collected = new Set<number>();
        const signature = this.signature(query);
        this.addBucket(signature, collected, targetCount);

        if (collected.size < targetCount) {
            // Probe neighboring buckets by flipping low bits first.
            const maxProbe = Math.min(this.probes, this.hyperplanes);
            for (let bit = 0; bit < maxProbe; bit++) {
                const neighbor = signature ^ (1 << bit);
                this.addBucket(neighbor, collected, targetCount);
                if (collected.size >= targetCount) break;
            }
        }

        if (collected.size < targetCount) {
            // Tail fallback: deterministic stride sampling to avoid full scan for large sets.
            const n = this.items.length;
            const stride = Math.max(1, Math.floor(n / Math.max(1, targetCount)));
            const start = Math.abs(signature) % Math.max(1, stride);
            for (let idx = start; idx < n && collected.size < targetCount; idx += stride) {
                collected.add(idx);
            }
        }

        if (collected.size < Math.min(targetCount, this.items.length) && this.items.length <= 256) {
            for (let i = 0; i < this.items.length && collected.size < targetCount; i++) {
                collected.add(i);
            }
        }

        return Array.from(collected);
    }

    private addBucket(signature: number, collected: Set<number>, targetCount: number): void {
        const bucket = this.buckets.get(signature);
        if (!bucket) return;
        for (const idx of bucket) {
            collected.add(idx);
            if (collected.size >= targetCount) return;
        }
    }

    private signature(vector: number[]): number {
        let signature = 0;
        const bits = Math.min(this.hyperplanes, 30);
        for (let bit = 0; bit < bits; bit++) {
            let projection = 0;
            const plane = this.planes[bit];
            for (let i = 0; i < this.dimension; i++) {
                projection += vector[i] * plane[i];
            }
            if (projection >= 0) {
                signature |= (1 << bit);
            }
        }
        return signature;
    }

    private buildDeterministicPlanes(dimension: number, count: number): number[][] {
        const planes: number[][] = [];
        let seed = (dimension * 2654435761) ^ (count * 2246822519);
        const next = (): number => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 0xffffffff;
        };

        for (let c = 0; c < count; c++) {
            const plane = new Array<number>(dimension);
            for (let i = 0; i < dimension; i++) {
                const r = next();
                plane[i] = r * 2 - 1;
            }
            planes.push(plane);
        }
        return planes;
    }
}
