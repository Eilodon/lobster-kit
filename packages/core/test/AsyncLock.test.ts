import { describe, it, expect } from 'vitest';
import { AsyncLock } from '../src/utils/AsyncLock';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('AsyncLock', () => {
    it('keeps mutual exclusion when a queued waiter times out', async () => {
        const lock = new AsyncLock();
        const events: string[] = [];
        let task1Running = false;

        const task1 = lock.run(async () => {
            task1Running = true;
            events.push('task1:start');
            await sleep(80);
            task1Running = false;
            events.push('task1:end');
        });

        const task2 = lock.run(async () => {
            events.push('task2:run');
        }, 20).catch((error: unknown) => {
            events.push('task2:timeout');
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('timeout');
        });

        await sleep(30);

        const task3 = lock.run(async () => {
            events.push(`task3:start:${task1Running ? 'running' : 'idle'}`);
            events.push('task3:end');
        });

        await Promise.allSettled([task1, task2, task3]);

        expect(events).not.toContain('task2:run');
        const task1End = events.indexOf('task1:end');
        const task3Start = events.findIndex(e => e.startsWith('task3:start:'));
        expect(task1End).toBeGreaterThan(-1);
        expect(task3Start).toBeGreaterThan(task1End);
        expect(events[task3Start]).toBe('task3:start:idle');
    });

    it('rejects negative timeout values', async () => {
        const lock = new AsyncLock();
        await expect(lock.run(async () => 1, -1)).rejects.toThrow('timeoutMs must be >= 0');
    });
});
