
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityModule } from '@eidolon/defi-bnb';

// Mock dependencies
const mockWalletClient = { getAddresses: vi.fn().mockResolvedValue(['0x123']) } as any;
const mockPublicClient = { readContract: vi.fn(), call: vi.fn() } as any;
const mockConfig = { rpcUrl: 'https://rpc.opbnb.vip', chainConfig: {} } as any; // Valid config

describe('SecurityModule: Immune Boost (Fail Safe)', () => {
    let security: SecurityModule;

    beforeEach(() => {
        vi.clearAllMocks();
        // Skip strict config validation for test or allow it since we pass valid config
        security = new SecurityModule(mockWalletClient, mockPublicClient, mockConfig);
    });

    it('should THROW ERROR if critical config is missing (Bio-Check)', () => {
        expect(() => new SecurityModule(mockWalletClient, mockPublicClient, {} as any)).toThrowError(/CRITICAL/);
    });

    it('should enter degraded probe-only mode when GoPlus API fails', async () => {
        vi.spyOn(security as any, 'checkHoneypotGoPlus').mockRejectedValue(new Error('SECURITY_SCAN_FAILED'));
        vi.spyOn(security as any, 'checkContractVerification').mockResolvedValue(true);
        vi.spyOn(security as any, 'checkOwnership').mockResolvedValue(false);
        vi.spyOn(security as any, 'checkTradingRestrictions').mockResolvedValue([]);
        vi.spyOn(security as any, 'checkBytecodeSanity').mockResolvedValue(true);
        vi.spyOn(security as any, 'getGoPlusSecurityData').mockResolvedValue(null);

        const result = await security.scanContract('0xTargetContract');

        expect(result.isHoneypot).toBe(false);
        expect(result.degradedMode).toBe(true);
        expect(result.maxAllowedTradeUSD).toBe(100);
        expect(result.risks.some((r: string) => r.includes('Degraded mode'))).toBe(true);
    });

    it('should return safe result when API succeeds and returns clean data', async () => {
        vi.spyOn(security as any, 'checkHoneypotGoPlus').mockResolvedValue(false);
        vi.spyOn(security as any, 'checkContractVerification').mockResolvedValue(true);
        vi.spyOn(security as any, 'checkOwnership').mockResolvedValue(false);
        vi.spyOn(security as any, 'checkTradingRestrictions').mockResolvedValue([]);
        vi.spyOn(security as any, 'checkBytecodeSanity').mockResolvedValue(true);
        vi.spyOn(security as any, 'getGoPlusSecurityData').mockResolvedValue({
            is_high_tax: false,
            is_blacklisted: false,
            is_open_source: true,
            liquidity_locked: true
        });

        const result = await security.scanContract('0xTargetContract');
        expect(result.isHoneypot).toBe(false);
        expect(result.degradedMode).toBe(false);
    });
});
