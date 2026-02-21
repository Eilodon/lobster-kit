
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EidolonGuard } from '../src/eidolon/EidolonGuard';
import { PublicClient, WalletClient } from 'viem';
import { EidolonBus, EidolonEventType } from '../src/events/EidolonBus';

// Mock WasmAdapter
vi.mock('../src/WasmAdapter', () => {
    return {
        WasmAdapter: {
            getInstance: () => ({
                init: () => Promise.resolve(),
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
vi.mock('../src/oracles/GoPlusSecurity', () => {
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
vi.mock('../src/sensors/MarketStream', () => ({
    MarketStream: class {
        start() { }
        subscribe(cb: any) { }
    }
}));

// Mock ClawOracle
vi.mock('../src/sensors/ClawOracle', () => ({
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
vi.mock('../src/eidolon/DivineTransparency', () => ({
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
const learnFromOutcomeMock = vi.fn();
vi.mock('../src/eidolon/ActiveLearning', () => ({
    ActiveLearning: class {
        async init() { }
        async learnFromOutcome(...args: any[]) { return learnFromOutcomeMock(...args); }
        getWeights() { return {}; }
        reinitWasmGraphs() { }
        getCausalSignal() {
            return { confidenceDelta: 0, explanations: [] };
        }
    }
}));



// Mock EmotionalCore
const stimulateMock = vi.fn();
vi.mock('../src/eidolon/EmotionalCore', () => ({
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
        stimulate(...args: any[]) { return stimulateMock(...args); }
        getRiskMultiplier() { return 1.0; }
        async tick() { return { cortisol: 0, arousal: 0, valence: 0, momentum: 0 }; }
        getCurrentState() {
            return {
                cortisol: 0,
                arousal: 0,
                valence: 0,
                momentum: 0,
                dopamine: 50
            };
        }
        getMode() { return 'ZEN'; }
        getModeConfig() {
            return {
                riskLevel: 0.2,
                maxLeverage: 1,
                maxPositionPct: 0.1,
                cooldownMs: 0
            };
        }
    }
}));

// Mock EidolonSimulator
vi.mock('../src/simulation/EidolonSimulator', () => ({
    EidolonSimulator: class {
        async simulate(tx: any) {
            // Default: successful simulation
            return {
                success: true,
                gasUsed: 100000n,
                logs: []
            };
        }
        async simulateRiskMatrix(tx: any) {
            return {
                base: await this.simulate(tx),
                gasWorstCase: { estimatedGas: 100000n, bufferPct: 30 },
                footprint: { touchedCount: 2, touchedAddresses: ['0xA', '0xB'] },
                allPassed: true
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
        learnFromOutcomeMock.mockReset();
        stimulateMock.mockReset();
    });

    afterEach(() => {
        EidolonBus.getInstance().removeAllListeners();
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

            const result = await guard.validateAction('BUY', {
                amountUSD: 100,
                tokenAddress: '0xDummy',
                txCandidate: {
                    to: '0xTarget',
                    data: '0x',
                    value: 0n,
                    account: '0xSender'
                }
            });

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
            const result = await guard.validateAction('BUY', {
                amountUSD: 100,
                tokenAddress: '0xDummy',
                txCandidate: {
                    to: '0xTarget',
                    data: '0x',
                    value: 0n,
                    account: '0xSender'
                }
            });

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

        it('should require txCandidate when risky simulation enforcement is enabled', async () => {
            const guard = new EidolonGuard(mockKit, {
                maxRiskScore: 100,
                minConfidence: 0,
                enforceRiskySimulation: true,
                intrusivenessThreshold: 0.5,
                riskParameters: {
                    maxPositionSize: 1000,
                    maxDrawdown: 100,
                    minConfidence: 0,
                    cooldownPeriod: 0
                }
            });
            await guard.init();

            const result = await guard.validateAction('BUY', {
                amountUSD: 100,
                tokenAddress: '0xToken'
            });

            expect(result.approved).toBe(false);
            expect(result.reason).toContain('SIMULATION_REQUIRED');
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
                simulateRiskMatrix: vi.fn().mockResolvedValue({
                    base: mockShadowResult,
                    gasWorstCase: { estimatedGas: 65000n, bufferPct: 30 },
                    footprint: {
                        touchedCount: 15,
                        touchedAddresses: Array(15).fill('0xContract')
                    },
                    allPassed: true
                })
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

        it('should BLOCK action if TraumaRegistry has inhibited it', async () => {
            const guard = new EidolonGuard(mockKit);
            await guard.init();

            // 1. Report Trauma
            // Mode defaults to 'ZEN' in mock soul
            guard.reportTrauma('ZEN', 'BUY', 1.0);

            // 2. Attempt Action
            const result = await guard.validateAction('BUY', {
                amountUSD: 100,
                tokenAddress: '0xToken'
            });

            // 3. Verify Block
            expect(result.approved).toBe(false);
            expect(result.riskScore).toBe(100);
            expect(result.reason).toContain('TRAUMA INHIBITION');
        });
    });

    it('should learn and stimulate on TRADE_EXECUTED events', async () => {
        const guard = new EidolonGuard(mockKit);
        await guard.init();

        const bus = EidolonBus.getInstance();
        bus.emitEvent({
            type: EidolonEventType.TRADE_EXECUTED,
            timestamp: Date.now(),
            payload: {
                action: 'BUY',
                decisionLog: {
                    timestamp: Date.now(),
                    action: 'BUY',
                    confidence: 88,
                    reasoning: 'test',
                    marketState: {
                        gasPrice: 'LOW',
                        whaleFlow: 'ACCUMULATING',
                        sentiment: 'NEUTRAL',
                        liquidityDepth: 'DEEP',
                        priceAction: 'RANGING'
                    },
                    causalFactors: []
                },
                outcome: {
                    decisionId: Date.now(),
                    profitLoss: 12,
                    capitalAtRisk: 100,
                    slippage: 0.4,
                    gasUsed: 1,
                    success: true
                }
            }
        });

        // Event callbacks are async fire-and-forget.
        await Promise.resolve();
        await Promise.resolve();

        expect(learnFromOutcomeMock).toHaveBeenCalledTimes(1);
        expect(stimulateMock).toHaveBeenCalledTimes(1);
    });
});
