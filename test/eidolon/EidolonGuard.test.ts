
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EidolonGuard } from '../../src/eidolon/EidolonGuard';
import { PublicClient, WalletClient } from 'viem';

// Mock WasmAdapter
vi.mock('../../src/eidolon/WasmAdapter', () => {
    return {
        WasmAdapter: {
            getInstance: () => ({
                createValueInvariant: () => ({
                    check_invariant: (amount: number) => ({
                        safe: true,
                        reason: undefined,
                        circuit_broken: false
                    }),
                    update_snapshot: () => { }
                }),
                createAntiRug: () => ({
                    check_token_security: () => ({
                        score: 85,
                        is_honeypot: false,
                        contract_verified: true,
                        liquidity_locked: true,
                        owner_renounced: true,
                        status: 'SAFE'
                    }),
                    compute_score: (data: any) => ({
                        score: data.is_honeypot ? 0 : 90,
                        is_honeypot: data.is_honeypot,
                        contract_verified: true,
                        status: data.is_honeypot ? 'CRITICAL' : 'SAFE'
                    })
                })
            })
        }
    };
});

// Mock GoPlusSecurity
vi.mock('../../src/eidolon/oracles/GoPlusSecurity', () => {
    return {
        GoPlusSecurity: class {
            checkToken = vi.fn().mockResolvedValue({
                is_honeypot: false,
                is_open_source: true
            })
        }
    };
});



// Mock MarketStream
vi.mock('../../src/eidolon/sensors/MarketStream', () => ({
    MarketStream: class {
        start() { }
        subscribe(cb: any) { }
    }
}));

// Mock ClawOracle
vi.mock('../../src/eidolon/sensors/ClawOracle', () => ({
    ClawOracle: class {
        async getBNBPrice() { return 600; }
        async sense() {
            return {
                gasPrice: 'LOW',
                whaleFlow: 'NEUTRAL',
                sentiment: 'NEUTRAL',
                liquidityDepth: 'DEEP',
                priceAction: 'RANGING'
            };
        }
    }
}));


// Mock DivineTransparency
vi.mock('../../src/eidolon/DivineTransparency', () => ({
    DivineTransparency: class {
        async explain() {
            return {
                decisionId: 123,
                timestamp: Date.now(),
                action: 'BUY',
                confidence: 85,
                reasoning: 'Mock reasoning',
                marketState: {},
                causalFactors: [],
                weightsSnapshot: {}
            };
        }
    }
}));



// Mock ActiveLearning
vi.mock('../../src/eidolon/ActiveLearning', () => ({
    ActiveLearning: class {
        async init() { }
        async learnFromOutcome() { }
        getWeights() { return {}; }
    }
}));



// Mock EmotionalCore
vi.mock('../../src/eidolon/EmotionalCore', () => ({
    EmotionalCore: class {
        async init() { }
        getProfile() {
            return {
                state: 'NEUTRAL',
                biometrics: { glucose: 50, cortisol: 0, dopamine: 50 },
                confidence: 80,
                aggression: 50
            };
        }
        getRiskParameters() {
            return {
                maxPositionSize: 1000,
                maxDrawdown: 10,
                minConfidence: 70,
                cooldownPeriod: 0
            };
        }
        shouldTrade() { return true; }
        processOutcome() { }
        stimulate() { }
        getRiskMultiplier() { return 1.0; }
        async tick() { return { cortisol: 0, arousal: 0, valence: 0, momentum: 0 }; }
        getCurrentState() {
            return {
                cortisol: 0,
                arousal: 0,
                valence: 0,
                momentum: 0,
                glucose: 50,
                dopamine: 50
            };
        }
    }
}));

// Mock EidolonSimulator
vi.mock('../../src/eidolon/simulation/EidolonSimulator', () => ({
    EidolonSimulator: class {
        async simulate(tx: any) {
            // Default: successful simulation
            return {
                success: true,
                gasUsed: 100000n,
                logs: []
            };
        }
    }
}));

describe('EidolonGuard', () => {
    let guard: EidolonGuard;

    // Mocks
    const mockPublicClient = {
        chain: { id: 204 },
        readContract: vi.fn(),
        getBalance: vi.fn().mockResolvedValue(1000000000000000000n), // 1 BNB
        watchBlockNumber: vi.fn()
    } as unknown as PublicClient;

    const mockWalletClient = {
        account: { address: '0x123' },
        getAddresses: vi.fn().mockResolvedValue(['0x123'])
    } as unknown as WalletClient;

    const mockKit = {
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
        defi: {
            getRealQuote: vi.fn().mockResolvedValue(600000000n) // 600 USD (6 decimals)
        },
        gas: {
            getOptimalExecutionTime: vi.fn().mockResolvedValue({ currentGasPrice: '0.000005' })
        },
        config: {}
    } as unknown as any; // Using any to avoid importing full ClawKit type complexity in test, or cast to ClawKit if imported


    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize without error using defaults', () => {
            expect(() => {
                new EidolonGuard(mockKit);
            }).not.toThrow();
        });
    });

    describe('Validation Logic', () => {
        it('should approve low risk actions', async () => {
            const guard = new EidolonGuard(mockKit, {
                maxRiskScore: 80,
                minConfidence: 50,
                riskParameters: {
                    maxPositionSize: 1000,
                    maxDrawdown: 15,
                    minConfidence: 50,
                    cooldownPeriod: 0
                },
                // Mock Sensor
                marketStateSensor: async () => ({
                    gasPrice: 'LOW',
                    whaleFlow: 'ACCUMULATING', // + confidence
                    sentiment: 'NEUTRAL',
                    liquidityDepth: 'DEEP',
                    priceAction: 'RANGING'
                })
            });

            await guard.init();

            const result = await guard.validateAction('BUY', { amountUSD: 100 });

            expect(result.approved).toBe(true);
            expect(result.riskScore).toBeLessThan(80);
        });

        it('should block high risk actions', async () => {
            const guard = new EidolonGuard(mockKit, {
                maxRiskScore: 30, // Strict
                minConfidence: -100, // Bypass confidence check to test Risk Score logic
                riskParameters: {
                    maxPositionSize: 10,
                    maxDrawdown: 15,
                    minConfidence: 50,
                    cooldownPeriod: 0
                },
                // Mock Sensor - Dangerous Market
                marketStateSensor: async () => ({
                    gasPrice: 'HIGH', // +Risk
                    whaleFlow: 'DUMPING',
                    sentiment: 'FEAR',
                    liquidityDepth: 'THIN', // +Risk
                    priceAction: 'DUMPING'
                })
            });

            await guard.init();

            // Buying into a dump with thin liquidity should be high risk
            const result = await guard.validateAction('BUY', { amountUSD: 100 });

            expect(result.approved).toBe(false);
            expect(result.riskScore).toBeGreaterThan(30);
            expect(result.reason).toContain('Risk score too high');
        });

        it('should reject trade when amountUSD is missing even if txCandidate exists', async () => {
            const guard = new EidolonGuard(mockKit, {
                maxRiskScore: 100,
                minConfidence: 0,
                riskParameters: {
                    maxPositionSize: 1000,
                    maxDrawdown: 100,
                    minConfidence: 0,
                    cooldownPeriod: 0
                }
            });
            await guard.init();

            const txCandidate = {
                to: '0xTarget',
                data: '0x',
                value: 0n,
                account: '0xSender'
            };

            const result = await guard.validateAction('BUY', {
                tokenAddress: '0xToken',
                txCandidate
            });

            expect(result.approved).toBe(false);
            expect(result.reason).toContain("Missing or invalid 'amountUSD'");
        });

        it('should BLOCK transaction if BLAST RADIUS is exceeded (>10 contracts)', async () => {
            const guard = new EidolonGuard(mockKit, {
                maxRiskScore: 100,
                minConfidence: 0,
                riskParameters: {
                    maxPositionSize: 1000,
                    maxDrawdown: 100,
                    minConfidence: 0,
                    cooldownPeriod: 0
                }
            });
            await guard.init();

            const txCandidate = {
                to: '0xTarget',
                data: '0x',
                value: 0n,
                account: '0xSender'
            };

            // Mock Simulator returning high footprint
            const mockShadowResult = {
                success: true,
                gasUsed: 50000n,
                logs: [],
                touchedAddresses: Array(15).fill('0xContract') // 15 touched addresses
            };

            // Inject Mock Simulator
            const mockSim = {
                simulate: vi.fn().mockResolvedValue(mockShadowResult)
            };
            (guard as any).simulator = mockSim;

            const result = await guard.validateAction('BUY', {
                amountUSD: 100,
                tokenAddress: '0xToken',
                txCandidate
            });

            expect(result.approved).toBe(false);
            expect(result.reason).toContain('BLAST RADIUS EXCEEDED');
        });
    });
});
