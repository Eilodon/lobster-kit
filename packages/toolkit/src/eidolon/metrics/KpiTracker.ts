export interface KpiSnapshot {
    failedTxRate: number;
    simulatedSuccessVsOnChainSuccess: number;
    onChainVsSimulatedSuccessRatio: number;
    gasBleedRatio: number;
    p95DecisionLatencyMs: number;
    maxDrawdownByBlockRatio: number;
    maxDrawdownInvariantBreached: boolean;
    minCausalDriftAlarmLeadTimeMinutes: number;
    swarmBandwidthReductionRatio: number;
    sampleSize: {
        executions: number;
        simulations: number;
        latencies: number;
        drawdownSnapshots: number;
        driftAlarms: number;
        bandwidthSamples: number;
    };
}

/**
 * Lightweight runtime KPI tracker for go/no-go readiness.
 * Uses in-memory counters to avoid hot-path IO.
 */
export class KpiTracker {
    private simulationSuccess = 0;
    private simulationTotal = 0;

    private onchainSuccess = 0;
    private onchainTotal = 0;

    private failedGasTotal = 0;
    private gasTotal = 0;

    private readonly reservoir: number[] = [];
    private readonly reservoirSize = 500; // Sample size sufficient for P95 estimation
    private samplesSeen = 0;

    private readonly invariantDrawdownThresholdRatio: number;

    private peakPortfolioUsd = 0;
    private maxDrawdownByBlockRatio = 0;
    private drawdownSnapshots = 0;

    private minCausalDriftAlarmLeadTimeMinutes = Number.POSITIVE_INFINITY;
    private driftAlarmCount = 0;

    private swarmBaselineBytes = 0;
    private swarmOptimizedBytes = 0;
    private bandwidthSamples = 0;

    constructor(invariantDrawdownThresholdRatio = 0.2) {
        if (!Number.isFinite(invariantDrawdownThresholdRatio)) {
            throw new Error('invariantDrawdownThresholdRatio must be a finite number');
        }
        const normalized = Math.max(0, Math.min(1, invariantDrawdownThresholdRatio));
        this.invariantDrawdownThresholdRatio = normalized;
    }

    recordSimulationResult(success: boolean): void {
        this.simulationTotal += 1;
        if (success) this.simulationSuccess += 1;
    }

    recordExecutionOutcome(success: boolean, gasUsed: number): void {
        this.onchainTotal += 1;
        if (success) this.onchainSuccess += 1;

        const safeGas = Number.isFinite(gasUsed) && gasUsed > 0 ? gasUsed : 0;
        this.gasTotal += safeGas;
        if (!success) {
            this.failedGasTotal += safeGas;
        }
    }

    recordDecisionLatency(latencyMs: number): void {
        if (!Number.isFinite(latencyMs) || latencyMs < 0) return;

        this.samplesSeen++;

        if (this.reservoir.length < this.reservoirSize) {
            this.reservoir.push(latencyMs);
        } else {
            // Algorithm R: Replace elements with probability k/n
            const j = Math.floor(Math.random() * this.samplesSeen);
            if (j < this.reservoirSize) {
                this.reservoir[j] = latencyMs;
            }
        }
    }

    recordPortfolioSnapshot(totalPortfolioUsd: number): void {
        if (!Number.isFinite(totalPortfolioUsd) || totalPortfolioUsd < 0) return;
        this.drawdownSnapshots += 1;

        if (totalPortfolioUsd > this.peakPortfolioUsd) {
            this.peakPortfolioUsd = totalPortfolioUsd;
            return;
        }

        if (this.peakPortfolioUsd <= 0) return;
        const drawdown = (this.peakPortfolioUsd - totalPortfolioUsd) / this.peakPortfolioUsd;
        if (drawdown > this.maxDrawdownByBlockRatio) {
            this.maxDrawdownByBlockRatio = drawdown;
        }
    }

    recordCausalDriftAlarm(leadTimeMinutes: number): void {
        if (!Number.isFinite(leadTimeMinutes) || leadTimeMinutes < 0) return;
        this.driftAlarmCount += 1;
        if (leadTimeMinutes < this.minCausalDriftAlarmLeadTimeMinutes) {
            this.minCausalDriftAlarmLeadTimeMinutes = leadTimeMinutes;
        }
    }

    recordSwarmBandwidthSample(baselineBytes: number, optimizedBytes: number): void {
        if (!Number.isFinite(baselineBytes) || !Number.isFinite(optimizedBytes)) return;
        if (baselineBytes <= 0 || optimizedBytes < 0) return;
        this.swarmBaselineBytes += baselineBytes;
        this.swarmOptimizedBytes += optimizedBytes;
        this.bandwidthSamples += 1;
    }

    getSnapshot(): KpiSnapshot {
        const failedTxRate = this.onchainTotal > 0
            ? (this.onchainTotal - this.onchainSuccess) / this.onchainTotal
            : 0;

        const onChainVsSimulatedSuccessRatio = this.simulationSuccess > 0
            ? this.onchainSuccess / this.simulationSuccess
            : 0;

        const gasBleedRatio = this.gasTotal > 0
            ? this.failedGasTotal / this.gasTotal
            : 0;

        const swarmBandwidthReductionRatio = this.swarmBaselineBytes > 0
            ? Math.max(0, Math.min(1, 1 - (this.swarmOptimizedBytes / this.swarmBaselineBytes)))
            : 0;

        const minCausalDriftAlarmLeadTimeMinutes = Number.isFinite(this.minCausalDriftAlarmLeadTimeMinutes)
            ? this.minCausalDriftAlarmLeadTimeMinutes
            : 0;

        return {
            failedTxRate,
            simulatedSuccessVsOnChainSuccess: onChainVsSimulatedSuccessRatio,
            onChainVsSimulatedSuccessRatio,
            gasBleedRatio,
            p95DecisionLatencyMs: this.computeP95Latency(),
            maxDrawdownByBlockRatio: this.maxDrawdownByBlockRatio,
            maxDrawdownInvariantBreached: this.maxDrawdownByBlockRatio > this.invariantDrawdownThresholdRatio,
            minCausalDriftAlarmLeadTimeMinutes,
            swarmBandwidthReductionRatio,
            sampleSize: {
                executions: this.onchainTotal,
                simulations: this.simulationTotal,
                latencies: this.samplesSeen, // Use actual samples seen
                drawdownSnapshots: this.drawdownSnapshots,
                driftAlarms: this.driftAlarmCount,
                bandwidthSamples: this.bandwidthSamples
            }
        };
    }

    reset(): void {
        this.simulationSuccess = 0;
        this.simulationTotal = 0;
        this.onchainSuccess = 0;
        this.onchainTotal = 0;
        this.failedGasTotal = 0;
        this.gasTotal = 0;
        this.reservoir.length = 0;
        this.samplesSeen = 0;
        this.peakPortfolioUsd = 0;
        this.maxDrawdownByBlockRatio = 0;
        this.drawdownSnapshots = 0;
        this.minCausalDriftAlarmLeadTimeMinutes = Number.POSITIVE_INFINITY;
        this.driftAlarmCount = 0;
        this.swarmBaselineBytes = 0;
        this.swarmOptimizedBytes = 0;
        this.bandwidthSamples = 0;
    }

    private computeP95Latency(): number {
        if (this.reservoir.length === 0) return 0;
        // Sorting 500 items is negligible (microseconds) compared to 4096+
        const sorted = [...this.reservoir].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
        return sorted[idx];
    }
}
