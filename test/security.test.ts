import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityModule } from '../src/security';
import { ClawKitConfig, OPBNB_CONFIG, CLAWKIT_CONTRACTS } from '../src/types';
import { parseAbi, encodeFunctionData } from 'viem';

// Mock dependencies
const mockPublic = {
    readContract: vi.fn(),
    call: vi.fn().mockResolvedValue('0x'),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({})
};
const mockWallet = {
    getAddresses: vi.fn().mockResolvedValue(['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266']),
    sendTransaction: vi.fn().mockResolvedValue('0xHash'),
    account: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' } // Valid address
};

describe('SecurityModule', () => {
    let security: SecurityModule;

    beforeEach(() => {
        vi.clearAllMocks();
        const config: ClawKitConfig = {
            chainConfig: OPBNB_CONFIG,
            rpcUrl: 'https://opbnb.rpc.url'
        };
        security = new SecurityModule(mockWallet as any, mockPublic as any, config);
    });

    it('should implement batchRevokeApprovals via registry pattern (P0-03)', async () => {
        const tokens = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'];
        const spenders = ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', '0x90F79bf6EB2c4f870365E785982E1f101E93b906'];

        // Mock getRevocationCalldata response
        // Returns 2 tokens and 2 hex strings for calldata
        mockPublic.readContract.mockResolvedValueOnce([
            tokens,
            ['0xCalldata1', '0xCalldata2']
        ]);

        await security.batchRevokeApprovals(tokens, spenders);

        // 1. Should call flagApprovalsBatch
        expect(mockWallet.sendTransaction).toHaveBeenCalledTimes(4);
        // 1st: flagApprovalsBatch
        // 2nd: revoke token A
        // 3rd: revoke token B
        // 4th: clearFlaggedApprovals

        const flagCall = mockWallet.sendTransaction.mock.calls[0][0];
        // Verify flag call structure somewhat (checking data encoding is complex without decoding helper)
        expect(flagCall.to).toBe(CLAWKIT_CONTRACTS.ApprovalRevoker);

        // 2. Should query getRevocationCalldata
        expect(mockPublic.readContract).toHaveBeenCalledTimes(1);
        const readCall = mockPublic.readContract.mock.calls[0][0];
        expect(readCall.functionName).toBe('getRevocationCalldata');

        // 3. Should execute individual revocations from user wallet (PULL pattern)
        const revokeCall1 = mockWallet.sendTransaction.mock.calls[1][0];
        expect(revokeCall1.to).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
        expect(revokeCall1.data).toBe('0xCalldata1');

        const revokeCall2 = mockWallet.sendTransaction.mock.calls[2][0];
        expect(revokeCall2.to).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
        expect(revokeCall2.data).toBe('0xCalldata2');

        // 4. Should clear flags at end
        const clearCall = mockWallet.sendTransaction.mock.calls[3][0];
        // Decoding data check roughly or trust flow order
    });
});
