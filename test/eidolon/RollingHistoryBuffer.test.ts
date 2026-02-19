import { describe, it, expect } from 'vitest';
import { RollingHistoryBuffer } from '../../packages/toolkit/src/eidolon/events/RollingHistoryBuffer';

describe('RollingHistoryBuffer', () => {
    it('should initialize with correct capacity', () => {
        const buffer = new RollingHistoryBuffer<number>(5);
        expect(buffer.length).toBe(0);
        expect(buffer.lifetimeCount).toBe(0);
    });

    it('should add items and increase size', () => {
        const buffer = new RollingHistoryBuffer<number>(5);
        buffer.push(1);
        buffer.push(2);

        expect(buffer.length).toBe(2);
        expect(buffer.lifetimeCount).toBe(2);
        expect(buffer.toArray()).toEqual([1, 2]);
    });

    it('should overwrite oldest items when full (Ring Buffer)', () => {
        const buffer = new RollingHistoryBuffer<number>(3);
        buffer.push(1);
        buffer.push(2);
        buffer.push(3);

        // At capacity
        expect(buffer.length).toBe(3);
        expect(buffer.toArray()).toEqual([1, 2, 3]);

        // Overflow
        buffer.push(4);
        expect(buffer.length).toBe(3); // Size caps at capacity
        expect(buffer.lifetimeCount).toBe(4);
        expect(buffer.toArray()).toEqual([2, 3, 4]); // 1 is gone

        buffer.push(5);
        expect(buffer.toArray()).toEqual([3, 4, 5]); // 2 is gone
    });

    it('should iterate correctly without allocation', () => {
        const buffer = new RollingHistoryBuffer<number>(3);
        buffer.push(10);
        buffer.push(20);
        buffer.push(30);
        buffer.push(40); // 10 overwriten

        const items: number[] = [];
        buffer.forEach((item, index) => {
            items.push(item);
        });

        expect(items).toEqual([20, 30, 40]);
    });

    it('should handle clear', () => {
        const buffer = new RollingHistoryBuffer<number>(3);
        buffer.push(1);
        buffer.push(2);
        buffer.clear();

        expect(buffer.length).toBe(0);
        expect(buffer.toArray()).toEqual([]);

        buffer.push(3);
        expect(buffer.toArray()).toEqual([3]);
    });
});
