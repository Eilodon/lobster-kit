
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmotionalCore, EMOTIONAL_CONFIG } from '../../src/eidolon/EmotionalCore';
import fs from 'fs/promises';
import path from 'path';

// Mock fs/promises
vi.mock('fs/promises');

describe('EmotionalCore', () => {
    let soul: EmotionalCore;
    const mockRiskParams = {
        maxPositionSize: 10,
        maxDrawdown: 10,
        minConfidence: 50,
        cooldownPeriod: 1000
    };

    beforeEach(() => {
        vi.resetAllMocks();
        soul = new EmotionalCore(mockRiskParams);
    });

    describe('Logic & State Transitions', () => {
        it('should start in NEUTRAL state with default confidence', () => {
            const profile = soul.getProfile();
            expect(profile.state).toBe('NEUTRAL');
            expect(profile.confidence).toBe(70);
        });

        it('should increase confidence on Wins', () => {
            soul.processOutcome(100); // Win $100
            const profile = soul.getProfile();
            expect(profile.confidence).toBeGreaterThan(70);
            expect(profile.consecutiveWins).toBe(1);
            expect(profile.consecutiveLosses).toBe(0);
        });

        it('should decrease confidence on Losses', () => {
            soul.processOutcome(-50); // Loss $50
            const profile = soul.getProfile();
            expect(profile.confidence).toBeLessThan(70);
            expect(profile.consecutiveWins).toBe(0);
            expect(profile.consecutiveLosses).toBe(1);
        });

        it('should switch to FEARFUL state after consecutive losses', () => {
            const threshold = EMOTIONAL_CONFIG.FEAR_THRESHOLD;
            for (let i = 0; i < threshold; i++) {
                soul.processOutcome(-10);
            }
            const profile = soul.getProfile();
            expect(profile.state).toBe('FEARFUL');
        });

        it('should switch to GREEDY state after consecutive wins', () => {
            const threshold = EMOTIONAL_CONFIG.GREED_THRESHOLD;
            for (let i = 0; i < threshold; i++) {
                soul.processOutcome(10);
            }
            const profile = soul.getProfile();
            expect(profile.state).toBe('GREEDY');
        });
    });

    describe('Persistence', () => {
        it('should save state to disk on outcome processing', async () => {
            // Mock successful mkdir and writeFile
            (fs.mkdir as any).mockResolvedValue(undefined);
            (fs.writeFile as any).mockResolvedValue(undefined);

            soul.processOutcome(100);

            // Wait for fire-and-forget save to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            // Access private STORAGE_FILE path logic implicitly via mock calls
            // We expect mkdir to be called for the dir
            expect(fs.mkdir).toHaveBeenCalled();
            // We expect writeFile to be called with stringified JSON
            expect(fs.writeFile).toHaveBeenCalled();

            const writeArgs = (fs.writeFile as any).mock.calls[0];
            const writtenData = JSON.parse(writeArgs[1]);
            expect(writtenData.confidence).toBeGreaterThan(70);
        });

        it('should load state from disk on init', async () => {
            const mockState = {
                state: 'GREEDY',
                confidence: 90,
                consecutiveWins: 5,
                consecutiveLosses: 0,
                lastTradeTime: 12345,
                timestamp: Date.now()
            };

            (fs.readFile as any).mockResolvedValue(JSON.stringify(mockState));

            await soul.init();

            const profile = soul.getProfile();
            expect(profile.state).toBe('GREEDY');
            expect(profile.confidence).toBe(90);
        });
    });
});
