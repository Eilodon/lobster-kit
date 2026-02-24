/**
 * 🔒 ASYNC LOCK (Mutex)
 * Simple promise-based lock to ensure sequential execution of async tasks.
 * Prevents race conditions in file I/O and state updates.
 *
 * UPGRADE: Added `timeoutMs` to prevent indefinite deadlock at scale.
 */
interface LockWaiter {
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    timer?: NodeJS.Timeout;
    cancelled: boolean;
    granted: boolean;
}

export class AsyncLock {
    private locked = false;
    private queue: LockWaiter[] = [];

    /**
     * Acquire the lock and run the task.
     *
     * @param task      The async function to execute safely.
     * @param timeoutMs Max time (ms) to wait for the lock. 0 = no limit.
     *                  Throws if the lock cannot be acquired within the budget.
     * @returns         The result of the task.
     */
    async run<T>(task: () => Promise<T>, timeoutMs: number = 0): Promise<T> {
        const release = await this.acquire(timeoutMs);

        try {
            return await task();
        } finally {
            release();
        }
    }

    private acquire(timeoutMs: number): Promise<() => void> {
        if (timeoutMs < 0) {
            throw new Error('AsyncLock: timeoutMs must be >= 0');
        }

        if (!this.locked) {
            this.locked = true;
            return Promise.resolve(this.createRelease());
        }

        return new Promise<() => void>((resolve, reject) => {
            const waiter: LockWaiter = {
                resolve,
                reject,
                cancelled: false,
                granted: false,
            };

            if (timeoutMs > 0) {
                waiter.timer = setTimeout(() => {
                    if (waiter.granted || waiter.cancelled) return;
                    waiter.cancelled = true;
                    const idx = this.queue.indexOf(waiter);
                    if (idx >= 0) this.queue.splice(idx, 1);
                    waiter.reject(new Error(`AsyncLock: timeout after ${timeoutMs}ms`));
                }, timeoutMs);
                if (waiter.timer.unref) waiter.timer.unref();
            }

            this.queue.push(waiter);
        });
    }

    private createRelease(): () => void {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.handoff();
        };
    }

    private handoff(): void {
        while (this.queue.length > 0) {
            const next = this.queue.shift();
            if (!next || next.cancelled) continue;

            next.granted = true;
            if (next.timer) clearTimeout(next.timer);
            next.resolve(this.createRelease());
            return;
        }

        this.locked = false;
    }
}
