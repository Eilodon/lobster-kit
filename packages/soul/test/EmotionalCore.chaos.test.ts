
import { describe, it, expect, beforeEach } from 'vitest';
import { EmotionalCore } from '../src/eidolon/EmotionalCore';
import { IStorageProvider } from '../src/eidolon/memory/IStorageProvider';

// Mock Storage to prevent network calls/hangs
class MockStorage implements IStorageProvider {
    baseDir: string = '/tmp';
    async ensureBaseDir(): Promise<void> { }
    async init(): Promise<void> { }
    async append(key: string, data: any): Promise<void> { }
    async readLog(key: string): Promise<any[]> { return []; }
    async save(key: string, data: any): Promise<void> { }
    async load<T>(key: string): Promise<T | null> { return null; }
    async delete(key: string): Promise<void> { }
    async list(): Promise<string[]> { return []; }
}

describe('EmotionalCore Chaos Testing 🌪️', () => {
    let core: EmotionalCore;

    beforeEach(() => {
        // Inject Mock Storage
        core = new EmotionalCore(new MockStorage());
    });

    describe('Extreme Market Conditions', () => {
        it('should handle Flash Crash (-99% value in 1 tick)', async () => {
            // Simulate extreme loss (Repeated trauma)
            // Using capitalAtRisk=100 triggers ROI scaling (99% loss -> massive impact)
            core.stimulate(99, 'LOSS', 100);

            const state = await core.tick(1.0); // Extreme volatility (1.0 = max)

            // Cortisol should be maxed out
            // Cortisol should be maxed out (capped at +60 from 0, so > 50 is correct)
            expect(state.cortisol).toBeGreaterThan(50);
            expect(state.cortisol).toBeLessThanOrEqual(100);

            // Dopamine should be crushed
            expect(state.dopamine).toBeLessThan(20);
            expect(state.dopamine).toBeGreaterThanOrEqual(0);

            // No NaN values
            expect(state.arousal).not.toBeNaN();
            expect(state.valence).not.toBeNaN();
        });

        it('should handle Hyper Inflation (Infinite Pump)', async () => {
            // Simulate extreme profit repeatedly
            for (let i = 0; i < 10; i++) {
                core.stimulate(100, 'PROFIT');
            }
            const state = await core.tick(0.5);

            // Dopamine should be maxed (near 100, tiny decay from internal ticks)
            expect(state.dopamine).toBeGreaterThan(95);

            // Cortisol should be low (basal clearance keeps it at 0 when vol < dead-zone)
            expect(state.cortisol).toBeLessThanOrEqual(5);

            // No NaN values
            expect(state.arousal).not.toBeNaN();
        });
    });

    describe('Malicious Input Injection (NaN Attack)', () => {
        it('should survive NaN volatility injection', async () => {
            const state = await core.tick(NaN);

            expect(state.volatility).not.toBeNaN();
            // Should default to 0.1 or safe value if NaN passes through, 
            // or at least not crash the internal engines

            // Check vectors
            expect(state.arousal).not.toBeNaN();
            expect(state.valence).not.toBeNaN();
        });

        it('should survive Infinity stimulation', () => {
            core.stimulate(Infinity, 'DANGER');

            // Should handle it gracefully via Math.min/max clamps
            expect(core['state'].cortisol).toBeLessThanOrEqual(100);
            expect(core['state'].arousal).toBeLessThanOrEqual(1.0);
        });
    });

    describe('Long-Term Stability (Thermodynamic Heat Death)', () => {
        it('should not diverge after 1000 ticks of random noise', async () => {
            for (let i = 0; i < 1000; i++) {
                const randomVol = Math.random();
                await core.tick(randomVol);

                // Random stimulation
                if (Math.random() > 0.8) {
                    const val = Math.random() * 50;
                    const type = Math.random() > 0.5 ? 'PROFIT' : 'LOSS';
                    core.stimulate(val, type);
                }
            }

            const state = await core.tick(0.1);

            // All values must be finite and within bounds
            Object.values(state).forEach(val => {
                expect(Number.isFinite(val)).toBe(true);
            });

            expect(state.arousal).toBeGreaterThanOrEqual(0);
            expect(state.arousal).toBeLessThanOrEqual(1);
        });
    });
});
