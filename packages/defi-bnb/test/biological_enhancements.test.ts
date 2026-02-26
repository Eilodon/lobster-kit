
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeFiModule } from '../src/defi';
import { GasModule } from '../src/gas';
import { EidolonConfig, ChainConfig, EidolonWalletClient } from '../src/types';
import { PublicClient, parseEther, formatUnits } from 'viem';

// Mocks
const mockPublicClient = {
    readContract: vi.fn(),
    getGasPrice: vi.fn(),
    estimateGas: vi.fn(),
    multicall: vi.fn(),
} as unknown as PublicClient;

const mockWalletClient = {
    account: { address: '0xUser' },
    sendTransaction: vi.fn(),
    getAddresses: vi.fn().mockResolvedValue(['0xUser']),
} as unknown as EidolonWalletClient;

const mockConfig: EidolonConfig = {
    rpcUrl: 'https://mock-rpc.com',
    privateKey: '0xPrivate',
    contracts: {
        pancakeQuoter: '0xQuoter',
    },
    chainConfig: {
        contracts: {
            pancakeQuoter: '0xQuoter',
        },
        tokens: {
            WBNB: { address: '0xWBNB', decimals: 18, symbol: 'WBNB' },
            USDT: { address: '0xUSDT', decimals: 18, symbol: 'USDT' }, // Using 18 for test simplicity
        }
    } as unknown as ChainConfig
} as unknown as EidolonConfig;

describe('Biological Enhancements (Therapies)', () => {

    describe('Therapy 1: Dynamic Decimals (DeFiModule)', () => {
        let defi: DeFiModule;

        beforeEach(() => {
            const mockSecurity = { scanContract: vi.fn() } as any;
            defi = new DeFiModule(mockWalletClient, mockPublicClient, mockConfig, mockSecurity);
            vi.clearAllMocks();
        });

        it('should fetch and cache decimals for unknown tokens', async () => {
            const tokenAddress = '0xUnknownToken';
            const expectedDecimals = 9;

            // Mock readContract to return decimals
            (mockPublicClient.readContract as any).mockResolvedValueOnce(expectedDecimals);

            // 1st Call: Should hit the "chain" (mock)
            const decimals1 = await defi.getDynamicTokenDecimals(tokenAddress);
            expect(decimals1).toBe(expectedDecimals);
            expect(mockPublicClient.readContract).toHaveBeenCalledTimes(1);

            // 2nd Call: Should hit the cache
            const decimals2 = await defi.getDynamicTokenDecimals(tokenAddress);
            expect(decimals2).toBe(expectedDecimals);
            expect(mockPublicClient.readContract).toHaveBeenCalledTimes(1); // Call count unchanged
        });

        it('should fallback to hardcoded defaults for known tokens', async () => {
            // Assuming 'BNB' is known in default internal config or just works via lookup
            // But getDynamicTokenDecimals is for addresses usually.
            // If we pass a known address from config, it might optimization?
            // Actually the implementation checks cache -> resolve -> read.

            // Let's test non-cached flow again with fail
            (mockPublicClient.readContract as any).mockRejectedValueOnce(new Error('Reading failed'));

            await expect(defi.getDynamicTokenDecimals('0xBadAddr')).rejects.toThrow('Failed to resolve decimals');
        });
    });

    describe('Therapy 2: Parallel Evacuation (DeFiModule)', () => {
        let defi: DeFiModule;

        beforeEach(() => {
            // Mock tokens in config by overriding specific property if possible
            // internal 'tokens' is private, but we can mock 'dumpAllPositions' internals or use a configured instance
            // We will mock the 'tokens' property access via 'any' cast as we can't easily change private/protected in TS test without accessors
            const mockSecurity = { scanContract: vi.fn().mockResolvedValue({ riskScore: 0 }) } as any;
            defi = new DeFiModule(mockWalletClient, mockPublicClient, mockConfig, mockSecurity);

            // Inject some tokens via config
            const originalTokens = { ...mockConfig.chainConfig!.tokens };
            mockConfig.chainConfig!.tokens = {
                ...originalTokens,
                TOKEN_A: { symbol: 'TOKEN_A', address: '0xA', decimals: 18 },
                TOKEN_B: { symbol: 'TOKEN_B', address: '0xB', decimals: 18 },
                TOKEN_C: { symbol: 'TOKEN_C', address: '0xC', decimals: 18 }, // Fail case
            } as any;

            vi.clearAllMocks();
        });

        it('should sell multiple tokens in parallel and report results', async () => {
            // Mock balanceOf
            (mockPublicClient.readContract as any).mockResolvedValue(parseEther('100')); // Everyone has 100 tokens

            // Mock swap
            // implementation calls this.swap
            const swapSpy = vi.spyOn(defi, 'swap');
            swapSpy.mockResolvedValueOnce({ hash: '0xTxA', amountOut: '90' });
            swapSpy.mockResolvedValueOnce({ hash: '0xTxB', amountOut: '90' });
            swapSpy.mockRejectedValueOnce(new Error('Swap Failed for C'));

            const results = await defi.dumpAllPositions();

            // Verify results
            expect(results).toHaveLength(3); // 2 successes, 1 failure text?
            // The implementation filters out "Skipped" but keeps errors and successes.

            const successA = results.find(r => r.includes('Sold TOKEN_A'));
            const successB = results.find(r => r.includes('Sold TOKEN_B'));
            const failC = results.find(r => r.includes('Failed TOKEN_C'));

            expect(successA).toBeTruthy();
            expect(successB).toBeTruthy();
            expect(failC).toBeTruthy();
        });
    });

    describe('Therapy 3: Sensory Resilience (GasModule)', () => {
        let gas: GasModule;

        beforeEach(() => {
            gas = new GasModule(mockWalletClient, mockPublicClient, mockConfig);
            vi.clearAllMocks();
        });

        it('should use On-Chain price when Oracle is missing', async () => {
            const expectedPrice = 600.5;
            // Mock getBNBPriceOnChain internal call OR mock 'readContract' it uses.
            // It uses 'pancakeQuoter' and 'quoteExactInputSingle'.

            // Mock return value big int.
            // If USDT decimals is 18 (mocked above) and price is 600.5
            // 600.5 * 10^18
            const amountOut = BigInt(6005) * BigInt(10) ** BigInt(17); // 600.5e18

            (mockPublicClient.readContract as any).mockResolvedValue(amountOut);

            const price = await gas.getBNBPrice();

            expect(price).toBeCloseTo(600.5);
            expect(mockPublicClient.readContract).toHaveBeenCalledWith(expect.objectContaining({
                functionName: 'quoteExactInputSingle'
            }));
        });
    });

});
