import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- MOCKS ---

// Mock WasmAdapter
vi.mock('../src/eidolon/WasmAdapter', () => ({
    WasmAdapter: {
        getInstance: () => ({
            createValueInvariant: () => ({
                check_invariant: () => ({ safe: true, circuit_broken: false }),
                update_snapshot: vi.fn()
            }),
            createAntiRug: () => ({
                check_token_security: () => ({ score: 100, is_honeypot: false, contract_verified: true, status: 'SAFE' }),
                add_to_whitelist: vi.fn(),
                add_to_blacklist: vi.fn(),
                import_lists: vi.fn(),
                export_lists: vi.fn(),
                compute_score: vi.fn().mockReturnValue({ score: 99, is_honeypot: false, contract_verified: true, status: 'SAFE' })
            }),
            init: vi.fn(),
        })
    }
}));

// Auto-Mock GoPlusSecurity
vi.mock('../src/eidolon/oracles/GoPlusSecurity');

import { GoPlusSecurity } from '../src/eidolon/oracles/GoPlusSecurity';
import { EidolonGuard } from '../src/eidolon/EidolonGuard';
import { ClawKit } from '../src/index';

// Mock Dependencies
const mockKit = {
    publicClient: { getBalance: vi.fn().mockResolvedValue(1000n) },
    walletClient: { account: { address: '0x123' } },
    config: { deepSeekConfig: { apiKey: 'test' } },
    public: {}
} as unknown as ClawKit;

describe('🔒 ATOMIC FIXES VERIFICATION', () => {
    let guard: EidolonGuard;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(GoPlusSecurity).mockClear();

        // Mock checkToken implementation
        // Since it's auto-mocked, prototype methods are spies
        GoPlusSecurity.prototype.checkToken = vi.fn().mockResolvedValue({
            is_honeypot: '0',
            honeypot_with_same_creator: '0',
            isOpenSource: '1',
            is_proxy: '0',
            owner_address: '0x0000000000000000000000000000000000000000',
            owner_change_balance: '0'
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    describe('Fix 2: Stale State Syndrome (Fail-Closed)', () => {
        it('should BLOCK if market state is older than 15s', async () => {
            guard = new EidolonGuard(mockKit);

            vi.setSystemTime(100000);
            (guard as any).lastSnapshotTime = 80000;

            const result = await guard.validateAction('BUY', { amountUSD: 100, tokenAddress: '0x123' });

            expect(result.approved).toBe(false);
            expect(result.reason).toMatch(/STALE STATE/);
        });

        it('should ALLOW if market state is fresh (<15s)', async () => {
            guard = new EidolonGuard(mockKit);
            vi.setSystemTime(100000);
            (guard as any).lastSnapshotTime = 90000; // 10s ago

            // Prime cache to avoid hitting Oracle (simplifies test)
            (guard as any).securityCache.set('0x123', { score: { score: 100, is_honeypot: false, status: 'SAFE' }, timestamp: 100000 });

            const result = await guard.validateAction('BUY', { amountUSD: 100, tokenAddress: '0x123' });

            expect(result.reason).not.toMatch(/STALE STATE/);
        });
    });

    describe('Fix 3: Latency Death Spiral (Async Mind)', () => {
        it('should NOT await mind.explain() and return immediately', async () => {
            guard = new EidolonGuard(mockKit, {
                maxRiskScore: 60,
                minConfidence: 70,
                riskParameters: { maxPositionSize: 100, maxDrawdown: 10, minConfidence: 70, cooldownPeriod: 60 },
                enforceRiskySimulation: false,
                intrusivenessThreshold: 1.0
            });

            vi.setSystemTime(100000);
            (guard as any).lastSnapshotTime = 100000;

            // Explicitly set cache to null to force oracle check if needed, but we mocked it.
            // Oh wait, if we don't have cache, it calls checkToken.
            // But verify checkToken is called? Or just that it doesn't crash.

            // Mock slow mind
            let mindResolved = false;
            const slowMind = vi.fn().mockImplementation(async () => {
                await new Promise(r => setTimeout(r, 5000));
                mindResolved = true;
                return {
                    confidence: 90,
                    reasoning: "Deep Thought",
                    action: 'BUY',
                    timestamp: Date.now()
                };
            });
            (guard as any).mind = { explain: slowMind };

            const result = await guard.validateAction('BUY', { amountUSD: 100, tokenAddress: '0x123' });

            expect(mindResolved).toBe(false);
            expect(result.reason).toMatch(/REFLEX MODE/);

            await vi.advanceTimersByTimeAsync(6000);
            expect(mindResolved).toBe(true);

            (guard as any).mind.explain.mockClear();
            const result2 = await guard.validateAction('BUY', { amountUSD: 100, tokenAddress: '0x123' });

            expect(result2.confidence).toBe(90);
            expect((guard as any).mind.explain).not.toHaveBeenCalled();
        });
    });
});
