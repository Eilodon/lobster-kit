
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmotionalCore } from '../../src/eidolon/EmotionalCore';

describe('EmotionalCore: Memory Management & Dispose', () => {
    let core: EmotionalCore;

    beforeEach(() => {
        vi.useFakeTimers();
        core = new EmotionalCore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should debounce saves to prevent I/O epilepsy', async () => {
        const saveSpy = vi.spyOn(core, 'saveState').mockResolvedValue(undefined);

        // Trigger multiple saves rapidly
        await core.debouncedSave();
        await core.debouncedSave();
        await core.debouncedSave();

        expect(saveSpy).not.toHaveBeenCalled(); // Should handle immediately? No, setTimeout 10000

        // Fast forward 5s
        vi.advanceTimersByTime(5000);
        expect(saveSpy).not.toHaveBeenCalled();

        // Fast forward another 5.1s
        vi.advanceTimersByTime(5100);
        expect(saveSpy).toHaveBeenCalledTimes(1); // Should be called ONCE
    });

    it('should clear timeout on dispose (Zombie Process Fix)', async () => {
        const saveSpy = vi.spyOn(core, 'saveState').mockResolvedValue(undefined);

        await core.debouncedSave();

        // Dispose before timer fires
        core.dispose();

        // Fast forward past timeout
        vi.advanceTimersByTime(11000);

        expect(saveSpy).not.toHaveBeenCalled(); // Should NOT be called
    });
});
