import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityModule } from '../src/security';
import { ClawKitConfig, OPBNB_CONFIG, CLAWKIT_CONTRACTS } from '../src/types';
import { parseAbi, encodeFunctionData } from 'viem';
import { computeConfigHash } from '../src/utils/ConfigIntegrity';

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

    it('🛡️ SPINAL REFLEX: batchRevokeApprovals should call approve(0) directly on each token (P0-03)', async () => {
        const tokens = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'];
        const spenders = ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', '0x90F79bf6EB2c4f870365E785982E1f101E93b906'];

        const result = await security.batchRevokeApprovals(tokens, spenders);

        // New behavior: exactly N direct sendTransaction calls (one per token)
        // No external registry contract involved
        expect(mockWallet.sendTransaction).toHaveBeenCalledTimes(2);

        // 1st call: approve(spender[0], 0) on token[0]
        const call1 = mockWallet.sendTransaction.mock.calls[0][0];
        expect(call1.to.toLowerCase()).toBe(tokens[0].toLowerCase());

        // 2nd call: approve(spender[1], 0) on token[1]
        const call2 = mockWallet.sendTransaction.mock.calls[1][0];
        expect(call2.to.toLowerCase()).toBe(tokens[1].toLowerCase());

        // No readContract calls (no registry lookup needed)
        expect(mockPublic.readContract).not.toHaveBeenCalled();

        // Returns correct count
        expect(result.count).toBe(2);
        expect(result.hash).toBe('0xHash');
    });

    it('should fail fast on config checksum mismatch when strict integrity is enabled', () => {
        const baseConfig: ClawKitConfig = {
            chainConfig: OPBNB_CONFIG,
            rpcUrl: 'https://opbnb.rpc.url',
        };
        const tamperedConfig: ClawKitConfig = {
            ...baseConfig,
            configIntegrity: {
                expectedHash: 'deadbeef',
                strict: true
            }
        };

        expect(() => new SecurityModule(mockWallet as any, mockPublic as any, tamperedConfig)).toThrow(/CHECKSUM MISMATCH/);
    });

    it('should allow boot when config checksum matches', () => {
        const baseConfig: ClawKitConfig = {
            chainConfig: OPBNB_CONFIG,
            rpcUrl: 'https://opbnb.rpc.url',
            configIntegrity: {
                expectedHash: '',
                strict: true
            }
        };
        baseConfig.configIntegrity!.expectedHash = computeConfigHash(baseConfig);

        expect(() => new SecurityModule(mockWallet as any, mockPublic as any, baseConfig)).not.toThrow();
    });
});
