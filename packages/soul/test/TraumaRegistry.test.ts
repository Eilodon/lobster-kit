import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TraumaRegistry } from '../src/eidolon/TraumaRegistry';

describe('TraumaRegistry (Immune Memory)', () => {
    let registry: TraumaRegistry;
    const mockStorage = {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        append: vi.fn().mockResolvedValue(undefined),
        readLog: vi.fn().mockResolvedValue([]),
        list: vi.fn().mockResolvedValue([]),
        init: vi.fn().mockResolvedValue(undefined)
    };

    beforeEach(() => {
        registry = new TraumaRegistry();
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should block action after first trauma', () => {
        const mode = 'Berserk';
        const action = 'Swap-BNB';

        expect(registry.isInhibited(mode, action)).toBe(false);

        // First trauma: 1 hour block
        registry.recordTrauma(mode, action, 0.5);

        expect(registry.isInhibited(mode, action)).toBe(true);
        expect(registry.getRemainingInhibition(mode, action)).toBeGreaterThan(0);

        // Advance 30 mins
        vi.advanceTimersByTime(30 * 60 * 1000);
        expect(registry.isInhibited(mode, action)).toBe(true);

        // Advance another 31 mins (total 61 mins)
        vi.advanceTimersByTime(31 * 60 * 1000);
        expect(registry.isInhibited(mode, action)).toBe(false);
    });

    it('should escalate backoff exponentially', () => {
        const mode = 'Berserk';
        const action = 'RugPull';

        // 1st hit: 1h
        registry.recordTrauma(mode, action, 0.5);
        let hit = (registry as any).records.get((registry as any).hashContext(mode, action));
        expect(hit.count).toBe(1);

        // 2nd hit: should be 2h from NOW
        vi.advanceTimersByTime(61 * 60 * 1000); // Wait for first to clear
        registry.recordTrauma(mode, action, 0.5);

        hit = (registry as any).records.get((registry as any).hashContext(mode, action));
        expect(hit.count).toBe(2);

        // Inhibit duration check: 2 * 3600 * 1000
        const expectedUntil = Date.now() + 2 * 3600 * 1000;
        expect(hit.inhibitUntil).toBe(expectedUntil);

        // 3rd hit: 4h
        registry.recordTrauma(mode, action, 0.5);
        hit = (registry as any).records.get((registry as any).hashContext(mode, action));
        expect(hit.count).toBe(3);

        // 4th hit: 8h
        registry.recordTrauma(mode, action, 0.5);
        hit = (registry as any).records.get((registry as any).hashContext(mode, action));
        expect(hit.count).toBe(4);
    });

    it('should clear trauma correctly', () => {
        const mode = 'Zen';
        const action = 'BadTrade';
        registry.recordTrauma(mode, action, 1.0);
        expect(registry.isInhibited(mode, action)).toBe(true);

        registry.heal(mode, action);
        expect(registry.isInhibited(mode, action)).toBe(false);
        expect(registry.getEffectiveSeverity(mode, action)).toBe(0);
    });

    it('should distinguish contexts', () => {
        registry.recordTrauma('ModeA', 'Action1', 0.5);

        expect(registry.isInhibited('ModeA', 'Action1')).toBe(true);
        expect(registry.isInhibited('ModeA', 'Action2')).toBe(false);
        expect(registry.isInhibited('ModeB', 'Action1')).toBe(false);
    });

    it('should persist and restore trauma records', async () => {
        await registry.initPersistence(mockStorage as any, 'trauma_test.json');
        registry.recordTrauma('Zen', 'BUY', 1.0);
        await registry.flush();

        expect(mockStorage.save).toHaveBeenCalledWith(
            'trauma_test.json',
            expect.objectContaining({ records: expect.any(Array) })
        );

        const savedPayload = mockStorage.save.mock.calls[0][1];
        mockStorage.load.mockResolvedValueOnce(savedPayload);

        const restored = new TraumaRegistry();
        await restored.initPersistence(mockStorage as any, 'trauma_test.json');
        expect(restored.isInhibited('Zen', 'BUY')).toBe(true);
    });
});
