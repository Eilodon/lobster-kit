import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EidolonBus, EidolonEventType } from '@clawkit/core';

describe('EidolonBus re-entrancy guard', () => {
    let bus: EidolonBus;

    beforeEach(() => {
        bus = EidolonBus.getInstance();
        bus.removeAllListeners();
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    it('queues nested emits instead of recursive drain calls', () => {
        const seen: string[] = [];

        const unsubPrice = bus.subscribe(EidolonEventType.PRICE_UPDATE, () => {
            seen.push('price');
            bus.emitEvent({
                type: EidolonEventType.TRAUMA,
                timestamp: Date.now(),
                payload: { reason: 'nested', severity: 10 },
            });
        });

        const unsubTrauma = bus.subscribe(EidolonEventType.TRAUMA, () => {
            seen.push('trauma');
        });

        bus.emitEvent({
            type: EidolonEventType.PRICE_UPDATE,
            timestamp: Date.now(),
            payload: { symbol: 'BNBUSDT', price: 600, source: 'BINANCE_WS' },
        });

        expect(seen).toEqual(['price', 'trauma']);
        unsubPrice();
        unsubTrauma();
    });
});
