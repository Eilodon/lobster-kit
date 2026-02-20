import type { IOracle } from '../ai/IOracle';
import type { MemoryGraph } from './MemoryGraph';
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
    constructor(
        private readonly oracle: Pick<IOracle, 'embed'>,
        private readonly memoryGraph: MemoryGraph,
        private readonly loadEpisodic: () => Promise<MemoryEntry[]>,
        private readonly loadCausal: () => Promise<Array<{ id: string; confidence: number; note: string }>>
    ) { }

    public async query<T extends object>(context: MemoryQueryContext<T>): Promise<MemoryResult[]> {
        const embedding = await this.oracle.embed(context.worldState);
        const episodic = await this.searchEpisodic(embedding, context.query, 5);
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

    private async searchEpisodic(embedding: number[], query: string, limit: number): Promise<MemoryResult[]> {
        const entries = await this.loadEpisodic();
        return entries
            .map((entry): MemoryResult => ({
                id: entry.id,
                source: 'episodic',
                score: cosineSimilarity(embedding, entry.embedding) + this.lexicalBonus(query, entry.content),
                content: entry.content,
                metadata: { stability: entry.stability, source: entry.source },
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    private lexicalBonus(query: string, content: string): number {
        const q = query.toLowerCase();
        const c = content.toLowerCase();
        if (!q || !c) return 0;
        if (c.includes(q)) return 0.1;
        return 0;
    }
}
