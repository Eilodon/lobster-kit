import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EidolonGuard } from '../src/eidolon/EidolonGuard';
import { WasmAdapter } from '../src/WasmAdapter';

function stableBucket(seed: string): number {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash % 100;
}

function findCanaryKeys(percent: number): { onKey: string; offKey: string } {
    let onKey = 'canary-on';
    let offKey = 'canary-off';

    for (let i = 0; i < 5000; i++) {
        const key = `node-${i}`;
        if (stableBucket(`${key}:causal`) < percent && stableBucket(`${key}:trauma`) < percent) {
            onKey = key;
            break;
        }
    }

    for (let i = 5000; i < 10000; i++) {
        const key = `node-${i}`;
        if (stableBucket(`${key}:causal`) >= percent && stableBucket(`${key}:trauma`) >= percent) {
            offKey = key;
            break;
        }
    }

    return { onKey, offKey };
}

describe('EidolonGuard Canary Consistency (Rust ON/OFF)', () => {
    const originalEnv = {
        EIDOLON_CAUSAL_RUST: process.env.EIDOLON_CAUSAL_RUST,
        EIDOLON_TRAUMA_RUST: process.env.EIDOLON_TRAUMA_RUST,
        EIDOLON_CAUSAL_RUST_CANARY_PCT: process.env.EIDOLON_CAUSAL_RUST_CANARY_PCT,
        EIDOLON_TRAUMA_RUST_CANARY_PCT: process.env.EIDOLON_TRAUMA_RUST_CANARY_PCT,
        EIDOLON_CANARY_KEY: process.env.EIDOLON_CANARY_KEY
    };
    const mockValueInvariant = {
        update_snapshot: vi.fn(),
        check_invariant: vi.fn().mockReturnValue({ safe: true, circuit_broken: false })
    };

    const mockAntiRug = {
        add_to_whitelist: vi.fn(),
        add_to_blacklist: vi.fn(),
        export_lists: vi.fn().mockReturnValue({ whitelist: [], blacklist: [] }),
        import_lists: vi.fn(),
        check_token_security: vi.fn().mockReturnValue({
            score: 90,
            is_honeypot: false,
            liquidity_locked: true,
            contract_verified: true,
            owner_renounced: true,
            status: 'SAFE'
        }),
        compute_score: vi.fn()
    };

    const mockCausalGraph = {
        learn: vi.fn(),
        get_edge: vi.fn().mockReturnValue({ successes: 1, failures: 0, probability: 1 }),
        export_edges: vi.fn().mockReturnValue({}),
        import_edges: vi.fn()
    };

    const mockTraumaRegistry = {
        record_trauma: vi.fn(),
        is_inhibited: vi.fn().mockReturnValue(false),
        get_remaining_ms: vi.fn().mockReturnValue(0n),
        heal: vi.fn()
    };

    const mockKit = {
        publicClient: {
            getBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000_000n)
        },
        walletClient: {
            account: { address: '0x1234567890123456789012345678901234567890' }
        },
        config: {}
    } as any;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(WasmAdapter, 'getInstance').mockReturnValue({
            createValueInvariant: () => mockValueInvariant,
            createAntiRug: () => mockAntiRug,
            createCausalGraph: () => mockCausalGraph,
            createTraumaRegistry: () => mockTraumaRegistry
        } as any);
    });

    afterEach(() => {
        process.env.EIDOLON_CAUSAL_RUST = originalEnv.EIDOLON_CAUSAL_RUST;
        process.env.EIDOLON_TRAUMA_RUST = originalEnv.EIDOLON_TRAUMA_RUST;
        process.env.EIDOLON_CAUSAL_RUST_CANARY_PCT = originalEnv.EIDOLON_CAUSAL_RUST_CANARY_PCT;
        process.env.EIDOLON_TRAUMA_RUST_CANARY_PCT = originalEnv.EIDOLON_TRAUMA_RUST_CANARY_PCT;
        process.env.EIDOLON_CANARY_KEY = originalEnv.EIDOLON_CANARY_KEY;
    });

    it('should keep validation output consistent while runtime path switches by canary bucket', async () => {
        const canaryPct = 50;
        const { onKey, offKey } = findCanaryKeys(canaryPct);

        process.env.EIDOLON_CAUSAL_RUST = '1';
        process.env.EIDOLON_TRAUMA_RUST = '1';
        process.env.EIDOLON_CAUSAL_RUST_CANARY_PCT = String(canaryPct);
        process.env.EIDOLON_TRAUMA_RUST_CANARY_PCT = String(canaryPct);

        process.env.EIDOLON_CANARY_KEY = onKey;
        const guardRustOn = new EidolonGuard(mockKit, {
            maxRiskScore: 80,
            minConfidence: 50,
            enforceRiskySimulation: false,
            riskParameters: {
                maxPositionSize: 1000,
                maxDrawdown: 20,
                minConfidence: 50,
                cooldownPeriod: 0
            }
        });

        process.env.EIDOLON_CANARY_KEY = offKey;
        const guardRustOff = new EidolonGuard(mockKit, {
            maxRiskScore: 80,
            minConfidence: 50,
            enforceRiskySimulation: false,
            riskParameters: {
                maxPositionSize: 1000,
                maxDrawdown: 20,
                minConfidence: 50,
                cooldownPeriod: 0
            }
        });

        for (const guard of [guardRustOn, guardRustOff]) {
            (guard as any).valueInvariant = {
                update_snapshot: vi.fn(),
                check_invariant: vi.fn().mockReturnValue({ safe: true, circuit_broken: false })
            };
            (guard as any).antiRug = mockAntiRug;
            (guard as any).mind = {
                explain: vi.fn().mockResolvedValue({
                    timestamp: Date.now(),
                    action: 'BUY',
                    confidence: 85,
                    reasoning: 'deterministic',
                    causalFactors: [],
                    marketState: {
                        gasPrice: 'LOW',
                        whaleFlow: 'NEUTRAL',
                        sentiment: 'NEUTRAL',
                        liquidityDepth: 'DEEP',
                        priceAction: 'RANGING'
                    }
                })
            };
            (guard as any).soul = {
                getMode: () => 'ZEN',
                getModeConfig: () => ({ riskLevel: 0.5, maxLeverage: 1, maxPositionPct: 20, cooldownMs: 0 }),
                getCurrentState: () => ({ cortisol: 0, arousal: 0.1, valence: 0.6, momentum: 0.2 }),
                stimulate: vi.fn()
            };
            (guard as any).senseMarket = vi.fn().mockResolvedValue({
                gasPrice: 'LOW',
                whaleFlow: 'NEUTRAL',
                sentiment: 'NEUTRAL',
                liquidityDepth: 'DEEP',
                priceAction: 'RANGING'
            });
            (guard as any).calculateRisk = vi.fn().mockReturnValue(10);
        }

        const onBrain = (guardRustOn as any).brain.cognitiveBrain;
        const offBrain = (guardRustOff as any).brain.cognitiveBrain;
        const onTrauma = (guardRustOn as any).trauma;
        const offTrauma = (guardRustOff as any).trauma;

        expect(onBrain.isUsingWasm()).toBe(true);
        expect(offBrain.isUsingWasm()).toBe(false);
        expect(onTrauma.isUsingRust()).toBe(true);
        expect(offTrauma.isUsingRust()).toBe(false);

        const ctx = { amountUSD: 100 };
        const onResult = await guardRustOn.validateAction('BUY', ctx);
        const offResult = await guardRustOff.validateAction('BUY', ctx);

        expect(onResult.approved).toBe(offResult.approved);
        expect(onResult.riskScore).toBe(offResult.riskScore);
        expect(onResult.confidence).toBe(offResult.confidence);
        expect(onResult.reason).toBe(offResult.reason);
    });
});
