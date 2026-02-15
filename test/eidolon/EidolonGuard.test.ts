
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
        GoPlusSecurity: vi.fn().mockImplementation(() => ({
            checkToken: vi.fn().mockResolvedValue({
                is_honeypot: false,
                is_open_source: true
            })
        }))
    };
});

// Mock MarketStream
vi.mock('../../src/eidolon/sensors/MarketStream', () => {
    return {
        MarketStream: vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            subscribe: vi.fn()
        }))
    };
});

// Mock ActiveLearning
vi.mock('../../src/eidolon/ActiveLearning', () => {
    return {
        ActiveLearning: vi.fn().mockImplementation(() => ({
            init: vi.fn().mockResolvedValue(undefined),
            learnFromOutcome: vi.fn()
        }))
    };
});

// Mock EmotionalCore
vi.mock('../../src/eidolon/EmotionalCore', () => {
    return {
        EmotionalCore: vi.fn().mockImplementation(() => ({
            init: vi.fn().mockResolvedValue(undefined),
            getProfile: vi.fn().mockReturnValue({
                state: 'NEUTRAL',
                biometrics: { glucose: 50, cortisol: 0, dopamine: 50 },
                confidence: 80,
                aggression: 50
            }),
            getRiskParameters: vi.fn().mockReturnValue({
                maxPositionSize: 1000,
                maxDrawdown: 10,
                minConfidence: 70,
                cooldownPeriod: 0
            }),
            shouldTrade: vi.fn().mockReturnValue(true),
            processOutcome: vi.fn()
        }))
    };
});

describe('EidolonGuard', () => {
    let guard: EidolonGuard;

    // Mocks
    const mockPublicClient = {
        chain: { id: 204 },
        readContract: vi.fn(),
        getBalance: vi.fn(),
        watchBlockNumber: vi.fn()
    } as unknown as PublicClient;

    const mockWalletClient = {
        account: { address: '0x123' },
        getAddresses: vi.fn().mockResolvedValue(['0x123'])
    } as unknown as WalletClient;

    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize without error using defaults', () => {
            expect(() => {
                new EidolonGuard(mockPublicClient, mockWalletClient);
            }).not.toThrow();
        });
    });

    describe('Validation Logic', () => {
        it('should approve low risk actions', async () => {
            const guard = new EidolonGuard(mockPublicClient, mockWalletClient, {
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
            const guard = new EidolonGuard(mockPublicClient, mockWalletClient, {
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
    });
});
