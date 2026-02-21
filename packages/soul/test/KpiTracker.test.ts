import { describe, expect, it } from 'vitest';
import { KpiTracker } from '../src/metrics/KpiTracker';

describe('KpiTracker', () => {
  it('should compute core KPI ratios', () => {
    const tracker = new KpiTracker();

    tracker.recordSimulationResult(true);
    tracker.recordSimulationResult(true);
    tracker.recordSimulationResult(false);

    tracker.recordExecutionOutcome(true, 100);
    tracker.recordExecutionOutcome(false, 50);

    tracker.recordDecisionLatency(100);
    tracker.recordDecisionLatency(200);
    tracker.recordDecisionLatency(300);

    const snapshot = tracker.getSnapshot();

    expect(snapshot.failedTxRate).toBeCloseTo(0.5, 8);
    expect(snapshot.simulatedSuccessVsOnChainSuccess).toBeCloseTo(0.5, 8); // 1 / 2
    expect(snapshot.gasBleedRatio).toBeCloseTo(50 / 150, 8);
    expect(snapshot.p95DecisionLatencyMs).toBe(300);
  });

  it('should track drawdown, drift lead time, and swarm bandwidth reduction', () => {
    const tracker = new KpiTracker(0.2);

    tracker.recordPortfolioSnapshot(1000);
    tracker.recordPortfolioSnapshot(800); // 20% DD
    tracker.recordPortfolioSnapshot(700); // 30% DD

    tracker.recordCausalDriftAlarm(12);
    tracker.recordCausalDriftAlarm(8);

    tracker.recordSwarmBandwidthSample(1000, 200);
    tracker.recordSwarmBandwidthSample(500, 150);

    const snapshot = tracker.getSnapshot();

    expect(snapshot.maxDrawdownByBlockRatio).toBeCloseTo(0.3, 8);
    expect(snapshot.maxDrawdownInvariantBreached).toBe(true);
    expect(snapshot.minCausalDriftAlarmLeadTimeMinutes).toBe(8);
    expect(snapshot.swarmBandwidthReductionRatio).toBeCloseTo(1 - (350 / 1500), 8);
    expect(snapshot.sampleSize.drawdownSnapshots).toBe(3);
    expect(snapshot.sampleSize.driftAlarms).toBe(2);
    expect(snapshot.sampleSize.bandwidthSamples).toBe(2);
  });
});
