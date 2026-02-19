import { OpenClawAdapter } from '../src/connectors/OpenClawAdapter';
import { EidolonGuard } from '../src/eidolon/EidolonGuard';
import { WasmAdapter } from '../src/eidolon/WasmAdapter';
import { getTokenDecimals } from '../src/types';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockGuard = {
    validateAction: vi.fn().mockResolvedValue({ approved: true, reason: 'Mock' })
} as unknown as EidolonGuard;

describe('Audit Security Fixes', () => {

    describe('1. OpenClawAdapter Action Mapping', () => {
        let adapter: OpenClawAdapter;

        beforeEach(() => {
            adapter = new OpenClawAdapter(mockGuard);
        });

        it('should NOT map unknown skills to HOLD (Bypass Check)', async () => {
            // Current vulnerable behavior: maps to HOLD
            // Fixed behavior: should throw or return 'failed'

            const result = await adapter.execute({
                action: 'suspicious_skill_bypass',
                params: {}
            });

            // If fix is implemented, this should be 'failed' or 'denied'
            // If vulnerable, it might pass as success (mapped to HOLD, minimal checks)
            // We assert the FIXED behavior
            expect(result.status).not.toBe('success');
            expect(result.error).toMatch(/Unknown skill|Invalid action/);
        });

        it('should map explicit HOLD skills', async () => {
            // Register a dummy hold skill to test mapping logic if we were testing internal method
            // But here we test public execute. 
            // We need to register a skill first to even reach validation logic
            adapter.registerSkill({
                name: 'suspicious_skill_bypass',
                description: 'test',
                schema: {},
                handler: async () => ({})
            });

            // Now execute
            // In vulnerable code: 'suspicious_skill_bypass' -> 'HOLD' -> validateAction('HOLD') -> passes -> success
            // In fixed code: 'suspicious_skill_bypass' -> 'UNKNOWN' or thrown -> fail

            const result = await adapter.execute({
                action: 'suspicious_skill_bypass',
                params: {}
            });

            // Expect failure due to strict mapping
            expect(result.status).toBe('failed');
        });
    });

    describe('3. Token Decimals Safety', () => {
        it('should throw on unknown token', () => {
            expect(() => getTokenDecimals('UNKNOWN_TOKEN_XYZ')).toThrow(/decimals/i);
        });
    });

    describe('4. EidolonGuard Anti-Rug Context', () => {
        it('should fail validation if tokenAddress is missing for BUY', async () => {
            const mockKit = {
                config: {
                    chainConfig: {}, // minimal valid config structure
                    deepSeekConfig: undefined,
                    security: {
                        maxGasPrice: 100n
                    }
                },
                publicClient: {
                    getBalance: vi.fn().mockResolvedValue(0n),
                    call: vi.fn(),
                    readContract: vi.fn()
                },
                walletClient: {
                    account: { address: '0x123' }
                }
            } as any;

            const guard = new EidolonGuard(mockKit);

            // Mock internal dependencies logic by mocking the method we can't easily init
            // But we are testing validateAction logic.
            // We'll rely on the fact that without 'mind' or 'soul' initialized, 
            // validateAction might fail on those steps unless we mock them too?
            // EidolonGuard init:
            // this.mind = new EidolonMind(kit);
            // this.soul = new EmotionalCore(kit);
            // These constructors might fail if kit is partial.
            // Let's add minimal mocks for them if needed or assume they survive undefined config parts.
            // Actually, EidolonMind needs openai config. 

            // To make this test robust without testing the whole system:
            // We can mock the private properties if we cast to any?
            // Or better, just pass enough config.

            const result = await guard.validateAction('BUY', {
                amountUSD: 100
                // tokenAddress MISSING
            });

            expect(result.approved).toBe(false);
            expect(result.reason).toMatch(/Missing 'tokenAddress'/);
        });
    });

    describe('6. WasmAdapter Readiness', () => {
        it('should return false if WASM is not loaded', () => {
            WasmAdapter.resetInstance();
            const wasm = WasmAdapter.getInstance();
            // We haven't called init(), so it should be false
            expect(wasm.isReady()).toBe(false);
        });
    });

});
