import { describe, it, expect } from 'vitest';
import { DirtyComponentMask, DirtyMask, DirtyTracker } from '@eidolon/core';

describe('DirtyTracker', () => {
    it('should mark and query dirty peers by mask', () => {
        const tracker = new DirtyTracker();
        tracker.markDirty('peer-a', DirtyMask.PEER_DISCOVERY);
        tracker.markDirty('peer-a', DirtyMask.GOSSIP);
        tracker.markDirty('peer-b', DirtyMask.DANGER);

        expect(tracker.isDirty('peer-a')).toBe(true);
        expect(tracker.isDirty('peer-a', DirtyMask.GOSSIP)).toBe(true);
        expect(tracker.isDirty('peer-b', DirtyMask.GOSSIP)).toBe(false);
        expect(tracker.getDirtyPeers(DirtyMask.DANGER)).toEqual(['peer-b']);
    });

    it('should clear peer dirty state', () => {
        const tracker = new DirtyTracker();
        tracker.markDirty('peer-a', DirtyMask.GOSSIP);
        tracker.clear('peer-a');
        expect(tracker.isDirty('peer-a')).toBe(false);
    });

    it('should support standardized component mask operations', () => {
        const tracker = new DirtyTracker();
        tracker.markComponentDirty('peer-c', DirtyComponentMask.MARKET_STATE);
        tracker.markComponentDirty('peer-c', DirtyComponentMask.GOSSIP_STATE);

        expect(tracker.isComponentDirty('peer-c', DirtyComponentMask.MARKET_STATE)).toBe(true);
        expect(tracker.isComponentDirty('peer-c', DirtyComponentMask.POSITION_STATE)).toBe(false);

        tracker.clearMask('peer-c', DirtyComponentMask.MARKET_STATE);
        expect(tracker.isComponentDirty('peer-c', DirtyComponentMask.MARKET_STATE)).toBe(false);
        expect(tracker.isComponentDirty('peer-c', DirtyComponentMask.GOSSIP_STATE)).toBe(true);
    });
});
