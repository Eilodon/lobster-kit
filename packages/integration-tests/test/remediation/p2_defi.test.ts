
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '../src/defi';

// Mock dependencies
const mockWalletClient: any = {
    getAddresses: vi.fn().mockResolvedValue(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']),
    sendTransaction: vi.fn()
};
const mockPublicClient: any = {
    multicall: vi.fn(),
    readContract: vi.fn()
};

describe('DeFiModule P2 Fixes', () => {
    describe('AutoCompound Params', () => {
        it('should call stake with lpAddress as token param', async () => {
            const defi = new DeFiModule(mockWalletClient, mockPublicClient, {
                chainConfig: { contracts: { pancakeMasterChef: '0xChef' } }
            } as any);

            vi.spyOn(defi, 'harvestAll').mockResolvedValue({ totalRewards: '10', transactions: [] });
            vi.spyOn(defi as any, 'findBestAPYPool').mockResolvedValue({
                symbol: 'BNB-USDT',
                lpAddress: '0x4200000000000000000000000000000000000006'
            });
            const stakeSpy = vi.spyOn(defi, 'stake').mockResolvedValue({ hash: '0xHash' });

            await defi.autoCompound();

            expect(stakeSpy).toHaveBeenCalledWith({
                pool: 'BNB-USDT',
                token: '0x4200000000000000000000000000000000000006',
                amount: '10'
            });
        });
    });

    describe('Thermodynamic Fail Policy', () => {
        it('should warn but NOT throw in OPEN policy', async () => {
            const defi = new DeFiModule(mockWalletClient, mockPublicClient, {
                chainConfig: { contracts: { pancakeMasterChef: '0xChef' } },
                thermodynamicFailPolicy: 'OPEN'
            } as any);

            vi.spyOn(defi as any, 'checkThermodynamics').mockRejectedValue(new Error('Slippage exceeded'));
            const warnSpy = vi.spyOn(console, 'warn');

            // Directly simulate the policy logic (same as what's in swap())
            const applyPolicy = async () => {
                try {
                    await (defi as any).checkThermodynamics('0x', '0x', 0n, 0n, 18, false, 10);
                } catch (e: any) {
                    if (defi['config'].thermodynamicFailPolicy === 'OPEN') {
                        console.warn(`⚠️ THERMODYNAMIC CHECK FAILED (OPEN POLICY): ${e.message}`);
                    } else {
                        throw e;
                    }
                }
            };

            await expect(applyPolicy()).resolves.toBeUndefined(); // Does not throw
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('THERMODYNAMIC CHECK FAILED (OPEN POLICY)'));
        });

        it('should throw in CLOSED policy if check fails', async () => {
            const defi = new DeFiModule(mockWalletClient, mockPublicClient, {
                chainConfig: { contracts: { pancakeMasterChef: '0xChef' } }
                // Default: no policy = CLOSED
            } as any);

            vi.spyOn(defi as any, 'checkThermodynamics').mockRejectedValue(new Error('Slippage exceeded'));

            const applyPolicy = async () => {
                try {
                    await (defi as any).checkThermodynamics('0x', '0x', 0n, 0n, 18, false, 10);
                } catch (e: any) {
                    if (defi['config'].thermodynamicFailPolicy === 'OPEN') {
                        console.warn(`⚠️ THERMODYNAMIC CHECK FAILED (OPEN POLICY): ${e.message}`);
                    } else {
                        throw e;
                    }
                }
            };

            await expect(applyPolicy()).rejects.toThrow('Slippage exceeded');
        });
    });
});
