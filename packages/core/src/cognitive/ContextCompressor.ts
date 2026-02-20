import type {
    ClusterSummary,
    CompressedContext,
    ConversationSensory,
    Message
} from '../types/CognitiveTypes';

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

export class ContextCompressor {
    public async compress(
        messages: Message[],
        targetTokens: number,
        preserveRecent = 10
    ): Promise<CompressedContext> {
        const keepCount = Math.max(1, preserveRecent);
        const verbatim = messages.slice(-keepCount);
        const older = messages.slice(0, Math.max(0, messages.length - keepCount));

        const clusters = this.clusterByTopic(older);
        const summaries = clusters
            .map((bucket): ClusterSummary => ({
                topic: bucket.topic,
                summary: this.summarizeBucket(bucket.messages),
                importance: this.computeBucketImportance(bucket.messages),
                message_count: bucket.messages.length,
            }))
            .sort((a, b) => b.importance - a.importance);

        const keyFacts = this.extractKeyFacts(messages);
        const constrainedSummaries: ClusterSummary[] = [];
        let runningTokens = verbatim.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        runningTokens += keyFacts.reduce((acc, f) => acc + estimateTokens(f), 0);

        for (const summary of summaries) {
            const summaryTokens = estimateTokens(summary.summary) + estimateTokens(summary.topic);
            if (runningTokens + summaryTokens > targetTokens) continue;
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

    private clusterByTopic(messages: Message[]): Array<{ topic: string; messages: Message[] }> {
        const buckets = new Map<string, Message[]>();
        for (const message of messages) {
            const topic = this.detectTopic(message.content);
            const list = buckets.get(topic) ?? [];
            list.push(message);
            buckets.set(topic, list);
        }
        return Array.from(buckets.entries()).map(([topic, msgs]) => ({ topic, messages: msgs }));
    }

    private detectTopic(content: string): string {
        const lowered = content.toLowerCase();
        for (const entry of TOPIC_KEYWORDS) {
            if (entry.keywords.some((k) => lowered.includes(k))) {
                return entry.topic;
            }
        }
        return 'general';
    }

    private summarizeBucket(messages: Message[]): string {
        if (messages.length === 0) return '';
        const first = messages[0]?.content ?? '';
        const last = messages[messages.length - 1]?.content ?? '';
        if (messages.length === 1) return first.slice(0, 220);
        return `${first.slice(0, 120)} ... ${last.slice(0, 120)}`.trim();
    }

    private computeBucketImportance(messages: Message[]): number {
        if (messages.length === 0) return 0;
        const text = messages.map((m) => m.content.toLowerCase()).join(' ');
        let score = Math.min(1, messages.length / 10);
        if (text.includes('error') || text.includes('risk') || text.includes('blocked')) score += 0.2;
        if (text.includes('decision') || text.includes('final')) score += 0.1;
        return Math.max(0, Math.min(1, score));
    }

    private extractKeyFacts(messages: Message[]): string[] {
        const facts = new Set<string>();
        for (const message of messages) {
            const lowered = message.content.toLowerCase();
            if (
                lowered.includes('remember') ||
                lowered.includes('prefer') ||
                lowered.includes('do not') ||
                lowered.includes('đừng')
            ) {
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
