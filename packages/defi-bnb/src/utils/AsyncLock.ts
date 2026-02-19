/**
 * 🔒 ASYNC LOCK (Mutex)
 * Simple promise-based lock to ensure sequential execution of async tasks.
 * Prevents race conditions in file I/O and state updates.
 *
 * UPGRADE: Added `timeoutMs` to prevent indefinite deadlock at scale.
 */
export class AsyncLock {
    private promise: Promise<void>;

    constructor() {
        this.promise = Promise.resolve();
    }

    /**
     * Acquire the lock and run the task.
     *
     * @param task      The async function to execute safely.
     * @param timeoutMs Max time (ms) to wait for the lock. 0 = no limit.
     *                  Throws if the lock cannot be acquired within the budget.
     * @returns         The result of the task.
     */
    async run<T>(task: () => Promise<T>, timeoutMs: number = 0): Promise<T> {
        let release!: () => void;

        const nextPromise = new Promise<void>(resolve => {
            release = resolve;
        });

        const lockWait = this.promise;
        this.promise = nextPromise;

        // Wait for previous task — with optional timeout guard
        if (timeoutMs > 0) {
            let timer: NodeJS.Timeout;
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`AsyncLock: timeout after ${timeoutMs}ms`)),
                    timeoutMs,
                );
                if (timer.unref) timer.unref();
            });
            try {
                await Promise.race([lockWait, timeout]);
            } catch (err) {
                // Timeout waiting for lock: release chain and propagate
                release();
                throw err;
            } finally {
                clearTimeout(timer!);
            }
        } else {
            await lockWait;
        }

        try {
            return await task();
        } finally {
            release();
        }
    }
}
