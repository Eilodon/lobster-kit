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
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' })
};

describe('DeFiModule', () => {
    let defi: DeFiModule;
    const config: ClawKitConfig = {};

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
