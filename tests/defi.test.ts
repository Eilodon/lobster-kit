import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '../src/defi';
import { ClawKitConfig } from '../src/types';

// Mock viem clients
const mockWalletClient = {
    sendTransaction: vi.fn().mockResolvedValue('0xhash'),
    getAddresses: vi.fn().mockResolvedValue(['0xuser'])
};

const mockPublicClient = {
    readContract: vi.fn().mockResolvedValue(1000000000000000000n), // 1 token
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    call: vi.fn().mockResolvedValue('0x'),
    estimateGas: vi.fn().mockResolvedValue(21000n),
    getGasPrice: vi.fn().mockResolvedValue(1000000000n), // 1 gwei
    simulateContract: vi.fn().mockResolvedValue({ request: {} })
};

describe('DeFiModule', () => {
    let defi: DeFiModule;
    const config: ClawKitConfig = {
        chainConfig: {
            name: 'opBNB-Test',
            chainId: 204,
            tokens: {},
            contracts: {
                pancakeRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
                pancakeQuoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
                pancakeMasterChef: '0xa5B2478a54c8789C13c017C9EB59740110808C99',
                venusComptroller: '0xfD36E2c2a67e680Ffd32bF3bBD77258380D41036',
                venusMarkets: {
                    'BNB': '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
                    'USDT': '0xfD5840Cd36d94D7229439859C0112a4185BC0255'
                }
            }
        } as any
    };

    beforeEach(() => {
        defi = new DeFiModule(mockWalletClient as any, mockPublicClient as any, config);
        vi.clearAllMocks();
    });

    describe('Venus Protocol', () => {
        it('should lend BNB correctly', async () => {
            const result = await defi.lend({ asset: 'BNB', amount: '1.0' });
            expect(result.hash).toBe('0xhash');
            expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
                value: 1000000000000000000n // 1 BNB
            }));
        });

        it('should borrow USDT correctly', async () => {
            const result = await defi.borrow({ asset: 'USDT', amount: '100' });
            expect(result.hash).toBe('0xhash');
            // Verify it calls borrow function (simplified check)
            expect(mockWalletClient.sendTransaction).toHaveBeenCalled();
        });

        it('should repay BNB correctly', async () => {
            const result = await defi.repay({ asset: 'BNB', amount: '0.5' });
            expect(result.hash).toBe('0xhash');
            expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
                value: 500000000000000000n // 0.5 BNB
            }));
        });

        it('should enter markets', async () => {
            const result = await defi.enterMarkets(['BNB', 'USDT']);
            expect(result.hash).toBe('0xhash');
            expect(mockWalletClient.sendTransaction).toHaveBeenCalled();
        });

        it('should throw error for unsupported asset', async () => {
            await expect(defi.lend({ asset: 'UNKNOWN', amount: '1' }))
                .rejects.toThrow('No Venus market found');
        });
    });
});
