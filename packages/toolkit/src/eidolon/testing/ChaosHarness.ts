export type ChaosScenario = 'RPC_OUTAGE' | 'ORACLE_DIVERGENCE' | 'MEMPOOL_SPIKE';

export interface OraclePair {
    primaryPrice: number;
    secondaryPrice: number;
}

export interface ChaosHarnessDeps {
    probeRpc: (signal?: AbortSignal) => Promise<void>;
    readOraclePair: () => Promise<OraclePair>;
    readMempoolPending: (signal?: AbortSignal) => Promise<number>;
}

export interface ChaosHarnessConfig {
    rpcTimeoutMs: number;
    oracleDivergenceBpsThreshold: number;
    mempoolSpikeThreshold: number;
}

export interface ChaosAlarm {
    scenario: ChaosScenario;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    triggered: boolean;
    details: string;
    mitigation: string;
    timestamp: number;
}

export interface ChaosReport {
    alarms: ChaosAlarm[];
    hasCritical: boolean;
    generatedAt: number;
}

const DEFAULT_CONFIG: ChaosHarnessConfig = {
    rpcTimeoutMs: 1500,
    oracleDivergenceBpsThreshold: 150,
    mempoolSpikeThreshold: 50_000
};

export class ChaosHarness {
    private readonly config: ChaosHarnessConfig;

    constructor(
        private readonly deps: ChaosHarnessDeps,
        config?: Partial<ChaosHarnessConfig>
    ) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config
        };
    }

    public async runScenario(scenario: ChaosScenario): Promise<ChaosAlarm> {
        switch (scenario) {
            case 'RPC_OUTAGE':
                return this.runRpcOutage();
            case 'ORACLE_DIVERGENCE':
                return this.runOracleDivergence();
            case 'MEMPOOL_SPIKE':
                return this.runMempoolSpike();
        }
    }

    public async runAll(): Promise<ChaosReport> {
        const alarms = await Promise.all([
            this.runScenario('RPC_OUTAGE'),
            this.runScenario('ORACLE_DIVERGENCE'),
            this.runScenario('MEMPOOL_SPIKE')
        ]);
        return {
            alarms,
            hasCritical: alarms.some((a) => a.triggered && a.severity === 'CRITICAL'),
            generatedAt: Date.now()
        };
    }

    private async runRpcOutage(): Promise<ChaosAlarm> {
        const started = Date.now();
        try {
            await this.withTimeout((signal) => this.deps.probeRpc(signal), this.config.rpcTimeoutMs);
            return this.alarm('RPC_OUTAGE', false, 'LOW', 'RPC probe healthy', 'No mitigation required.');
        } catch (err: any) {
            const elapsed = Date.now() - started;
            return this.alarm(
                'RPC_OUTAGE',
                true,
                'CRITICAL',
                `RPC unavailable or timed out after ${elapsed}ms (${err?.message || 'unknown'})`,
                'Fail over to backup RPC and force read-only mode for risky actions.'
            );
        }
    }

    private async runOracleDivergence(): Promise<ChaosAlarm> {
        try {
            const { primaryPrice, secondaryPrice } = await this.deps.readOraclePair();
            if (!Number.isFinite(primaryPrice) || !Number.isFinite(secondaryPrice) || primaryPrice <= 0 || secondaryPrice <= 0) {
                return this.alarm(
                    'ORACLE_DIVERGENCE',
                    true,
                    'HIGH',
                    'Invalid oracle sample detected',
                    'Reject trade actions until both oracle feeds recover.'
                );
            }

            const diff = Math.abs(primaryPrice - secondaryPrice);
            const bps = (diff / primaryPrice) * 10_000;
            const triggered = bps >= this.config.oracleDivergenceBpsThreshold;

            return this.alarm(
                'ORACLE_DIVERGENCE',
                triggered,
                triggered ? 'HIGH' : 'LOW',
                `Oracle spread=${bps.toFixed(2)} bps (threshold=${this.config.oracleDivergenceBpsThreshold})`,
                triggered
                    ? 'Switch to conservative pricing and widen slippage guardrails.'
                    : 'No mitigation required.'
            );
        } catch (err: any) {
            return this.alarm(
                'ORACLE_DIVERGENCE',
                true,
                'HIGH',
                `Oracle check failed (${err?.message || 'unknown'})`,
                'Freeze execution path relying on single-feed pricing.'
            );
        }
    }

    private async runMempoolSpike(): Promise<ChaosAlarm> {
        try {
            const pending = await this.withTimeout(
                (signal) => this.deps.readMempoolPending(signal),
                this.config.rpcTimeoutMs
            );
            const triggered = Number.isFinite(pending) && pending >= this.config.mempoolSpikeThreshold;
            return this.alarm(
                'MEMPOOL_SPIKE',
                triggered,
                triggered ? 'MEDIUM' : 'LOW',
                `Pending tx count=${pending} (threshold=${this.config.mempoolSpikeThreshold})`,
                triggered
                    ? 'Throttle aggressive actions and require elevated gas confidence.'
                    : 'No mitigation required.'
            );
        } catch (err: any) {
            return this.alarm(
                'MEMPOOL_SPIKE',
                true,
                'MEDIUM',
                `Mempool probe failed (${err?.message || 'unknown'})`,
                'Fallback to static risk profile and slow-path execution.'
            );
        }
    }

    private alarm(
        scenario: ChaosScenario,
        triggered: boolean,
        severity: ChaosAlarm['severity'],
        details: string,
        mitigation: string
    ): ChaosAlarm {
        return {
            scenario,
            triggered,
            severity,
            details,
            mitigation,
            timestamp: Date.now()
        };
    }

    private async withTimeout<T>(
        operation: (signal: AbortSignal) => Promise<T>,
        timeoutMs: number
    ): Promise<T> {
        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                controller.abort();
                reject(new Error('timeout'));
            }, timeoutMs);
        });

        try {
            return await Promise.race([
                operation(controller.signal),
                timeoutPromise
            ]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }
}
