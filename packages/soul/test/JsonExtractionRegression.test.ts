import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFirstJsonPayload, parseFirstJsonObject } from '../src/utils/jsonExtraction';
import { SwarmOrchestrator } from '../src/swarm/SwarmOrchestrator';
import { DeepSeekOracle } from '../src/ai/DeepSeekOracle';

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

describe('JSON extraction hardening', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('extracts the first valid JSON object even when trailing text contains braces', () => {
        const raw = [
            'Here is your JSON:',
            '```json',
            '{"ok":true,"note":"brace } inside string is valid"}',
            '```',
            '(Note: do not use the { symbol incorrectly)',
        ].join('\n');

        const payload = extractFirstJsonPayload(raw);
        expect(payload).toBe('{"ok":true,"note":"brace } inside string is valid"}');
        expect(parseFirstJsonObject(raw)).toEqual({
            ok: true,
            note: 'brace } inside string is valid',
        });
    });

    it('keeps SwarmOrchestrator oracle delegation resilient to trailing brace noise', async () => {
        const oracle = {
            generate: vi.fn().mockResolvedValue(
                '{"ok":true,"data":{"result":"delegated"}}\n(Note: do not append { malformed'
            ),
        };

        const orchestrator = new SwarmOrchestrator(oracle);
        const agentId = await orchestrator.spawnAgent('planner', 'delegate');
        const result = await orchestrator.delegate('delegate now', agentId, 1_000);

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ result: 'delegated' });
    });

    it('generates monotonic agent ids without random-string allocation', async () => {
        const orchestrator = new SwarmOrchestrator();
        const idA = await orchestrator.spawnAgent('planner', 'task a');
        const idB = await orchestrator.spawnAgent('planner', 'task b');

        const suffixA = Number(idA.split('-').pop());
        const suffixB = Number(idB.split('-').pop());
        expect(Number.isInteger(suffixA)).toBe(true);
        expect(suffixB).toBe(suffixA + 1);
    });

    it('normalizes oracle json output when response includes extra commentary braces', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{
                    message: {
                        content: '{"signal":"buy","score":0.82}\nNote: keep { off extra text',
                    },
                }],
            }),
        });

        const oracle = new DeepSeekOracle({ apiKey: 'test-key' });
        const output = await oracle.generate('Return JSON', { json: true, maxTokens: 200 });

        expect(output).toBe('{"signal":"buy","score":0.82}');
    });
});
