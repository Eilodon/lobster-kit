import { describe, expect, it } from 'vitest';
import { SQLiteLearningStore } from '../src/memory/SQLiteLearningStore';

describe('SQLiteLearningStore', () => {
    it('applies LIMIT when listing tool performance from sqlite backend', async () => {
        const store = new SQLiteLearningStore({ allowFallback: false });

        const rows = [
            {
                tool_name: 'alpha',
                call_count: 10,
                error_count: 1,
                fallback_count: 0,
                success_rate: 0.9,
                avg_latency_ms: 22,
                latency_p50_ms: 20,
                latency_p95_ms: 31,
                fallback_rate: 0,
                user_satisfaction: 0.8,
                last_called: 1000,
            },
            {
                tool_name: 'beta',
                call_count: 4,
                error_count: 0,
                fallback_count: 0,
                success_rate: 1,
                avg_latency_ms: 10,
                latency_p50_ms: 9,
                latency_p95_ms: 13,
                fallback_rate: 0,
                user_satisfaction: 0.95,
                last_called: 900,
            },
            {
                tool_name: 'gamma',
                call_count: 2,
                error_count: 1,
                fallback_count: 1,
                success_rate: 0.5,
                avg_latency_ms: 80,
                latency_p50_ms: 70,
                latency_p95_ms: 95,
                fallback_rate: 0.5,
                user_satisfaction: 0.3,
                last_called: 800,
            },
        ];

        let capturedSql = '';
        let capturedLimit = 0;

        (store as unknown as { db: unknown }).db = {
            pragma: () => {},
            exec: () => {},
            close: () => {},
            prepare: (sql: string) => {
                capturedSql = sql;
                return {
                    run: () => {},
                    get: () => undefined,
                    all: (limit: number) => {
                        capturedLimit = limit;
                        return rows.slice(0, limit);
                    },
                };
            },
        };

        const result = await store.listToolPerformance(2);
        expect(capturedSql).toContain('LIMIT ?');
        expect(capturedLimit).toBe(2);
        expect(result).toHaveLength(2);
        expect(result[0].tool_name).toBe('alpha');
        expect(result[1].tool_name).toBe('beta');
    });
});
