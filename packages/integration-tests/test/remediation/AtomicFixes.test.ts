import { ActiveLearning, EmotionalCore } from '@eidolon/soul';
import { AppendOnlyAdapter } from '@eidolon/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/*
 * 🛡️ VERIFICATION SUITE: ATOMIC REMEDIATION
 * Tests specifically designed to verify fixes for:
 * 1. Memory Bomb (ActiveLearning Log Rotation)
 * 2. Cognitive Race Condition (EmotionalCore State Merging)
 */

describe('Atomic Remediation Verification', () => {
    const TEST_DIR = path.join(process.cwd(), 'test_data', 'remediation');

    beforeAll(async () => {
        await fs.mkdir(TEST_DIR, { recursive: true });
    });

    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    describe('ActiveLearning (Memory Bomb)', () => {
        const LOG_FILE = 'active_learning_history.log';

        it('should rotate log file when size exceeds 5MB', async () => {
            // Setup: Create a 6MB dummy log file
            const storage = new AppendOnlyAdapter({ baseDir: TEST_DIR });
            const al = new ActiveLearning(undefined, undefined, storage);

            const hugeData = 'x'.repeat(1024 * 1024); // 1MB chunk
            const logPath = path.join(TEST_DIR, LOG_FILE);

            // Write 6MB
            for (let i = 0; i < 6; i++) {
                await fs.appendFile(logPath, hugeData, 'utf-8');
            }

            const statsBefore = await fs.stat(logPath);
            expect(statsBefore.size).toBeGreaterThan(5 * 1024 * 1024);

            // Action: Force rotation (via init or internal check)
            // Since we modified init() to call rotateLogFile(), calling init() should trigger it.
            await al.init();

            // Assert:
            // 1. Original log file should be empty or small (reset)
            const statsAfter = await fs.stat(logPath);
            expect(statsAfter.size).toBe(0);

            // 2. Archive file should exist
            const files = await fs.readdir(TEST_DIR);
            const archives = files.filter(f => f.startsWith('archive_history_') && f.endsWith('.log'));
            expect(archives.length).toBeGreaterThan(0);

            const archiveStats = await fs.stat(path.join(TEST_DIR, archives[0]));
            expect(archiveStats.size).toBeGreaterThan(5 * 1024 * 1024);

            console.log('✅ Memory Bomb Verification: Log rotated successfully.');
        });
    });

    describe('EmotionalCore (Race Condition)', () => {
        it('should merge in-memory state changes with loaded state during initialization', async () => {
            // Mock Storage that delays load
            const loadedState = {
                glucose: 100, // Full battery
                cortisol: 0,  // Calm
                lastUpdate: Date.now() - 1000,
                // Add defaults for other required fields
                dopamine: 50,
                arousal: 0.5,
                valence: 0.5,
                attention: 0.5,
                rhythm: 0.5,
                momentum: 0.0,
                volatility: 0.1
            };

            const mockStorage = {
                load: vi.fn().mockImplementation(async () => {
                    // Simulate slow disk I/O
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return { state: loadedState };
                }),
                readLog: vi.fn().mockResolvedValue([]),
                save: vi.fn().mockResolvedValue(undefined),
                append: vi.fn().mockResolvedValue(undefined),
                init: vi.fn().mockResolvedValue(undefined),
                list: vi.fn().mockResolvedValue([])
            } as unknown as AppendOnlyAdapter;

            const core = new EmotionalCore(mockStorage);

            // At this point, loadState() is initiated but pending (due to 100ms delay)
            // Act: Simulate metabolic activity (burn glucose, spike cortisol) immediately
            // e.g. a "tick" happens or a "stimulate" event comes in

            // core.state starts at default: glucose=100, cortisol=0.

            // Spike cortisol "in-memory" before load finishes
            core.stimulate(50, 'DANGER');
            // This sets cortisol to ~30 (depending on logic)

            // Let's also tick to burn glucose
            await core.tick(0.5, 1.0); // High volatility, 1 sec delta
            // Glucose should drop. 
            // Original default glucose is 100. Burn rate ~0.5-1.0. So 99.

            // Wait for load to finish
            await new Promise(resolve => setTimeout(resolve, 150));

            // Assert Merge Logic
            const finalState = core.getCurrentState();

            // Loaded state says Glucose 100. In-memory was ~99. 
            // Merge logic: min(100, 99) -> 99.
            // expect(finalState.glucose).toBeLessThan(100);
            // Wait, previous test failed because finalState.glucose was 100? No, previous test failed syntax.
            // Let's assert strictly.

            // Loaded state says cortisol 0. In-memory was spiked (e.g. 30).
            // Merge logic: max(0, 30) -> 30.
            // expect(finalState.cortisol).toBeGreaterThan(10);

            console.log('✅ Race Condition Verification: State merged correctly.', {
                glucose: finalState.glucose,
                cortisol: finalState.cortisol
            });

            expect(finalState.glucose).toBeLessThan(100);
            expect(finalState.cortisol).toBeGreaterThan(10);
        });
    });
});
