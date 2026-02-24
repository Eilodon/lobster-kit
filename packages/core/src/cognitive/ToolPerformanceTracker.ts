import type { ToolPerformanceRecord } from '../types/CognitiveTypes';
import type { SQLiteLearningStore } from '../memory/SQLiteLearningStore';

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

type RecordOptions = {
    userSatisfaction?: number;
    fallbackUsed?: boolean;
};

type ToolPerformancePersistence = Pick<
    SQLiteLearningStore,
    'upsertToolPerformance' | 'getToolPerformance' | 'listToolPerformance'
>;

function toOptions(
    userSatisfactionOrOptions?: number | RecordOptions,
    options?: RecordOptions
): RecordOptions {
    if (typeof userSatisfactionOrOptions === 'number') {
        return {
            userSatisfaction: userSatisfactionOrOptions,
            ...(options ?? {}),
        };
    }
    return userSatisfactionOrOptions ?? options ?? {};
}

export class ToolPerformanceTracker {
    private readonly records = new Map<string, ToolPerformanceRecord>();
    private readonly latencySamples = new Map<string, NumericRingBuffer>();
    private hydrated = false;
    private hydrationPromise: Promise<void> | null = null;

    constructor(
        private readonly persistence?: ToolPerformancePersistence,
        private readonly maxLatencySamples = 256
    ) {
        if (this.persistence) {
            void this.hydrateFromPersistence();
        }
    }

    public async score(toolName: string): Promise<number> {
        await this.hydrateFromPersistence();
        const record = this.records.get(toolName);
        if (!record) return 0;

        const success = clamp01(record.success_rate);
        const latencyScore = record.avg_latency_ms <= 0
            ? 0
            : 1 / (1 + Math.log10(1 + record.avg_latency_ms));
        const satisfaction = clamp01(record.user_satisfaction);

        return clamp01(success * 0.55 + latencyScore * 0.25 + satisfaction * 0.2);
    }

    public async recommend(task: string, availableTools: string[]): Promise<string[]> {
        await this.hydrateFromPersistence();
        const loweredTask = task.toLowerCase();
        const scored = await Promise.all(
            availableTools.map(async (toolName) => {
                const historical = await this.score(toolName);
                let intentBoost = 0;
                if (loweredTask.includes('compress') && toolName.includes('compress')) intentBoost = 0.1;
                if (loweredTask.includes('reason') && toolName.includes('reason')) intentBoost = 0.1;
                if (loweredTask.includes('memory') && toolName.includes('memory')) intentBoost = 0.1;
                return { toolName, score: historical + intentBoost };
            })
        );
        return scored.sort((a, b) => b.score - a.score).map((entry) => entry.toolName);
    }

    public async record(
        toolName: string,
        success: boolean,
        latencyMs: number,
        userSatisfactionOrOptions?: number | RecordOptions,
        options?: RecordOptions
    ): Promise<void> {
        await this.hydrateFromPersistence();
        const opts = toOptions(userSatisfactionOrOptions, options);
        const existing = this.records.get(toolName);
        const clampedLatency = Math.max(0, latencyMs);
        this.pushLatencySample(toolName, clampedLatency);
        const percentiles = this.computeLatencyPercentiles(toolName);
        const fallbackIncrement = opts.fallbackUsed ? 1 : 0;

        if (!existing) {
            const created: ToolPerformanceRecord = {
                tool_name: toolName,
                call_count: 1,
                error_count: success ? 0 : 1,
                fallback_count: fallbackIncrement,
                success_rate: success ? 1 : 0,
                avg_latency_ms: clampedLatency,
                latency_p50_ms: percentiles.p50,
                latency_p95_ms: percentiles.p95,
                fallback_rate: clamp01(fallbackIncrement),
                user_satisfaction: clamp01(opts.userSatisfaction ?? 0.5),
                last_called: Date.now(),
            };
            this.records.set(toolName, created);
            await this.persistence?.upsertToolPerformance?.(created);
            return;
        }

        const nextCount = existing.call_count + 1;
        const successfulCalls = existing.success_rate * existing.call_count + (success ? 1 : 0);
        const totalLatency = existing.avg_latency_ms * existing.call_count + clampedLatency;
        const totalSatisfaction = existing.user_satisfaction * existing.call_count + clamp01(opts.userSatisfaction ?? existing.user_satisfaction);
        const previousErrorCount = existing.error_count ?? Math.round((1 - existing.success_rate) * existing.call_count);
        const previousFallbackCount = existing.fallback_count ?? Math.round((existing.fallback_rate ?? 0) * existing.call_count);
        const errorCount = previousErrorCount + (success ? 0 : 1);
        const fallbackCount = previousFallbackCount + fallbackIncrement;

        const updated: ToolPerformanceRecord = {
            tool_name: toolName,
            call_count: nextCount,
            error_count: errorCount,
            fallback_count: fallbackCount,
            success_rate: successfulCalls / nextCount,
            avg_latency_ms: totalLatency / nextCount,
            latency_p50_ms: percentiles.p50,
            latency_p95_ms: percentiles.p95,
            fallback_rate: clamp01(fallbackCount / nextCount),
            user_satisfaction: totalSatisfaction / nextCount,
            last_called: Date.now(),
        };

        this.records.set(toolName, updated);
        await this.persistence?.upsertToolPerformance?.(updated);
    }

    public listRecords(): ToolPerformanceRecord[] {
        return Array.from(this.records.values())
            .sort((a, b) => b.last_called - a.last_called);
    }

    public async listRecordsAsync(): Promise<ToolPerformanceRecord[]> {
        await this.hydrateFromPersistence();
        return this.listRecords();
    }

    public getRecord(toolName: string): ToolPerformanceRecord | null {
        return this.records.get(toolName) ?? null;
    }

    private async hydrateFromPersistence(): Promise<void> {
        if (this.hydrated || !this.persistence?.listToolPerformance) return;
        if (this.hydrationPromise) return this.hydrationPromise;

        this.hydrationPromise = (async () => {
            try {
                const persisted = await this.persistence!.listToolPerformance();
                for (const record of persisted) {
                    this.records.set(record.tool_name, record);
                }
                this.hydrated = true;
            } finally {
                this.hydrationPromise = null;
            }
        })();
        return this.hydrationPromise;
    }

    private pushLatencySample(toolName: string, latencyMs: number): void {
        let samples = this.latencySamples.get(toolName);
        if (!samples) {
            samples = new NumericRingBuffer(Math.max(1, this.maxLatencySamples));
            this.latencySamples.set(toolName, samples);
        }
        samples.push(latencyMs);
    }

    private computeLatencyPercentiles(toolName: string): { p50: number; p95: number } {
        const samples = this.latencySamples.get(toolName);
        if (!samples || samples.length === 0) return { p50: 0, p95: 0 };
        const sorted = samples.toSortedArray();
        return {
            p50: this.percentile(sorted, 0.5),
            p95: this.percentile(sorted, 0.95),
        };
    }

    private percentile(sortedValues: number[], ratio: number): number {
        if (sortedValues.length === 0) return 0;
        const idx = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1));
        return sortedValues[idx];
    }
}

class NumericRingBuffer {
    private readonly values: Float64Array;
    private nextIndex = 0;
    private count = 0;

    constructor(private readonly capacity: number) {
        this.values = new Float64Array(capacity);
    }

    public get length(): number {
        return this.count;
    }

    public push(value: number): void {
        this.values[this.nextIndex] = value;
        this.nextIndex = (this.nextIndex + 1) % this.capacity;
        if (this.count < this.capacity) {
            this.count++;
        }
    }

    public toSortedArray(): number[] {
        const out = new Array<number>(this.count);
        const start = this.count < this.capacity ? 0 : this.nextIndex;
        for (let i = 0; i < this.count; i++) {
            out[i] = this.values[(start + i) % this.capacity];
        }
        out.sort((a, b) => a - b);
        return out;
    }
}
