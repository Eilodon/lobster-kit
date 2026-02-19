import { describe, it, expect } from 'vitest';
import { EventRingBuffer } from '../src/eidolon/events/EventRingBuffer';

describe('EventRingBuffer', () => {
    it('should push and drain events in order', () => {
        const ring = new EventRingBuffer<{ id: number; payload?: string }>(4, () => ({ id: 0 }));
        ring.push({ id: 1, payload: 'a' });
        ring.push({ id: 2, payload: 'b' });

        const out: number[] = [];
        ring.drain((event) => {
            out.push(event.id);
        });

        expect(out).toEqual([1, 2]);
    });

    it('should track overflow without throwing', () => {
        const ring = new EventRingBuffer<{ id: number }>(1, () => ({ id: 0 }));
        expect(ring.push({ id: 1 })).toBe(true);
        expect(ring.push({ id: 2 })).toBe(false);
        expect(ring.getOverflowCount()).toBe(1);
    });
});
