import type { IOracle } from '../ai/IOracle';
import type { MemoryGraph } from './MemoryGraph';
import { ApproxVectorIndex } from './ApproxVectorIndex';
import type {
    MemoryEntry,
    MemoryQueryContext,
    MemoryResult,
} from '../types/CognitiveTypes';

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

export class MemoryRouter {
    private readonly episodicIndex = new ApproxVectorIndex({
        hyperplanes: 18,
        probes: 6,
    });
    private episodicIndexFingerprint = '';

    constructor(
        private readonly oracle: Pick<IOracle, 'embed'>,
        private readonly memoryGraph: MemoryGraph,
        private readonly loadEpisodic: () => Promise<MemoryEntry[]>,
        private readonly loadCausal: () => Promise<Array<{ id: string; confidence: number; note: string }>>
    ) { }

    public async query<T extends object>(context: MemoryQueryContext<T>): Promise<MemoryResult[]> {
        const embedding = await this.oracle.embed(context.worldState);
        const episodicEntries = await this.loadEpisodic();
        this.ensureEpisodicIndex(episodicEntries);
        const episodic = this.searchEpisodic(embedding, context.query, episodicEntries, 5);
        const semanticNodes = await this.memoryGraph.findRelatedByEmbedding(embedding, 5);
        const semantic = semanticNodes.map((node): MemoryResult => ({
            id: node.id,
            source: 'semantic',
            score: 0.8,
            content: node.concept,
            metadata: { connections: node.connections.length },
        }));
        const causalRaw = await this.loadCausal();
        const causal = causalRaw.slice(0, 3).map((entry): MemoryResult => ({
            id: entry.id,
            source: 'causal',
            score: Math.max(0, Math.min(1, entry.confidence)),
            content: entry.note,
        }));

        return [...episodic, ...semantic, ...causal]
            .sort((a, b) => b.score - a.score);
    }

    private searchEpisodic(
        embedding: number[],
        query: string,
        entries: MemoryEntry[],
        limit: number
    ): MemoryResult[] {
        if (entries.length === 0) return [];
        const byId = new Map(entries.map((entry) => [entry.id, entry]));
        const candidateK = Math.max(limit * 12, 48);
        const candidates = this.episodicIndex.search(embedding, candidateK);
        const ranked = candidates
            .map((candidate): MemoryResult | null => {
                const entry = byId.get(candidate.id);
                if (!entry) return null;
                const lexical = this.lexicalBonus(query, entry.content);
                const stabilityBoost = Math.max(0, Math.min(0.1, entry.stability * 0.03));
                const importanceBoost = Math.max(0, Math.min(0.1, entry.importance * 0.05));
                return {
                    id: entry.id,
                    source: 'episodic',
                    score: candidate.score + lexical + stabilityBoost + importanceBoost,
                    content: entry.content,
                    metadata: { stability: entry.stability, source: entry.source, importance: entry.importance },
                };
            })
            .filter((item): item is MemoryResult => !!item)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        if (ranked.length === 0 || ranked[0].score < 0.55) {
            // Guard quality on hard queries: fallback to exact linear scoring.
            return entries
                .map((entry): MemoryResult => ({
                    id: entry.id,
                    source: 'episodic',
                    score:
                        cosineSimilarity(embedding, entry.embedding) +
                        this.lexicalBonus(query, entry.content) +
                        Math.max(0, Math.min(0.1, entry.stability * 0.03)) +
                        Math.max(0, Math.min(0.1, entry.importance * 0.05)),
                    content: entry.content,
                    metadata: { stability: entry.stability, source: entry.source, importance: entry.importance },
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);
        }

        return ranked;
    }

    private lexicalBonus(query: string, content: string): number {
        const q = query.toLowerCase();
        const c = content.toLowerCase();
        if (!q || !c) return 0;
        if (c.includes(q)) return 0.1;
        return 0;
    }

    private ensureEpisodicIndex(entries: MemoryEntry[]): void {
        const fingerprint = this.fingerprint(entries);
        if (fingerprint === this.episodicIndexFingerprint) return;

        this.episodicIndex.rebuild(
            entries.map((entry) => ({ id: entry.id, vector: entry.embedding }))
        );
        this.episodicIndexFingerprint = fingerprint;
    }

    private fingerprint(entries: MemoryEntry[]): string {
        if (entries.length === 0) return '0';

        let hash = 2166136261 >>> 0;
        const mix = (value: number): void => {
            hash ^= (value >>> 0);
            hash = Math.imul(hash, 16777619) >>> 0;
        };
        const mixString = (value: string): void => {
            for (let i = 0; i < value.length; i++) {
                mix(value.charCodeAt(i));
            }
        };
        const quantize = (value: number, scale = 1000): number => {
            if (!Number.isFinite(value)) return 0;
            return Math.round(value * scale);
        };

        mix(entries.length);
        for (let idx = 0; idx < entries.length; idx++) {
            const entry = entries[idx];
            mix(idx);
            mixString(entry.id);
            mix(quantize(entry.last_accessed, 1));
            mix(quantize(entry.created_at, 1));
            mix(quantize(entry.stability, 10_000));
            mix(quantize(entry.importance, 10_000));
            mix(entry.embedding.length);
            if (entry.source) mixString(entry.source);

            if (entry.embedding.length > 0) {
                const stride = Math.max(1, Math.floor(entry.embedding.length / 8));
                for (let i = 0; i < entry.embedding.length; i += stride) {
                    mix(quantize(entry.embedding[i], 10_000));
                }
                mix(quantize(entry.embedding[entry.embedding.length - 1], 10_000));
            }
        }

        return `${entries.length}|${hash.toString(16)}`;
    }
}
