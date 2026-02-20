import type { MemoryEntry } from '../types/CognitiveTypes';
import type { SQLiteLearningStore } from '../memory/SQLiteLearningStore';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class MemoryDecayManager {
    constructor(private readonly store?: SQLiteLearningStore) { }

    public calculateRetention(memory: Pick<MemoryEntry, 'last_accessed' | 'stability'>, now: number): number {
        const stability = memory.stability <= 0 ? 1 : memory.stability;
        const t = Math.max(0, (now - memory.last_accessed) / MS_PER_DAY);
        return Math.exp(-t / stability);
    }

    public strengthen(memory: MemoryEntry): MemoryEntry {
        return {
            ...memory,
            stability: Math.max(1, memory.stability * 1.5),
            last_accessed: Date.now(),
        };
    }

    public async prune(
        threshold = 0.1,
        options: { preserveImportanceAbove?: number } = {}
    ): Promise<number> {
        if (!this.store?.listMemoryEntries || !this.store?.deleteMemoryEntries) return 0;
        const preserveImportanceAbove = Math.max(
            0,
            Math.min(1, options.preserveImportanceAbove ?? 0.85)
        );
        const now = Date.now();
        const entries = await this.store.listMemoryEntries();
        const toDelete = entries
            .filter((entry) => {
                if (entry.importance >= preserveImportanceAbove) return false;
                return this.calculateRetention(entry, now) < threshold;
            })
            .map((entry) => entry.id);
        if (toDelete.length === 0) return 0;
        return this.store.deleteMemoryEntries(toDelete);
    }
}
