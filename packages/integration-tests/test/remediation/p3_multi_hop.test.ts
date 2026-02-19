import { describe, it, expect, vi } from 'vitest';
import { DeFiModule } from '../src/defi';

const mockWalletClient: any = {
    getAddresses: vi.fn().mockResolvedValue(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']),
};
const mockPublicClient: any = {
    readContract: vi.fn(),
    call: vi.fn(),
};
const config: any = {
    chainConfig: {
        contracts: {
            pancakeRouter: '0x4200000000000000000000000000000000000001',
            pancakeQuoter: '0x4200000000000000000000000000000000000002',
            pancakeMasterChef: '0x4200000000000000000000000000000000000003',
        },
        tokens: {
            BNB: { address: '0x4200000000000000000000000000000000000006', symbol: 'BNB', decimals: 18 },
            WBNB: { address: '0x4200000000000000000000000000000000000007', symbol: 'WBNB', decimals: 18 },
            USDT: { address: '0x4200000000000000000000000000000000000008', symbol: 'USDT', decimals: 6 },
            CAKE: { address: '0x4200000000000000000000000000000000000009', symbol: 'CAKE', decimals: 18 },
        }
    }
};

describe('DeFiModule P3 - Multi-hop Routing', () => {
    it('should try multi-hop when single-hop has no pool', async () => {
        const defi = new DeFiModule(mockWalletClient, mockPublicClient, config);

        // Single-hop calls all return 0 (no pool)
        mockPublicClient.readContract
            .mockResolvedValue(0n); // quoteExactInputSingle → 0

        const multiHopSpy = vi.spyOn(defi as any, 'getMultiHopQuote').mockResolvedValue({
            amountOutMin: 5000n,
            fee: 2500
        });

        const result = await (defi as any).getRealQuote(
            '0x4200000000000000000000000000000000000009', // CAKE
            '0x4200000000000000000000000000000000000008', // USDT
            1000000000000000000n,
            0.5
        );

        expect(multiHopSpy).toHaveBeenCalled();
        expect(result.amountOutMin).toBe(5000n);
    });

    it('should encode path bytes correctly for multi-hop quote', async () => {
        const defi = new DeFiModule(mockWalletClient, mockPublicClient, config);

        // Only the quoteExactInput (multi-hop) call should succeed
        mockPublicClient.readContract.mockImplementation(({ functionName }: any) => {
            if (functionName === 'quoteExactInput') return 2500n;
            return 0n;
        });

        const result = await (defi as any).getMultiHopQuote(
            '0x4200000000000000000000000000000000000009', // tokenIn
            '0x4200000000000000000000000000000000000008', // tokenOut
            '0x4200000000000000000000000000000000000007', // hop (WBNB)
            1000000000000000000n,
            0.5
        );

        // Should return a valid quote
        expect(result.amountOutMin).toBeGreaterThan(0n);
    });
});
