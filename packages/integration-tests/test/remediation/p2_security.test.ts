
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityModule } from '../src/security';

// Mock dependencies
const mockWalletClient: any = {
    getAddresses: vi.fn(),
    sendTransaction: vi.fn().mockResolvedValue('0xHash'),
    getChainId: vi.fn()
};
const mockPublicClient: any = {
    readContract: vi.fn(),
    watchBlockNumber: vi.fn(),
    watchContractEvent: vi.fn(),
    getBytecode: vi.fn()
};
const mockConfig: any = {
    chainConfig: { contracts: {}, tokens: {} }
};

describe('SecurityModule P2 Fixes', () => {
    let security: SecurityModule;

    beforeEach(() => {
        vi.clearAllMocks();
        mockWalletClient.getAddresses.mockResolvedValue(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']);
        security = new SecurityModule(mockWalletClient, mockPublicClient, mockConfig);
    });

    describe('LRU Cache', () => {
        it('should evict oldest item when cache is full', () => {
            (security as any).MAX_CACHE_SIZE = 2;

            const setScan = (security as any).setCachedScan.bind(security);
            const getScan = (security as any).getCachedScan.bind(security);

            // Add A
            setScan('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', { riskScore: 1 });
            // Add B
            setScan('0x4200000000000000000000000000000000000006', { riskScore: 2 });

            expect(getScan('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeTruthy();
            expect(getScan('0x4200000000000000000000000000000000000006')).toBeTruthy();

            // Add C -> Should evict A (oldest)
            setScan('0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86', { riskScore: 3 });

            expect(getScan('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull(); // A gone
            expect(getScan('0x4200000000000000000000000000000000000006')).toBeTruthy(); // B
            expect(getScan('0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86')).toBeTruthy(); // C
        });
    });

    describe('Batch Revoke', () => {
        it('should return all transaction hashes', async () => {
            const tokens = ['0x4200000000000000000000000000000000000006', '0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3'];
            const spenders = ['0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86', '0x556B9306565093C855AEA9AE92A594704c2Cd59e'];

            mockWalletClient.sendTransaction
                .mockResolvedValueOnce('0xHash1')
                .mockResolvedValueOnce('0xHash2');

            const result = await security.batchRevokeApprovals(tokens, spenders);

            expect(result.count).toBe(2);
            expect(result.hashes).toEqual(['0xHash1', '0xHash2']);
        });
    });
});
