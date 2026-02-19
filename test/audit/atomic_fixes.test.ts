
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventRingBuffer } from '../../src/eidolon/events/EventRingBuffer';
import { DivineTransparency } from '../../src/eidolon/DivineTransparency';
import { WasmAdapter } from '../../src/eidolon/WasmAdapter';
import { ActiveLearning } from '../../src/eidolon/ActiveLearning';
import { MarketState } from '../../src/eidolon/EidolonTypes';

describe('Deep Atomic Audit Fixes Verification', () => {

    describe('C1: Ghost Events in EventRingBuffer', () => {
        it('should not leak properties from previous events when reusing slots', () => {
            // Buffer size 1 to force reuse
            const buffer = new EventRingBuffer<any>(1, () => ({ id: 0 }));
            const emitted: any[] = [];
            const collector = (e: any) => emitted.push({ ...e }); // Clone to capture state at drain time

            // 1. Push Event A with extra prop
            buffer.push({ id: 1, ghost: 'boo' });
            buffer.drain(collector);

            expect(emitted[0].id).toBe(1);
            expect(emitted[0].ghost).toBe('boo');

            // 2. Clear emitted
            emitted.length = 0;

            // 3. Push Event B without extra prop (Reuse slot 0)
            // If Object.assign bug was present, it would merge B into the object at slot 0 (which has ghost)
            buffer.push({ id: 2 });
            buffer.drain(collector);

            // 4. Verify B is clean
            expect(emitted[0].id).toBe(2);
            expect(emitted[0].ghost).toBeUndefined();
        });
    });

    describe('C3: DivineTransparency Mutation Leak', () => {
        it('should not permanently mutate base weights when Oracle provides insight', async () => {
            const mind = new DivineTransparency();
            const originalWeight = mind['weights'].whaleFlow.ACCUMULATING;

            // Mock Oracle
            const mockOracle = {
                analyze: vi.fn().mockResolvedValue({
                    weights: {
                        whaleFlow: { ACCUMULATING: 999 } // Extreme override
                    },
                    narrative: 'Test Narrative'
                })
            };
            (mind as any).oracle = mockOracle;

            const state: MarketState = {
                gasPrice: 'LOW',
                whaleFlow: 'ACCUMULATING',
                sentiment: 'NEUTRAL',
                liquidityDepth: 'DEEP',
                priceAction: 'RANGING'
            };

            // First call - should use overridden weight
            await mind.explain(state, 'BUY');

            // Check if base weights are mutated
            expect(mind['weights'].whaleFlow.ACCUMULATING).toBe(originalWeight);
            expect(mind['weights'].whaleFlow.ACCUMULATING).not.toBe(999);
        });
    });

    describe('H1: WasmAdapter Singleton Reset', () => {
        it('should allow resetting the singleton instance', () => {
            const instance1 = WasmAdapter.getInstance();
            (instance1 as any)._testProp = 'original';

            WasmAdapter.resetInstance();

            const instance2 = WasmAdapter.getInstance();
            expect(instance2).not.toBe(instance1);
            expect((instance2 as any)._testProp).toBeUndefined();
        });
    });

    describe('H5: ActiveLearning Q-Table Cap', () => {
        it('should prune Q-Table when it exceeds limit', () => {
            const brain = new ActiveLearning();
            const qTable = (brain as any).qTable;

            // Fill with 5005 entries
            for (let i = 0; i < 5005; i++) {
                qTable[`state_${i}`] = { BUY: 0, SELL: 0, HOLD: 0, EMERGENCY_EXIT: 0 };
            }

            expect(Object.keys(qTable).length).toBe(5005);

            // Trigger update which triggers prune
            (brain as any).pruneMemory();

            const newSize = Object.keys((brain as any).qTable).length;
            expect(newSize).toBeLessThan(5000);
            expect(newSize).toBeGreaterThan(0);
        });
    });

});
