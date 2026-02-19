import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rustState = new Map<string, { until: number }>();
const rustKey = (mode: number, action: string) => `${mode}:${action}`;

const rustRegistry = {
    record_trauma: vi.fn((mode: number, action: string, _severity: number, now: bigint) => {
        const nowMs = Number(now);
        rustState.set(rustKey(mode, action), { until: nowMs + 3600 * 1000 });
    }),
    is_inhibited: vi.fn((mode: number, action: string, now: bigint) => {
        const nowMs = Number(now);
        const entry = rustState.get(rustKey(mode, action));
        return !!entry && entry.until > nowMs;
    }),
    get_remaining_ms: vi.fn((mode: number, action: string, now: bigint) => {
        const nowMs = Number(now);
        const entry = rustState.get(rustKey(mode, action));
        if (!entry) return 0n;
        return BigInt(Math.max(0, entry.until - nowMs));
    }),
    heal: vi.fn((mode: number, action: string) => {
        rustState.delete(rustKey(mode, action));
    })
};

vi.mock('../src/eidolon/WasmAdapter', () => ({
    WasmAdapter: {
        getInstance: () => ({
            createTraumaRegistry: () => rustRegistry
        })
    }
}));

import { TraumaRegistry } from '../src/eidolon/TraumaRegistry';

describe('TraumaRegistry Rust Bridge', () => {
    const originalTraumaRust = process.env.EIDOLON_TRAUMA_RUST;

    beforeEach(() => {
        rustState.clear();
        rustRegistry.record_trauma.mockClear();
        rustRegistry.is_inhibited.mockClear();
        rustRegistry.get_remaining_ms.mockClear();
        rustRegistry.heal.mockClear();
    });

    afterEach(() => {
        delete process.env.EIDOLON_TRAUMA_RUST;
    });

    it('should mirror trauma events to rust registry and read inhibition', () => {
        const registry = new TraumaRegistry();
        registry.recordTrauma('ZEN', 'BUY', 1.0);

        expect(rustRegistry.record_trauma).toHaveBeenCalledTimes(1);
        expect(registry.isInhibited('ZEN', 'BUY')).toBe(true);
    });

    it('should propagate heal to rust registry', () => {
        const registry = new TraumaRegistry();
        registry.recordTrauma('ZEN', 'BUY', 1.0);
        registry.heal('ZEN', 'BUY');
        expect(rustRegistry.heal).toHaveBeenCalled();
        expect(registry.isInhibited('ZEN', 'BUY')).toBe(false);
    });

    it('should allow disabling rust registry via env canary switch', () => {
        process.env.EIDOLON_TRAUMA_RUST = '0';
        const registry = new TraumaRegistry();
        registry.recordTrauma('ZEN', 'BUY', 1.0);
        expect(registry.isUsingRust()).toBe(false);
        expect(rustRegistry.record_trauma).not.toHaveBeenCalled();
    });

    afterAll(() => {
        if (originalTraumaRust === undefined) {
            delete process.env.EIDOLON_TRAUMA_RUST;
            return;
        }
        process.env.EIDOLON_TRAUMA_RUST = originalTraumaRust;
    });
});
