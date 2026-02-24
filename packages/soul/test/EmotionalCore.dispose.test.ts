import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmotionalCore } from '../src/eidolon/EmotionalCore';
import { EidolonBus, EidolonEventType } from '@clawkit/core';

describe('EmotionalCore: Dispose', () => {
    let core: EmotionalCore;
    let bus: EidolonBus;

    beforeEach(async () => {
        bus = EidolonBus.getInstance();
        bus.removeAllListeners();
        core = new EmotionalCore();
        // Wait for async initialization (listeners attach in .finally)
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(() => {
        core.dispose();
    });

    it('should unsubscribe BLOCK_MINED listener on dispose', () => {
        const tickSpy = vi.spyOn(core, 'tick').mockResolvedValue(core.getCurrentState());

        bus.emitEvent({
            type: EidolonEventType.BLOCK_MINED,
            timestamp: Date.now(),
            payload: {
                blockNumber: 1n,
                hash: '0x01',
                timestamp: 1n
            }
        });
        expect(tickSpy).toHaveBeenCalledTimes(1);

        core.dispose();

        bus.emitEvent({
            type: EidolonEventType.BLOCK_MINED,
            timestamp: Date.now(),
            payload: {
                blockNumber: 2n,
                hash: '0x02',
                timestamp: 2n
            }
        });
        expect(tickSpy).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe TRAUMA listener on dispose', () => {
        const stimulateSpy = vi.spyOn(core, 'stimulate');

        bus.emitEvent({
            type: EidolonEventType.TRAUMA,
            timestamp: Date.now(),
            payload: {
                severity: 25
            }
        });
        expect(stimulateSpy).toHaveBeenCalledWith(25, 'DANGER');

        core.dispose();

        bus.emitEvent({
            type: EidolonEventType.TRAUMA,
            timestamp: Date.now(),
            payload: {
                severity: 10
            }
        });
        expect(stimulateSpy).toHaveBeenCalledTimes(1);
    });
});
