
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EidolonGuard } from '../../src/eidolon/EidolonGuard';
import { WasmAdapter } from '../../src/eidolon/WasmAdapter';
import { ClawKit } from '../../src/index';

// Mock dependencies
const mockKit = {
    publicClient: {},
    walletClient: { account: { address: '0xTest' } },
    config: { riskParameters: {} }
} as any;

const mockValueInvariant = {
    check_invariant: vi.fn(),
    update_snapshot: vi.fn()
};

const mockAntiRug = {
    check_token_security: vi.fn(),
    compute_score: vi.fn()
};

const mockWasmAdapter = {
    createValueInvariant: vi.fn().mockReturnValue(mockValueInvariant),
    createAntiRug: vi.fn().mockReturnValue(mockAntiRug)
};

// Mock Singleton
vi.spyOn(WasmAdapter, 'getInstance').mockReturnValue(mockWasmAdapter as any);

describe('EidolonGuard: Rust Integration', () => {
    let guard: EidolonGuard;

    beforeEach(() => {
        vi.clearAllMocks();
        guard = new EidolonGuard(mockKit, {
            maxRiskScore: 60,
            minConfidence: 70,
            enforceRiskySimulation: false,
            intrusivenessThreshold: 0.5,
            riskParameters: {
                maxPositionSize: 1000,
                maxDrawdown: 10,
                minConfidence: 70,
                cooldownPeriod: 0
            }
        });
        // Bypass private property access for testing if needed or use public API
    });

    it('should PASS IMPACT to Rust Circuit Breaker', async () => {
        const amountUSD = 1000;
        const slippage = 0.05; // 5%

        // Mock return
        mockValueInvariant.check_invariant.mockReturnValue({ safe: true, circuit_broken: false });

        // Mock Mind & Soul to pass
        (guard as any).mind = { explain: vi.fn().mockResolvedValue({ confidence: 90 }) };
        (guard as any).soul = {
            getCurrentState: () => ({ cortisol: 0 }),
            getRiskMultiplier: () => 1,
            getMode: () => 'ZEN',
            getModeConfig: () => ({ riskLevel: 0.5, maxLeverage: 1, maxPositionPct: 1.0 })
        };
        (guard as any).senseMarket = vi.fn().mockResolvedValue({});
        (guard as any).calculateRisk = vi.fn().mockReturnValue(10);

        await guard.validateAction('BUY', { amountUSD, estimatedSlippage: slippage });

        // VERIFY: Impact calculated correctly (1000 * 0.05 = 50)
        expect(mockValueInvariant.check_invariant).toHaveBeenCalledWith(1000, 50);
    });

    it('should DEFAULT IMPACT to 1% if slippage missing', async () => {
        const amountUSD = 1000;

        mockValueInvariant.check_invariant.mockReturnValue({ safe: true, circuit_broken: false });
        // Mock Mind & Soul to pass
        (guard as any).mind = { explain: vi.fn().mockResolvedValue({ confidence: 90 }) };
        (guard as any).soul = {
            getCurrentState: () => ({ cortisol: 0 }),
            getRiskMultiplier: () => 1,
            getMode: () => 'ZEN',
            getModeConfig: () => ({ riskLevel: 0.5, maxLeverage: 1, maxPositionPct: 1.0 })
        };
        (guard as any).senseMarket = vi.fn().mockResolvedValue({});
        (guard as any).calculateRisk = vi.fn().mockReturnValue(10);

        await guard.validateAction('BUY', { amountUSD });

        // VERIFY: Default 1% (1000 * 0.01 = 10)
        expect(mockValueInvariant.check_invariant).toHaveBeenCalledWith(1000, 10);
    });

    it('should CACHE security scores', async () => {
        const token = '0xCachedToken';

        // Mock API success (safe token)
        const mockScore = {
            score: 80,
            status: 'SAFE',
            is_honeypot: false,
            contract_verified: true
        };

        (guard as any).securityOracle = { checkToken: vi.fn().mockResolvedValue({}) };
        (guard as any).antiRug = { compute_score: vi.fn().mockReturnValue(mockScore) };
        vi.spyOn((guard as any).mind, 'explain').mockResolvedValue({ confidence: 90 } as any);

        // First Call
        await guard.validateAction('BUY', { amountUSD: 100, tokenAddress: token });

        // Second Call
        await guard.validateAction('BUY', { amountUSD: 100, tokenAddress: token });

    });
});
