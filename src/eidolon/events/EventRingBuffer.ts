/**
 * Zero-GC event ring buffer for hot event paths.
 * Reuses preallocated event objects to reduce allocation pressure.
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
        Object.assign(this.buffer[this.count], event);
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
