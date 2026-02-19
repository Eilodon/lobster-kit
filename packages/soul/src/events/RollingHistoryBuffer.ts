/**
 * 🔄 ROLLING HISTORY BUFFER (Ring Buffer)
 * Zero-allocation circular buffer for storing fixed-size history.
 * Eliminates GC spikes caused by repeated array slicing/resizing.
 */
export class RollingHistoryBuffer<T> {
    private readonly buffer: (T | null)[];
    private capacity: number;
    private writePtr: number = 0; // Points to next write index
    private size: number = 0;     // Current number of elements
    private totalAdded: number = 0; // Total lifetime elements added

    constructor(capacity: number) {
        this.capacity = capacity;
        // Pre-allocate array to full size with nulls
        this.buffer = new Array(capacity).fill(null);
    }

    /**
     * Add an item to the buffer, overwriting oldest if full.
     * O(1) complexity.
     */
    push(item: T): void {
        this.buffer[this.writePtr] = item;

        // Move pointer forward (wrap around)
        this.writePtr = (this.writePtr + 1) % this.capacity;

        // Update size (caps at capacity)
        if (this.size < this.capacity) {
            this.size++;
        }

        this.totalAdded++;
    }

    /**
     * Get all elements in chronological order (Oldest -> Newest).
     * O(N) complexity (creates new array).
     * Use iterator for zero-allocation traversal.
     */
    toArray(): T[] {
        if (this.size === 0) return [];

        const result: T[] = new Array(this.size);

        // If not full, indices are 0 to size-1
        // If full, oldest is at writePtr, newest is at writePtr-1

        const start = this.size < this.capacity ? 0 : this.writePtr;

        for (let i = 0; i < this.size; i++) {
            result[i] = this.buffer[(start + i) % this.capacity] as T;
        }

        return result;
    }

    /**
     * Iterate over elements from oldest to newest without allocation.
     */
    forEach(callback: (item: T, index: number) => void): void {
        if (this.size === 0) return;

        const start = this.size < this.capacity ? 0 : this.writePtr;

        for (let i = 0; i < this.size; i++) {
            const item = this.buffer[(start + i) % this.capacity] as T;
            callback(item, i);
        }
    }

    get length(): number {
        return this.size;
    }

    get lifetimeCount(): number {
        return this.totalAdded;
    }

    /**
     * Clear buffer (keeps allocated array).
     */
    clear(): void {
        this.writePtr = 0;
        this.size = 0;
        // Optional: null out references to help GC if T is large, 
        // but for primitive/small objects, overwrite is enough.
        this.buffer.fill(null);
    }

    /**
     * Randomly sample K elements from the buffer.
     */
    sample(batchSize: number): T[] {
        if (this.size === 0) return [];
        const count = Math.min(batchSize, this.size);
        const result: T[] = [];
        const indices = new Set<number>();

        while (indices.size < count) {
            const idx = Math.floor(Math.random() * this.size);
            indices.add(idx);
        }

        const start = this.size < this.capacity ? 0 : this.writePtr;
        for (const idx of indices) {
            result.push(this.buffer[(start + idx) % this.capacity] as T);
        }
        return result;
    }
}
