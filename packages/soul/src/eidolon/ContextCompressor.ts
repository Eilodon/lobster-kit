import type {
    ClusterSummary,
    CompressedContext,
    ConversationSensory,
    Message
} from './CognitiveTypes';

const TOPIC_KEYWORDS: Array<{ topic: string; keywords: string[] }> = [
    { topic: 'memory', keywords: ['remember', 'recall', 'memory', 'history'] },
    { topic: 'debug', keywords: ['bug', 'error', 'fix', 'issue', 'stack'] },
    { topic: 'planning', keywords: ['plan', 'roadmap', 'phase', 'milestone'] },
    { topic: 'performance', keywords: ['latency', 'throughput', 'optimize', 'perf'] },
    { topic: 'security', keywords: ['risk', 'security', 'attack', 'guard', 'safe'] },
];

function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

type ModelProfile = {
    context_window?: number;
    reserve_response_tokens?: number;
    compression_floor?: number;
};

type SentenceUnit = {
    text: string;
    role: Message['role'];
    timestamp: number;
    tokens: Set<string>;
    token_count: number;
};

type SemanticChunk = {
    topic: string;
    message_count: number;
    token_count: number;
    text: string;
    importance: number;
    fingerprint: number;
};

export class ContextCompressor {
    public async compress(
        messages: Message[],
        targetTokens: number,
        preserveRecent = 10,
        modelProfile?: ModelProfile
    ): Promise<CompressedContext> {
        const plannedBudget = this.planBudget(targetTokens, modelProfile);
        const keepCount = Math.max(1, preserveRecent);
        let verbatim = messages.slice(-keepCount);
        const older = messages.slice(0, Math.max(0, messages.length - keepCount));

        let verbatimTokens = verbatim.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        while (verbatim.length > 1 && verbatimTokens > plannedBudget * 0.75) {
            const dropped = verbatim.shift();
            if (!dropped) break;
            verbatimTokens -= estimateTokens(dropped.content);
        }

        const chunks = this.buildSemanticChunks(older);
        const deduped = this.fastCdcLiteDedupe(chunks)
            .sort((a, b) => b.importance - a.importance);

        const summaries = deduped.map((chunk): ClusterSummary => ({
            topic: chunk.topic,
            summary: this.summarizeChunk(chunk),
            importance: chunk.importance,
            message_count: chunk.message_count,
        }));

        const keyFacts = this.extractKeyFacts(messages);
        const constrainedSummaries: ClusterSummary[] = [];
        let runningTokens = verbatimTokens + keyFacts.reduce((acc, f) => acc + estimateTokens(f), 0);
        const maxSummaryItems = Math.max(2, Math.min(8, Math.floor(plannedBudget / 48)));
        for (const summary of summaries) {
            if (constrainedSummaries.length >= maxSummaryItems) break;
            const summaryTokens = estimateTokens(summary.topic) + estimateTokens(summary.summary);
            if (runningTokens + summaryTokens > plannedBudget) continue;
            constrainedSummaries.push(summary);
            runningTokens += summaryTokens;
        }

        return {
            verbatim,
            summaries: constrainedSummaries,
            key_facts: keyFacts,
            total_tokens: runningTokens,
        };
    }

    public scoreImportance(message: Message, context: ConversationSensory): number {
        let score = 0.3;
        const lowered = message.content.toLowerCase();

        if (lowered.includes('actually') || lowered.includes('correction') || lowered.includes('sai')) score += 0.3;
        if (lowered.includes('prefer') || lowered.includes('đừng') || lowered.includes('always')) score += 0.2;
        if (context.user_frustration_level > 0.6 && message.role === 'user') score += 0.2;
        if (context.pattern_drift_detected && message.role === 'assistant') score += 0.1;

        return Math.max(0, Math.min(1, score));
    }

    private planBudget(targetTokens: number, profile?: ModelProfile): number {
        const rawTarget = Math.max(128, Math.floor(targetTokens));
        if (!profile) return rawTarget;

        const contextWindow = Number(profile.context_window ?? 0);
        const reserve = Math.max(128, Math.floor(profile.reserve_response_tokens ?? 1024));
        const floor = Math.max(128, Math.floor(profile.compression_floor ?? 256));
        if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
            return Math.max(floor, rawTarget);
        }
        const capped = Math.max(floor, Math.min(rawTarget, contextWindow - reserve));
        return capped;
    }

    private buildSemanticChunks(messages: Message[]): SemanticChunk[] {
        const units = this.toSentenceUnits(messages);
        if (units.length === 0) return [];

        const chunks: Array<{
            units: SentenceUnit[];
            tokenSet: Set<string>;
            tokenCount: number;
            score: number;
        }> = [];
        const maxChunkTokens = 220;
        const similarityFloor = 0.12;
        let current: {
            units: SentenceUnit[];
            tokenSet: Set<string>;
            tokenCount: number;
            score: number;
        } | null = null;

        for (const unit of units) {
            if (!current) {
                current = {
                    units: [unit],
                    tokenSet: new Set(unit.tokens),
                    tokenCount: unit.token_count,
                    score: this.baseSentenceImportance(unit),
                };
                continue;
            }

            const similarity = this.jaccardSimilarity(current.tokenSet, unit.tokens);
            const drifted = similarity < similarityFloor;
            const overflow = current.tokenCount + unit.token_count > maxChunkTokens;
            if (drifted || overflow) {
                chunks.push(current);
                current = {
                    units: [unit],
                    tokenSet: new Set(unit.tokens),
                    tokenCount: unit.token_count,
                    score: this.baseSentenceImportance(unit),
                };
                continue;
            }

            current.units.push(unit);
            current.tokenCount += unit.token_count;
            current.score += this.baseSentenceImportance(unit);
            for (const token of unit.tokens) current.tokenSet.add(token);
        }
        if (current) chunks.push(current);

        return chunks.map((chunk): SemanticChunk => {
            const text = chunk.units.map((entry) => entry.text).join(' ');
            return {
                topic: this.detectTopic(text),
                message_count: chunk.units.length,
                token_count: chunk.tokenCount,
                text,
                importance: Math.max(0, Math.min(1, chunk.score / Math.max(1, chunk.units.length))),
                fingerprint: this.fastCdcFingerprint(text),
            };
        });
    }

    private fastCdcLiteDedupe(chunks: SemanticChunk[]): SemanticChunk[] {
        const byFingerprint = new Map<number, SemanticChunk>();
        for (const chunk of chunks) {
            const existing = byFingerprint.get(chunk.fingerprint);
            if (!existing) {
                byFingerprint.set(chunk.fingerprint, chunk);
                continue;
            }

            const existingTokens = this.tokenize(existing.text);
            const incomingTokens = this.tokenize(chunk.text);
            const similarity = this.jaccardSimilarity(existingTokens, incomingTokens);
            if (similarity >= 0.9) {
                if (chunk.importance > existing.importance || chunk.token_count > existing.token_count) {
                    byFingerprint.set(chunk.fingerprint, chunk);
                }
                continue;
            }

            const altKey = chunk.fingerprint ^ this.fastCdcFingerprint(chunk.topic);
            const altExisting = byFingerprint.get(altKey);
            if (!altExisting || chunk.importance > altExisting.importance) {
                byFingerprint.set(altKey, chunk);
            }
        }
        return Array.from(byFingerprint.values());
    }

    private summarizeChunk(chunk: SemanticChunk): string {
        if (!chunk.text) return '';
        const sentences = this.splitSentences(chunk.text);
        if (sentences.length === 0) return chunk.text.slice(0, 220);
        if (sentences.length === 1) return sentences[0].slice(0, 220);
        const first = sentences[0];
        const last = sentences[sentences.length - 1];
        const summary = `${first.slice(0, 140)} ... ${last.slice(0, 140)}`.trim();
        return summary.slice(0, 320);
    }

    private detectTopic(content: string): string {
        const lowered = content.toLowerCase();
        for (const entry of TOPIC_KEYWORDS) {
            if (entry.keywords.some((keyword) => lowered.includes(keyword))) {
                return entry.topic;
            }
        }
        if (/\b(contract|wallet|seed|key|permission)\b/i.test(content)) return 'security';
        if (/\b(p95|latency|throughput|memory|cpu)\b/i.test(content)) return 'performance';
        if (/\b(user|intent|conversation|reply|tone)\b/i.test(content)) return 'conversation';
        return 'general';
    }

    private toSentenceUnits(messages: Message[]): SentenceUnit[] {
        const units: SentenceUnit[] = [];
        for (const message of messages) {
            const timestamp = message.timestamp ?? Date.now();
            for (const sentence of this.splitSentences(message.content)) {
                const clean = sentence.trim();
                if (!clean) continue;
                units.push({
                    text: clean,
                    role: message.role,
                    timestamp,
                    tokens: this.tokenize(clean),
                    token_count: estimateTokens(clean),
                });
            }
        }
        return units;
    }

    private splitSentences(content: string): string[] {
        if (!content) return [];
        const lines = content
            .split(/\n+/g)
            .map((line) => line.trim())
            .filter(Boolean);
        const out: string[] = [];
        for (const line of lines) {
            const parts = line.split(/(?<=[.!?;:])\s+/g);
            for (const part of parts) {
                const clean = part.trim();
                if (clean) out.push(clean);
            }
        }
        return out;
    }

    private tokenize(input: string): Set<string> {
        const lowered = input.toLowerCase();
        const unicodeTokens = lowered.match(/[\p{L}\p{N}_]+/gu);
        const asciiFallback = lowered.match(/[a-z0-9_]+/g);
        const tokens = unicodeTokens ?? asciiFallback ?? [];
        return new Set(tokens.filter((token) => token.length > 1));
    }

    private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
        if (a.size === 0 || b.size === 0) return 0;
        let overlap = 0;
        for (const token of a) {
            if (b.has(token)) overlap++;
        }
        const union = a.size + b.size - overlap;
        return union === 0 ? 0 : overlap / union;
    }

    private baseSentenceImportance(unit: SentenceUnit): number {
        let score = 0.3;
        const text = unit.text.toLowerCase();
        if (unit.role === 'user') score += 0.2;
        if (/(must|never|always|prefer|blocked|error|critical|risk)/.test(text)) score += 0.25;
        if (/\d/.test(text)) score += 0.1;
        return Math.max(0, Math.min(1, score));
    }

    private fastCdcFingerprint(input: string): number {
        const text = input.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!text) return 0;
        const minSize = 48;
        const maxSize = 256;
        const mask = 0x1f;
        let rolling = 2166136261 >>> 0;
        let cutAt = 0;
        let fingerprint = 0;

        for (let i = 0; i < text.length; i++) {
            rolling ^= text.charCodeAt(i);
            rolling = Math.imul(rolling, 16777619) >>> 0;

            const chunkLen = i - cutAt + 1;
            const forceCut = chunkLen >= maxSize;
            const naturalCut = chunkLen >= minSize && ((rolling & mask) === 0);
            const endCut = i === text.length - 1;
            if (forceCut || naturalCut || endCut) {
                fingerprint = (fingerprint ^ rolling) >>> 0;
                cutAt = i + 1;
            }
        }
        return fingerprint >>> 0;
    }

    private extractKeyFacts(messages: Message[]): string[] {
        const facts = new Set<string>();
        for (const message of messages) {
            const lowered = message.content.toLowerCase();
            if (
                lowered.includes('remember') ||
                lowered.includes('prefer') ||
                lowered.includes('do not') ||
                lowered.includes('must') ||
                lowered.includes('never') ||
                lowered.includes('blocked') ||
                lowered.includes('đừng')
            ) {
                facts.add(message.content.slice(0, 240));
            }
            if (/\b(p95|latency|slo|rollback|incident)\b/i.test(message.content)) {
                facts.add(message.content.slice(0, 240));
            }
            if (facts.size >= 12) break;
        }
        return Array.from(facts);
    }
}

export class ContextRouter {
    public async route(query: string): Promise<'hyper_memory' | 'sqlite' | 'liquid_brain' | 'causal_graph'> {
        const lowered = query.toLowerCase();
        if (lowered.includes('last session') || lowered.includes('history') || lowered.includes('previous')) {
            return 'sqlite';
        }
        if (lowered.includes('mood') || lowered.includes('intuition') || lowered.includes('current state')) {
            return 'liquid_brain';
        }
        if (lowered.includes('skeptical') || lowered.includes('why') || lowered.includes('cause')) {
            return 'causal_graph';
        }
        return 'hyper_memory';
    }

    public async maintainPlan(goal: string, context: CompressedContext): Promise<{ goal: string; checkpoints: string[]; revised: boolean }> {
        const checkpoints = [
            `Goal: ${goal}`,
            ...context.key_facts.slice(0, 4).map((f, idx) => `Fact ${idx + 1}: ${f}`)
        ];
        const revised = context.key_facts.some((f) => f.toLowerCase().includes('change') || f.toLowerCase().includes('revise'));
        return { goal, checkpoints, revised };
    }
}
