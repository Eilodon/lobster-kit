import { afterEach, describe, expect, it, vi } from 'vitest';
import { DivineTransparency } from '@clawkit/core';
import { DEFAULT_WEIGHTS, type MarketState } from '../src/eidolon/EidolonTypes';
import type { IOracle } from '../src/ai/IOracle';

const STABLE_MARKET_STATE: MarketState = {
    gasPrice: 'LOW',
    whaleFlow: 'NEUTRAL',
    sentiment: 'NEUTRAL',
    liquidityDepth: 'DEEP',
    priceAction: 'RANGING',
};

describe('DivineTransparency', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps bounded decision history and preserves chronological order after wrap', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });

        let seq = 0;
        const oracle = {
            getName: () => 'test-oracle',
            analyze: async () => ({
                weights: DEFAULT_WEIGHTS,
                narrative: `trace-${seq++}`,
            }),
            embed: async () => [],
        } as unknown as IOracle;

        const transparency = new DivineTransparency(oracle);
        const total = 1025;

        for (let i = 0; i < total; i++) {
            await transparency.explain(STABLE_MARKET_STATE, 'HOLD');
        }

        const history = transparency.getHistory();
        expect(history).toHaveLength(1000);
        expect(history[0].reasoning).toContain('trace-25');
        expect(history[history.length - 1].reasoning).toContain('trace-1024');

        const recent = transparency.getRecentDecisions(5);
        expect(recent).toHaveLength(5);
        expect(recent.map(item => item.reasoning)).toEqual(history.slice(-5).map(item => item.reasoning));

        const exported = JSON.parse(transparency.exportHistory()) as Array<{ reasoning: string }>;
        expect(exported).toHaveLength(1000);
        expect(exported[0].reasoning).toContain('trace-25');
    });

    it('returns empty recent decisions when count is non-positive', () => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        const transparency = new DivineTransparency();
        expect(transparency.getRecentDecisions(0)).toEqual([]);
        expect(transparency.getRecentDecisions(-7)).toEqual([]);
    });
});
