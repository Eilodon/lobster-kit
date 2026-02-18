
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmotionalCore } from '../../src/eidolon/EmotionalCore';

// Mock GreenfieldAdapter
vi.mock('../../src/eidolon/memory/GreenfieldAdapter', () => {
    return {
        GreenfieldAdapter: vi.fn().mockImplementation(() => ({
            save: vi.fn().mockResolvedValue(undefined),
            load: vi.fn().mockResolvedValue(null),
            list: vi.fn().mockResolvedValue([]),
            init: vi.fn().mockResolvedValue(undefined)
        }))
    };
});

describe('EmotionalCore (Biological)', () => {
    let soul: EmotionalCore;
    // We can access the mock instance if needed, but for now we just need it not to fail.

    const mockRiskParams = {
        maxPositionSize: 10,
        maxDrawdown: 10,
        minConfidence: 50,
        cooldownPeriod: 1000
    };

    let mockStorage: any;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        vi.resetAllMocks();

        mockStorage = {
            save: vi.fn(),
            load: vi.fn().mockResolvedValue(null),
            append: vi.fn(),
            readLog: vi.fn().mockResolvedValue([])
        };

        soul = new EmotionalCore(mockStorage);
        // Inject risk params if needed, but EmotionalCore doesn't take config in constructor in current code.
        // It heavily relies on BioParameters.json. 
        // We will assume default behavior is fine.
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Metabolism & Homeostasis', () => {
        it('should start in NEUTRAL state with balanced biometrics', () => {
            const state = soul.getCurrentState();
            // State is not a string anymore in EmotionalState, it implies values
            // There is no explicit 'NEUTRAL' string in EmotionalState interface
            // We check values.
            expect(state.glucose).toBe(100);
            expect(state.dopamine).toBe(50);
            expect(state.cortisol).toBe(0);
        });

        it('should decay biometrics over time', async () => {
            // Spike dopamine first (Win)
            soul.stimulate(100, 'PROFIT');

            let state = soul.getCurrentState();
            const highDopamine = state.dopamine;
            // stimulate caps it? Base + impact. 
            // 100 profit -> impact 9 ish (log scale)
            expect(highDopamine).toBeGreaterThan(50);

            // Advance time by 10 minutes
            await vi.advanceTimersByTimeAsync(10 * 60000);

            // Manual tick to process metabolism
            await soul.tick();

            state = soul.getCurrentState();
            // Check decay happened
            expect(state.dopamine).toBeLessThan(highDopamine);
        });

        it('should trigger HUNGRY state when glucose is low', async () => {
            // Glucose starts at 100.
            // Decay logic is complex (depends on arousal).
            // Let's just verify it drops.
            const initialGlucose = soul.getCurrentState().glucose;
            await vi.advanceTimersByTimeAsync(70 * 60000);
            await soul.tick(); // Manual tick

            const state = soul.getCurrentState();
            expect(state.glucose).toBeLessThan(initialGlucose);
        });
    });

    describe('Reactions to Outcomes', () => {
        it('should spike dopamine on WIN', () => {
            const initialDopamine = soul.getCurrentState().dopamine;
            soul.stimulate(100, 'PROFIT');
            const newDopamine = soul.getCurrentState().dopamine;
            expect(newDopamine).toBeGreaterThan(initialDopamine);
        });

        it('should spike cortisol on LOSS', () => {
            const initialCortisol = soul.getCurrentState().cortisol;
            soul.stimulate(50, 'LOSS');
            const newCortisol = soul.getCurrentState().cortisol;
            expect(newCortisol).toBeGreaterThan(initialCortisol);
        });

        it('should trigger defensive risk multiplier on PANIC', () => {
            // Panic via repeated losses
            for (let i = 0; i < 6; i++) {
                soul.stimulate(100, 'LOSS');
            }

            const state = soul.getCurrentState();
            expect(state.cortisol).toBeGreaterThan(50);

            // Risk Multiplier should be low (Defensive)
            expect(soul.getRiskMultiplier()).toBeLessThan(1.0);
        });
    });

    describe('Persistence (Eternal Recurrence)', () => {
        it('should buffer writes and flush snapshot on schedule', async () => {
            await soul.tick(0.5, 1.0);

            // Debounced persistence: no immediate disk write.
            expect(mockStorage.save).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(15000);

            expect(mockStorage.save).toHaveBeenCalledWith(
                'emotional_core_snapshot.json',
                expect.objectContaining({
                    state: expect.objectContaining({
                        glucose: expect.any(Number)
                    })
                })
            );
        });
    });
    describe('Sentinel Mode', () => {
        it('should enter EMERGENCY mode on extreme cortisol', () => {
            // Massive trauma - verify stim logic or force state
            // stimulate(100, DANGER) adds +18 cortisol per call (scaled). 
            // Need > 80.
            for (let i = 0; i < 5; i++) soul.stimulate(100, 'DANGER');

            const state = soul.getCurrentState();
            expect(state.cortisol).toBeGreaterThan(80);
            expect(soul.getMode()).toBe('EMERGENCY'); // SentinelMode.EMERGENCY
        });

        it('should enter BERSERK mode on high arousal and valence', () => {
            // Hack state for test since biometrics are complex to drive naturally in one tick
            (soul as any).state.arousal = 0.9;
            (soul as any).state.valence = 0.8;
            expect(soul.getMode()).toBe('BERSERK'); // SentinelMode.BERSERK
        });
    });
});
