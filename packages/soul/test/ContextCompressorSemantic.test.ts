import { describe, expect, it } from 'vitest';
import { ContextCompressor } from '../src/eidolon/ContextCompressor';
import type { Message } from '../src/eidolon/CognitiveTypes';

describe('ContextCompressor semantic pipeline', () => {
    it('deduplicates repeated content and stays inside planned budget', async () => {
        const compressor = new ContextCompressor();
        const messages: Message[] = [
            { role: 'user', content: 'Remember: never execute swaps without slippage guard.' },
            { role: 'assistant', content: 'Acknowledged. I will keep slippage guard mandatory.' },
            { role: 'user', content: 'Remember: never execute swaps without slippage guard.' },
            { role: 'assistant', content: 'Acknowledged. I will keep slippage guard mandatory.' },
            { role: 'user', content: 'Latency p95 increased to 2200ms after rollout phase B.' },
            { role: 'assistant', content: 'We should inspect routing and memory query hotspots first.' },
            { role: 'user', content: 'Please summarize and keep only key facts.' },
            { role: 'assistant', content: 'I will return concise key facts and critical context.' },
        ];

        const compressed = await compressor.compress(
            messages,
            220,
            2,
            {
                context_window: 1024,
                reserve_response_tokens: 700,
                compression_floor: 160,
            }
        );

        expect(compressed.verbatim.length).toBeLessThanOrEqual(2);
        expect(compressed.total_tokens).toBeLessThanOrEqual(220);
        expect(compressed.summaries.length).toBeGreaterThan(0);
        expect(compressed.summaries.length).toBeLessThanOrEqual(4);
        expect(compressed.key_facts.some((fact) => fact.toLowerCase().includes('never execute swaps'))).toBe(true);
    });

    it('keeps Vietnamese semantic cues during tokenization and fact extraction', async () => {
        const compressor = new ContextCompressor();
        const messages: Message[] = [
            { role: 'user', content: 'Nhớ giúp mình: đừng deploy khi chưa có rollback plan.' },
            { role: 'assistant', content: 'Đã rõ, mình sẽ giữ nguyên tắc đó.' },
            { role: 'user', content: 'đừng deploy khi chưa có rollback plan.' },
            { role: 'assistant', content: 'Mình sẽ tóm tắt ngắn gọn các điểm chính.' },
        ];

        const compressed = await compressor.compress(messages, 180, 1, {
            context_window: 1024,
            reserve_response_tokens: 700,
            compression_floor: 128,
        });

        expect(compressed.total_tokens).toBeLessThanOrEqual(180);
        expect(compressed.key_facts.some((fact) => fact.toLowerCase().includes('đừng deploy'))).toBe(true);
        expect(compressed.summaries.length).toBeGreaterThan(0);
    });
});
