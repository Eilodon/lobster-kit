
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GasModule, BATCH_EXECUTOR } from '@clawkit/defi-bnb';

// Mock dependencies
const mockWalletClient: any = {
    getAddresses: vi.fn(),
    sendTransaction: vi.fn()
};
const mockPublicClient: any = {
    estimateGas: vi.fn().mockResolvedValue(21000n),
    getGasPrice: vi.fn().mockResolvedValue(1000000000n)
};
const mockConfig: any = {
    chainConfig: {
        contracts: {
            batchExecutor: '0xConfiguredExecutor'
        }
    }
};

describe('GasModule P2 Fixes', () => {
    let gas: GasModule;

    beforeEach(() => {
        vi.clearAllMocks();
        mockWalletClient.getAddresses.mockResolvedValue(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']);
        gas = new GasModule(mockWalletClient, mockPublicClient, mockConfig);
    });

    describe('Batch Executor Address', () => {
        it('should use configured batch executor address', async () => {
            const txs = [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', data: '0x' }];

            await gas.calculateBreakEven(txs);

            // estimateGas should be called with config address which must be valid hex?
            // 0xConfiguredExecutor is not valid hex.
            // But estimateGas might just take string.
            // Wait, 'to: toAddress(batchExecutor)' calls 'toAddress' which throws if not 0x.
            // '0xConfiguredExecutor' starts with 0x.
            expect(mockPublicClient.estimateGas).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: '0xConfiguredExecutor'
                })
            );
        });

        it('should fallback to constant if config missing', async () => {
            const gasDefault = new GasModule(mockWalletClient, mockPublicClient, { chainConfig: { contracts: {} } } as any);
            const txs = [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', data: '0x' }];

            await gasDefault.calculateBreakEven(txs);

            expect(mockPublicClient.estimateGas).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: BATCH_EXECUTOR
                })
            );
        });
    });
});
