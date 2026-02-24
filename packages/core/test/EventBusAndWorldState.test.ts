import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EidolonBus, EidolonEventType } from '../src/events/EidolonBus';
import { createAction } from '../src/types/CapabilityAction';
import { createWorldState, isWorldState } from '../src/types/WorldState';

describe('Event bus + world state guards', () => {
    let bus: EidolonBus;

    beforeEach(() => {
        bus = EidolonBus.getInstance();
        bus.removeAllListeners();
    });

    it('validates typed subscriptions with zod at runtime', () => {
        const onPrice = vi.fn();
        const schema = z.object({
            type: z.literal(EidolonEventType.PRICE_UPDATE),
            timestamp: z.number(),
            payload: z.object({
                symbol: z.string(),
                price: z.number(),
                source: z.enum(['PYTH', 'DEX', 'BINANCE_WS']),
                change24h: z.number().optional(),
            }),
        });

        const unsub = bus.subscribeTypedValidated(EidolonEventType.PRICE_UPDATE, schema, onPrice);

        bus.emitEvent({
            type: EidolonEventType.PRICE_UPDATE,
            timestamp: Date.now(),
            payload: { symbol: 'BNBUSDT', price: 604.2, source: 'BINANCE_WS' },
        });

        bus.emitEvent({
            type: EidolonEventType.PRICE_UPDATE,
            timestamp: Date.now(),
            payload: { symbol: 'BNBUSDT', price: '604.2', source: 'BINANCE_WS' } as any,
        });

        expect(onPrice).toHaveBeenCalledTimes(1);
        unsub();
    });

    it('uses monotonic counter in action ids', () => {
        const a1 = createAction('defi', { side: 'BUY' });
        const a2 = createAction('defi', { side: 'SELL' });

        const suffix1 = Number(a1.id.split('-').pop());
        const suffix2 = Number(a2.id.split('-').pop());

        expect(Number.isFinite(suffix1)).toBe(true);
        expect(Number.isFinite(suffix2)).toBe(true);
        expect(suffix2).toBe(suffix1 + 1);
    });

    it('rejects malformed world states', () => {
        const valid = createWorldState('defi', { symbol: 'BNBUSDT' }, 0.8);
        expect(isWorldState(valid)).toBe(true);

        expect(isWorldState({ ...valid, confidence: 1.2 })).toBe(false);
        expect(isWorldState({ ...valid, sensory: null })).toBe(false);
        expect(isWorldState({ ...valid, sensory: [] })).toBe(false);
        expect(isWorldState({ ...valid, domain: '   ' })).toBe(false);
        expect(isWorldState({ ...valid, meta: [] })).toBe(false);
    });
});
