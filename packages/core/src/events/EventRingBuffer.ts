/**
 * Event ring buffer for hot event paths.
 * Originally "Zero-GC", now favored "Correctness" over zero-allocation for object properties.
 * Still reduces array resizing pressure.
 */
export class EventRingBuffer<T extends object> {
    private readonly buffer: T[];
    private count = 0;
    private overflowCount = 0;

    constructor(
        private readonly capacity: number,
        private readonly factory: () => T
    ) {
        this.buffer = Array.from({ length: capacity }, () => this.factory());
    }

    push(event: T): boolean {
        if (this.count >= this.capacity) {
            this.overflowCount++;
            return false;
        }
        // FIX C1: Ghost Event Bug
        // Originally: Object.assign(this.buffer[this.count], event);
        // Problem: Merged new event props into OLD object, keeping stale props (e.g. lossAmount).
        // Solution: Direct assignment. We lose 'Zero-GC' benefit if 'event' is fresh (which it is),
        // but we gain correctness. GC handles the old reference.
        this.buffer[this.count] = event;
        this.count++;
        return true;
    }

    drain(callback: (event: T) => void): void {
        for (let i = 0; i < this.count; i++) {
            callback(this.buffer[i]);
        }
        this.count = 0;
    }

    getOverflowCount(): number {
        return this.overflowCount;
    }
}
