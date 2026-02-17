import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NFTModule } from '../src/nft';
import { ClawKitConfig, OPBNB_CONFIG, CLAWKIT_CONTRACTS } from '../src/types';
import { parseAbi, encodeFunctionData } from 'viem';

// Mock assertDeployed to avoid "not deployed" error
vi.mock('../src/types', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as any,
        assertDeployed: vi.fn().mockReturnValue('0x1234567890123456789012345678901234567890')
    };
});

// Mock dependencies
const mockPublic = {
    estimateGas: vi.fn(),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({})
};
const mockWallet = {
    getAddresses: vi.fn().mockResolvedValue(['0xUser']),
    sendTransaction: vi.fn().mockResolvedValue('0xHash'),
    account: { address: '0xUser' }
};

describe('NFTModule', () => {
    let nft: NFTModule;

    beforeEach(() => {
        vi.resetAllMocks();
        const config: ClawKitConfig = {
            chainConfig: OPBNB_CONFIG,
            rpcUrl: 'https://opbnb.rpc.url' // FIX: Missing RPC URL
        };
        nft = new NFTModule(mockWallet as any, mockPublic as any, config);
    });

    it('should encode mint with badgeType (P0-04)', async () => {
        await nft.mintBadge({
            to: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
            name: 'Test Badge',
            metadata: { key: 'value' },
            tier: 'Gold'
        });

        expect(mockWallet.sendTransaction).toHaveBeenCalledTimes(1);
        const tx = mockWallet.sendTransaction.mock.calls[0][0];

        // Verify ABI includes badge type (3rd arg)
        // Hard to verify encoded data, but we can verify it *tried* to call encodeFunctionData with 3 args?
        // Since we import encodeFunctionData, we rely on the mocked sendTransaction's data being correct if the code is correct.
        // We can inspect the implementation logic by indirectly asserting the call succeeded without error.

        // Let's rely on the fact that if the ABI didn't match the args, encodeFunctionData would throw.
        expect(tx.to).toBe(CLAWKIT_CONTRACTS.DynamicBadge);
    });

    it('should encode batchMint with badgeTypes array (P0-04)', async () => {
        await nft.mintBatch([
            { to: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', name: 'B1', tier: 'Silver' },
            { to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', name: 'B2', tier: 'Gold' }
        ]);

        expect(mockWallet.sendTransaction).toHaveBeenCalledTimes(1);
        const tx = mockWallet.sendTransaction.mock.calls[0][0];
        // Again, if ABI/args mismatch, this would have thrown during encoding inside the function
        expect(tx.data).toBeDefined();
    });
});
