import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EidolonBus, EidolonEventType } from '../src/events/EidolonBus';
import { EmotionalCore } from '../src/eidolon/EmotionalCore';

// Mock AppendOnlyAdapter while keeping other core exports intact.
vi.mock('@clawkit/core', async () => {
    const actual = await vi.importActual<typeof import('@clawkit/core')>('@clawkit/core');
    return {
        ...actual,
        AppendOnlyAdapter: class {
            async load() { return null; }
            async append() { }
            async save() { }
            async readLog() { return []; }
            async readLogTail() { return []; }
        }
    };
});

describe('Reactive Core (Brain Transplant)', () => {
    let bus: EidolonBus;
    let soul: EmotionalCore;

    beforeEach(async () => {
        // Reset singleton (simulated) or just get instance
        bus = EidolonBus.getInstance();
        bus.removeAllListeners();

        soul = new EmotionalCore();
        // Wait for async initialization (listeners attach in .finally)
        await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should react to BLOCK_MINED events (Metabolic Tick)', async () => {
        const initialState = soul.tick(0.1); // Initialize state
        const initialGlucose = (await initialState).glucose;

        // Wait a bit to ensure dt > 0
        await new Promise(resolve => setTimeout(resolve, 100));

        // Emit Block Event
        bus.emitEvent({
            type: EidolonEventType.BLOCK_MINED,
            timestamp: Date.now(),
            payload: {
                blockNumber: 100n,
                hash: '0x123',
                timestamp: 1234567890n
            }
        });

        // Allow async handlers to fire
        await new Promise(resolve => setTimeout(resolve, 50));

        // Check if glucose burned (metabolism active)
        const newState = await soul.tick(0.1, 0); // Get current state without advancing time
        expect(newState.glucose).toBeLessThan(initialGlucose);
    });

    it('should react to TRAUMA events (Reflex)', async () => {
        const initialState = await soul.tick(0.1);
        const initialCortisol = initialState.cortisol;

        // Emit Trauma
        bus.emitEvent({
            type: EidolonEventType.TRAUMA,
            timestamp: Date.now(),
            payload: {
                reason: 'Flash Crash',
                severity: 50
            }
        });

        // Allow handler
        await new Promise(resolve => setTimeout(resolve, 200));

        const newState = await soul.tick(0.1, 0);
        expect(newState.cortisol).toBeGreaterThan(initialCortisol);
    });
});
