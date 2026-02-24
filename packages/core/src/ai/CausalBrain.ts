import { IStorageProvider } from '../memory/IStorageProvider';
import { WasmAdapter } from '../WasmAdapter';

/**
 * 🧠 CausalBrain: Synaptic Plasticity Engine
 *
 * Hybrid mode:
 * - Primary path: Rust CausalGraph (when available)
 * - Fallback path: TypeScript map (always maintained for safety/persistence)
 */

export class CausalEdge {
    successes = 0;
    failures = 0;

    successProb(): number {
        const total = this.successes + this.failures;
        if (total === 0) return 0.5;
        return this.successes / total;
    }

    confidence(): number {
        const total = this.successes + this.failures;
        // Asymptotic confidence: n / (n + 100)
        // n=20 -> 0.16
        // n=100 -> 0.50
        // n=1000 -> 0.90
        return total / (total + 100);
    }
}

export type SentinelVariable =
    | 'PriceDelta'
    | 'VolumeSpike'
    | 'Volatility'
    | 'Momentum'
    | 'GasPriceGwei'
    | 'MempoolPendingCnt'
    | 'WhaleNetFlow'
    | 'LiquidityImbalance'
    | 'SmartMoneyActivity'
    | 'PortfolioRisk'
    | 'UserAction'
    | 'Sentiment'
    | 'MacroFactor';

type RustEdgeSnapshot = {
    successes?: number;
    failures?: number;
    probability?: number;
    s?: number;
    f?: number;
    p?: number;
};

type RustCausalGraph = {
    learn: (cause: number, effect: number, outcomePositive: boolean) => void;
    get_edge?: (cause: number, effect: number) => RustEdgeSnapshot;
    export_edges?: () => unknown;
    import_edges?: (edges: unknown) => void;
};

const SENTINEL_VARIABLES: SentinelVariable[] = [
    'PriceDelta',
    'VolumeSpike',
    'Volatility',
    'Momentum',
    'GasPriceGwei',
    'MempoolPendingCnt',
    'WhaleNetFlow',
    'LiquidityImbalance',
    'SmartMoneyActivity',
    'PortfolioRisk',
    'UserAction',
    'Sentiment',
    'MacroFactor'
];

const VAR_TO_INDEX: Record<SentinelVariable, number> = SENTINEL_VARIABLES.reduce((acc, v, i) => {
    acc[v] = i;
    return acc;
}, {} as Record<SentinelVariable, number>);

const INDEX_TO_VAR: Record<number, SentinelVariable> = SENTINEL_VARIABLES.reduce((acc, v, i) => {
    acc[i] = v;
    return acc;
}, {} as Record<number, SentinelVariable>);

export class CausalBrain {
    private readonly weights: Map<string, CausalEdge> = new Map();
    private readonly priors: Map<string, { s: number; f: number }> = new Map();
    private wasmGraph: RustCausalGraph | null = null;
    private readonly wasmAdapter = WasmAdapter.getInstance();
    private readonly debugEnabled = process.env.EIDOLON_DEBUG === '1';

    constructor() {
        this.loadPriors();
        this.reinitWasmGraph();
    }

    private parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
        if (!value) return defaultValue;
        const normalized = value.trim().toLowerCase();
        if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') return true;
        if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') return false;
        return defaultValue;
    }

    private stableBucket(seed: string): number {
        let hash = 2166136261 >>> 0;
        for (let i = 0; i < seed.length; i++) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash % 100;
    }

    private resolveCanaryPercent(): number {
        const raw = process.env.EIDOLON_CAUSAL_RUST_CANARY_PCT ?? process.env.EIDOLON_RUST_CANARY_PCT;
        if (!raw) return 100;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return 100;
        return Math.min(100, Math.max(0, Math.floor(parsed)));
    }

    private shouldEnableRustGraph(): boolean {
        const enabled = this.parseBooleanFlag(process.env.EIDOLON_CAUSAL_RUST, true);
        if (!enabled) return false;

        const canaryPct = this.resolveCanaryPercent();
        if (canaryPct >= 100) return true;
        if (canaryPct <= 0) return false;

        const canaryKey = process.env.EIDOLON_CANARY_KEY
            || process.env.HOSTNAME
            || process.env.USER
            || 'default';
        const bucket = this.stableBucket(`${canaryKey}:causal`);
        return bucket < canaryPct;
    }

    private initializeWasmGraph(): void {
        if (!this.shouldEnableRustGraph()) {
            this.wasmGraph = null;
            return;
        }
        try {
            // FIX H3: Bind method to instance to preserve 'this' context, or call directly
            const adapter = this.wasmAdapter as unknown as { createCausalGraph?: () => unknown };
            if (typeof adapter.createCausalGraph !== 'function') {
                this.wasmGraph = null;
                return;
            }
            // Direct call preserves context
            const graph = adapter.createCausalGraph() as RustCausalGraph | null;
            if (graph && typeof graph.learn === 'function') {
                this.wasmGraph = graph;
            }
        } catch (e) {
            this.wasmGraph = null;
            console.warn('🧠 CAUSAL BRAIN: WASM graph unavailable, TS fallback only.', e);
        }
    }

    private loadPriors(): void {
        this.debug('🧠 CAUSAL BRAIN: Loading ancestral priors...');
        this.setEdgeProb('MempoolPendingCnt', 'GasPriceGwei', 95, 5);
        this.setEdgeProb('GasPriceGwei', 'Volatility', 60, 40);
        this.setEdgeProb('WhaleNetFlow', 'PriceDelta', 85, 15);
        this.setEdgeProb('Sentiment', 'PriceDelta', 70, 30);
        this.setEdgeProb('MacroFactor', 'Volatility', 80, 20);
        this.setEdgeProb('LiquidityImbalance', 'PriceDelta', 75, 25);
        this.setEdgeProb('SmartMoneyActivity', 'WhaleNetFlow', 65, 35);
    }

    private key(cause: string, effect: string): string {
        return `${cause}->${effect}`;
    }

    private setEdgeProb(cause: SentinelVariable, effect: SentinelVariable, s: number, f: number): void {
        const key = this.key(cause, effect);
        const edge = new CausalEdge();
        edge.successes = s;
        edge.failures = f;
        this.weights.set(key, edge);
        this.priors.set(key, { s, f });
    }

    private edgeToSnapshot(edge: CausalEdge): { s: number; f: number; p: number } {
        return {
            s: edge.successes,
            f: edge.failures,
            p: Number(edge.successProb().toFixed(2))
        };
    }

    private dumpTsWeights(): Record<string, { s: number; f: number; p: number }> {
        const dump: Record<string, { s: number; f: number; p: number }> = {};
        for (const [key, edge] of this.weights.entries()) {
            dump[key] = this.edgeToSnapshot(edge);
        }
        return dump;
    }

    private resolveRustEdge(raw: RustEdgeSnapshot | undefined): {
        successes: number;
        failures: number;
        probability: number;
    } {
        const successes = Number.isFinite(raw?.successes) ? Number(raw?.successes) : Number(raw?.s ?? 0);
        const failures = Number.isFinite(raw?.failures) ? Number(raw?.failures) : Number(raw?.f ?? 0);
        const probability = Number.isFinite(raw?.probability)
            ? Number(raw?.probability)
            : Number(raw?.p ?? 0.5);

        return {
            successes: Math.max(0, successes),
            failures: Math.max(0, failures),
            probability: Math.max(0, Math.min(1, probability))
        };
    }

    private syncLearnToRust(cause: SentinelVariable, effect: SentinelVariable, outcomePositive: boolean): void {
        if (!this.wasmGraph) return;
        try {
            this.wasmGraph.learn(VAR_TO_INDEX[cause], VAR_TO_INDEX[effect], outcomePositive);
        } catch (e) {
            console.warn('🧠 CAUSAL BRAIN: Rust learn failed, continuing TS path.', e);
        }
    }

    private parseEdgeKey(key: string): { cause: SentinelVariable; effect: SentinelVariable } | null {
        const [cause, effect] = key.split('->');
        if (!cause || !effect) return null;
        if (!(cause in VAR_TO_INDEX) || !(effect in VAR_TO_INDEX)) return null;
        return {
            cause: cause as SentinelVariable,
            effect: effect as SentinelVariable
        };
    }

    private toNamedEdgeKey(key: string): string {
        const match = /^(\d+)->(\d+)$/.exec(key);
        if (!match) return key;

        const cause = INDEX_TO_VAR[Number(match[1])];
        const effect = INDEX_TO_VAR[Number(match[2])];
        if (!cause || !effect) return key;
        return `${cause}->${effect}`;
    }

    private getRustEdgeEntries(raw: unknown): Array<[string, RustEdgeSnapshot]> {
        if (raw instanceof Map) {
            return Array.from(raw.entries()) as Array<[string, RustEdgeSnapshot]>;
        }
        if (Array.isArray(raw)) {
            return raw as Array<[string, RustEdgeSnapshot]>;
        }
        if (raw && typeof raw === 'object') {
            return Object.entries(raw as Record<string, RustEdgeSnapshot>);
        }
        return [];
    }

    private rebuildRustGraphFromMap(): void {
        if (!this.wasmGraph) return;

        if (this.wasmGraph.import_edges) {
            try {
                const payload: Record<string, { successes: number; failures: number }> = {};
                for (const [key, edge] of this.weights.entries()) {
                    const parsed = this.parseEdgeKey(key);
                    if (!parsed) continue;
                    payload[`${parsed.cause}->${parsed.effect}`] = {
                        successes: edge.successes,
                        failures: edge.failures
                    };
                }
                this.wasmGraph.import_edges(payload);
                return;
            } catch (e) {
                console.warn('🧠 CAUSAL BRAIN: Rust import failed, falling back to replay.', e);
            }
        }

        this.initializeWasmGraph();
        if (!this.wasmGraph) return;

        for (const [key, edge] of this.weights.entries()) {
            const parsed = this.parseEdgeKey(key);
            if (!parsed) continue;
            const prior = this.priors.get(key) ?? { s: 0, f: 0 };
            const extraS = Math.max(0, edge.successes - prior.s);
            const extraF = Math.max(0, edge.failures - prior.f);

            for (let i = 0; i < extraS; i++) {
                this.syncLearnToRust(parsed.cause, parsed.effect, true);
            }
            for (let i = 0; i < extraF; i++) {
                this.syncLearnToRust(parsed.cause, parsed.effect, false);
            }
        }
    }

    learn(cause: SentinelVariable, effect: SentinelVariable, outcomePositive: boolean): void {
        const key = this.key(cause, effect);
        let edge = this.weights.get(key);
        if (!edge) {
            edge = new CausalEdge();
            this.weights.set(key, edge);
        }

        if (outcomePositive) edge.successes++;
        else edge.failures++;

        this.syncLearnToRust(cause, effect, outcomePositive);
    }

    getPrediction(cause: SentinelVariable, effect: SentinelVariable): { prob: number; confidence: number } {
        if (this.wasmGraph?.get_edge) {
            try {
                const raw = this.wasmGraph.get_edge(VAR_TO_INDEX[cause], VAR_TO_INDEX[effect]);
                const resolved = this.resolveRustEdge(raw);
                const total = resolved.successes + resolved.failures;
                return {
                    prob: resolved.probability,
                    confidence: total / (total + 100)
                };
            } catch {
                // fall through to TS map
            }
        }

        const edge = this.weights.get(this.key(cause, effect));
        if (!edge) return { prob: 0.5, confidence: 0 };
        return {
            prob: edge.successProb(),
            confidence: edge.confidence()
        };
    }

    getSynapticMap(): Record<string, { s: number; f: number; p: number }> {
        const tsDump = this.dumpTsWeights();
        if (this.wasmGraph?.export_edges) {
            try {
                const raw = this.wasmGraph.export_edges();
                const entries = this.getRustEdgeEntries(raw);
                if (entries.length === 0) {
                    return tsDump;
                }
                const out: Record<string, { s: number; f: number; p: number }> = {};
                for (const [key, value] of entries) {
                    const namedKey = this.toNamedEdgeKey(String(key));
                    const resolved = this.resolveRustEdge(value);
                    out[namedKey] = {
                        s: resolved.successes,
                        f: resolved.failures,
                        p: Number(resolved.probability.toFixed(2))
                    };
                }
                return out;
            } catch {
                // fall through to TS map
            }
        }

        return tsDump;
    }

    public importSynapticMap(data: Record<string, { s: number; f: number }>): void {
        for (const [key, val] of Object.entries(data)) {
            // FIX: validate key before setting to avoid phantom edges from corrupt storage
            const parsed = this.parseEdgeKey(key);
            const edge = new CausalEdge();
            edge.successes = Number.isFinite(val.s) ? Math.max(0, val.s) : 0;
            edge.failures = Number.isFinite(val.f) ? Math.max(0, val.f) : 0;
            this.weights.set(key, edge);
        }
        this.rebuildRustGraphFromMap();
    }

    public reinitWasmGraph(): void {
        this.initializeWasmGraph();
        this.rebuildRustGraphFromMap();
    }

    public async saveSynapticMap(storage: IStorageProvider, key: string): Promise<void> {
        const data = this.getSynapticMap();
        await storage.save(key, data);
    }

    public async loadSynapticMap(storage: IStorageProvider, key: string): Promise<void> {
        const data = await storage.load<Record<string, { s: number; f: number; p: number }>>(key);
        if (data) {
            this.importSynapticMap(data);
            console.log(`🧠 CAUSAL BRAIN: Loaded ${Object.keys(data).length} synaptic edges.`);
        }
    }

    public isUsingWasm(): boolean {
        return this.wasmGraph !== null;
    }

    private debug(message: string): void {
        if (!this.debugEnabled) return;
        console.log(message);
    }
}
