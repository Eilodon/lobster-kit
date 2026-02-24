import { describe, expect, it, vi } from 'vitest';
import { ChaosHarness } from '@eidolon/core';

describe('ChaosHarness skeleton', () => {
    it('should raise CRITICAL alarm on RPC outage', async () => {
        const harness = new ChaosHarness({
            probeRpc: vi.fn().mockRejectedValue(new Error('rpc down')),
            readOraclePair: vi.fn().mockResolvedValue({ primaryPrice: 600, secondaryPrice: 600 }),
            readMempoolPending: vi.fn().mockResolvedValue(1000)
        });

        const alarm = await harness.runScenario('RPC_OUTAGE');
        expect(alarm.triggered).toBe(true);
        expect(alarm.severity).toBe('CRITICAL');
        expect(alarm.details).toContain('RPC unavailable');
    });

    it('should raise HIGH alarm on oracle divergence', async () => {
        const harness = new ChaosHarness(
            {
                probeRpc: vi.fn().mockResolvedValue(undefined),
                readOraclePair: vi.fn().mockResolvedValue({ primaryPrice: 600, secondaryPrice: 540 }),
                readMempoolPending: vi.fn().mockResolvedValue(1000)
            },
            { oracleDivergenceBpsThreshold: 500 }
        );

        const alarm = await harness.runScenario('ORACLE_DIVERGENCE');
        expect(alarm.triggered).toBe(true);
        expect(alarm.severity).toBe('HIGH');
        expect(alarm.details).toContain('Oracle spread');
    });

    it('should raise MEDIUM alarm on mempool spike', async () => {
        const harness = new ChaosHarness(
            {
                probeRpc: vi.fn().mockResolvedValue(undefined),
                readOraclePair: vi.fn().mockResolvedValue({ primaryPrice: 600, secondaryPrice: 600 }),
                readMempoolPending: vi.fn().mockResolvedValue(120_000)
            },
            { mempoolSpikeThreshold: 100_000 }
        );

        const alarm = await harness.runScenario('MEMPOOL_SPIKE');
        expect(alarm.triggered).toBe(true);
        expect(alarm.severity).toBe('MEDIUM');
    });

    it('runAll should aggregate alarms and critical flag', async () => {
        const harness = new ChaosHarness({
            probeRpc: vi.fn().mockRejectedValue(new Error('timeout')),
            readOraclePair: vi.fn().mockResolvedValue({ primaryPrice: 600, secondaryPrice: 599 }),
            readMempoolPending: vi.fn().mockResolvedValue(500)
        });

        const report = await harness.runAll();
        expect(report.alarms).toHaveLength(3);
        expect(report.hasCritical).toBe(true);
    });

    it('should abort signal on timeout', async () => {
        const abortSpy = vi.fn();
        const harness = new ChaosHarness({
            probeRpc: async (signal) => {
                signal?.addEventListener('abort', abortSpy);
                await new Promise((resolve) => setTimeout(resolve, 500)); // Delay longer than timeout
            },
            readOraclePair: vi.fn().mockResolvedValue({ primaryPrice: 600, secondaryPrice: 600 }),
            readMempoolPending: vi.fn().mockResolvedValue(100)
        }, { rpcTimeoutMs: 100 }); // Short timeout

        await harness.runScenario('RPC_OUTAGE');
        expect(abortSpy).toHaveBeenCalled();
    });
});
