import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '../src/defi';
import { SecurityModule } from '../src/security';
import { TokenSymbol, TOKENS } from '../src/types';

// Mock dependencies
const mockPublicClient = {
    readContract: vi.fn(),
    getGasPrice: vi.fn(),
    estimateGas: vi.fn(),
    call: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
} as any;

const mockWalletClient = {
    getAddresses: vi.fn().mockResolvedValue(['0xUserAddress']),
    sendTransaction: vi.fn(),
} as any;

const mockConfig = {
    chainConfig: {
        contracts: {},
        tokens: TOKENS
    }
} as any;

// Mock PriceService
vi.mock('../src/services/PriceService', () => ({
    getPriceService: () => ({
        getBNBPrice: vi.fn().mockRejectedValue(new Error('Price Service Down')),
        fetchTokenPrices: vi.fn().mockRejectedValue(new Error('Price Service Down'))
    })
}));

describe('Hotfix: DeFi Module Critical Fixes', () => {
    let defi: DeFiModule;

    beforeEach(() => {
        vi.clearAllMocks();
        // Mock Security Module
        const mockSecurity = {
            scanContract: vi.fn().mockResolvedValue({ riskScore: 0 })
        } as any;

        defi = new DeFiModule(mockWalletClient, mockPublicClient, mockConfig, mockSecurity);
    });

    describe('Decimals LRU Cache', () => {
        it('should evict old entries when cache size exceeds limit', async () => {
            // Internal access to verify cache size (using any)
            const defiAny = defi as any;

            // Limit is 100. Let's add 105 entries.
            for (let i = 0; i < 105; i++) {
                // Mock decimals call
                mockPublicClient.readContract.mockResolvedValue(18);
                // Use unique addresses
                const addr = `0x${i.toString(16).padStart(40, '0')}`;
                await defi.getDynamicTokenDecimals(addr);
            }

            // Verify size is capped at 100
            expect(defiAny.decimalsCache.size).toBeLessThanOrEqual(100);
            expect(defiAny.decimalsCache.size).toBe(100);

            // Verify oldest (0x0...0) was evicted
            const firstAddr = `0x${(0).toString(16).padStart(40, '0')}`;
            // Cache keys are lowercase
            expect(defiAny.decimalsCache.has(firstAddr)).toBe(false);

            // Verify newest (0x...68 for i=104) exists
            const lastAddr = `0x${(104).toString(16).padStart(40, '0')}`;
            expect(defiAny.decimalsCache.has(lastAddr)).toBe(true);
        });
    });

    describe('Thermodynamic Blindspot (BNB Price)', () => {
        it('should FAIL CLOSED (throw error) when BNB price cannot be resolved', async () => {
            // Mock price oracle failure (if any)
            // No price service injected

            // Mock gas estimation to ensure we reach the price check
            mockPublicClient.estimateGas.mockResolvedValue(21000n);
            mockPublicClient.getGasPrice.mockResolvedValue(1000000000n); // 1 gwei

            // Call checkThermodynamics via private method access or by invoking a swap
            // We'll use access to private method for direct testing
            const defiAny = defi as any;

            const to = '0x123...';
            const data = '0x';
            const value = 0n;
            const amountUSD = 100; // $100 trade

            await expect(async () => {
                await defiAny.checkThermodynamics(to, data, value, 0n, 18, false, amountUSD);
            }).rejects.toThrow(/Thermodynamic Blindspot/);
        });

        it('should pass if price oracle provides price', async () => {
            // Mock price oracle
            defi.setPriceOracle({
                fetchTokenPrices: async () => ({ BNB: 300 })
            });

            // Mock gas
            mockPublicClient.estimateGas.mockResolvedValue(21000n);
            mockPublicClient.getGasPrice.mockResolvedValue(1000000000n);
            // Cost = 21000 * 1e9 = 2.1e13 wei = 0.000021 BNB
            // Cost USD = 0.000021 * 300 = 0.0063 USD
            // Trade = $100. Threshold = $10. Cost < Threshold. OK.

            const defiAny = defi as any;
            await expect(defiAny.checkThermodynamics('0x123', '0x', 0n, 0n, 18, false, 100))
                .resolves.not.toThrow();
        });
    });
});
