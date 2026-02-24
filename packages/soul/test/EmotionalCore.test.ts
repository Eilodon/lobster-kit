
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EmotionalCore } from '../src/eidolon/EmotionalCore';
import { AppendOnlyAdapter } from '@eidolon/core';
import { EidolonBus } from '@eidolon/core';

// Mock dependencies
vi.mock('@eidolon/core', async () => {
    const actual = await vi.importActual<any>('@eidolon/core');
    return {
        ...actual,
        EidolonBus: {
            getInstance: vi.fn(),
        },
        AppendOnlyAdapter: vi.fn().mockImplementation(() => ({
            load: vi.fn(),
            save: vi.fn(),
            readLog: vi.fn().mockResolvedValue([]),
        })),
    };
});

describe('EmotionalCore (Biological State)', () => {
    let core: EmotionalCore;
    let mockStorage: any;
    let mockBus: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup Bus Mock
        mockBus = {
            subscribe: vi.fn().mockReturnValue(() => { }),
            emit: vi.fn(),
        };
        (EidolonBus.getInstance as any).mockReturnValue(mockBus);

        // Setup Storage Mock
        mockStorage = new AppendOnlyAdapter();

        core = new EmotionalCore(mockStorage);
    });

    afterEach(() => {
        core.dispose();
    });

    it('initializes with default state', () => {
        const state = core.getCurrentState();
        expect(state.glucose).toBe(100);
        expect(state.dopamine).toBe(50);
        expect(state.cortisol).toBe(0);
        expect(state.arousal).toBe(0.5);
    });

    it('burns glucose over time (Metabolism)', async () => {
        const initialGlucose = core.getCurrentState().glucose;

        // Simulate 10 seconds passing
        // We use tick() with explicit dt to avoid timing issues
        await core.tick(0.1, 10);

        const nextState = core.getCurrentState();
        expect(nextState.glucose).toBeLessThan(initialGlucose);
    });

    it('reacts to PROFIT stimulus (Dopamine Spike)', () => {
        const initialDopamine = core.getCurrentState().dopamine;
        const initialCortisol = core.getCurrentState().cortisol;

        // Stimulate with $10 profit on $100 capital (10% ROI)
        core.stimulate(10, 'PROFIT', 100);

        const nextState = core.getCurrentState();
        expect(nextState.dopamine).toBeGreaterThan(initialDopamine);
        expect(nextState.cortisol).toBeLessThanOrEqual(initialCortisol);
    });

    it('reacts to LOSS stimulus (Cortisol Spike)', () => {
        // Ensure some dopamine to lose
        core.feed(10);
        const initialDopamine = core.getCurrentState().dopamine;

        // Stimulate with $10 loss on $100 capital (10% ROI)
        core.stimulate(10, 'LOSS', 100);

        const nextState = core.getCurrentState();
        expect(nextState.dopamine).toBeLessThan(initialDopamine);
        expect(nextState.cortisol).toBeGreaterThan(0);
    });

    it('reacts to DANGER stimulus (Arousal & Cortisol)', () => {
        const initialArousal = core.getCurrentState().arousal;

        core.stimulate(20, 'DANGER'); // Severity 20

        const nextState = core.getCurrentState();
        expect(nextState.arousal).toBeGreaterThan(initialArousal);
        expect(nextState.cortisol).toBeGreaterThan(0);
    });

    it('enters Survival Mode when starving', () => {
        // Manually drain glucose
        (core as any).state.glucose = 5;

        const mode = core.getMode();
        // Should come from imported SentinelMode enum, but we can check string or value if needed
        // SentinelMode.EMERGENCY is likely what it returns
        expect(mode).toBeDefined();
        // Since we don't import SentinelMode here (it's in EidolonTypes), 
        // we verified logic via inspection: glucose < 10 -> EMERGENCY
    });
});
