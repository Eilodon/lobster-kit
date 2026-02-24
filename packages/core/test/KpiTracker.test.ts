import { describe, expect, it, vi } from 'vitest';
import { KpiTracker } from '../src/metrics/KpiTracker';

describe('KpiTracker', () => {
    it('reuses cached p95 until new latency samples are recorded', () => {
        const tracker = new KpiTracker();
        tracker.recordDecisionLatency(100);
        tracker.recordDecisionLatency(200);
        tracker.recordDecisionLatency(300);

        const sortSpy = vi.spyOn(Array.prototype, 'sort');

        tracker.getSnapshot();
        tracker.getSnapshot();
        expect(sortSpy).toHaveBeenCalledTimes(1);

        tracker.recordDecisionLatency(400);
        tracker.getSnapshot();
        expect(sortSpy).toHaveBeenCalledTimes(2);

        sortSpy.mockRestore();
    });
});
