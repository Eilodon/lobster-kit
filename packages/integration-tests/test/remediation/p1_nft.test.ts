
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NFTModule } from '../src/nft';

// Mock viem clients
const mockWalletClient: any = {
    sendTransaction: vi.fn().mockResolvedValue('0xhash')
};
const mockPublicClient: any = {
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn()
};
const mockConfig: any = {
    chainConfig: { contracts: {} }
};

// Mock assertDeployed
vi.mock('../src/types', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as any),
        assertDeployed: vi.fn().mockReturnValue('0xContract'),
        EIDOLON_CONTRACTS: { DynamicBadge: '0xContract' },
        toAddress: (a: string) => a
    };
});


describe('NFTModule P1 Fixes', () => {
    let nft: NFTModule;

    beforeEach(() => {
        vi.clearAllMocks();
        nft = new NFTModule(mockWalletClient, mockPublicClient, mockConfig);
    });

    describe('mintBatch Log Parsing', () => {
        it('should extract tokenIds from Transfer logs', async () => {
            // Mock receipt with logs
            // Topic0: Transfer
            // Topic1: 0x0 (from)
            // Topic2: User (to)
            // Topic3: TokenID
            const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
            const fromTopic = '0x0000000000000000000000000000000000000000000000000000000000000000'; // 0x0
            // Valid address: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
            const validUser = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
            const paddedUser = '0x000000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

            mockPublicClient.waitForTransactionReceipt.mockResolvedValue({
                logs: [
                    {
                        topics: [
                            transferTopic,
                            fromTopic,
                            paddedUser,
                            '0x000000000000000000000000000000000000000000000000000000000000002A' // 42
                        ]
                    },
                    {
                        topics: [
                            transferTopic,
                            fromTopic,
                            paddedUser,
                            '0x000000000000000000000000000000000000000000000000000000000000002B' // 43
                        ]
                    }
                ]
            });

            const result = await nft.mintBatch([
                { name: 'Test', to: validUser },
                { name: 'Test2', to: validUser }
            ]);

            expect(result.tokenIds).toEqual(['42', '43']);
            // Should NOT call getNextTokenId (readContract)
            expect(mockPublicClient.readContract).not.toHaveBeenCalled();
        });

        it('should fallback to prediction if logs missing', async () => {
            mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ logs: [] });
            mockPublicClient.readContract.mockResolvedValue(100n); // Next ID 100
            const validUser = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

            const result = await nft.mintBatch([{ name: 'Test', to: validUser }]);

            // getNextTokenId() returns totalSupply + 1, then fallback predicts minted IDs
            // as (nextTokenId - count + i). With totalSupply mocked at 100 -> next=101 -> 100.
            expect(result.tokenIds).toEqual(['100']);
        });
    });
});
