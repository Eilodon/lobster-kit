import { describe, it, expect, vi } from 'vitest';
import { SecurityModule } from '../src/security';

const validAddr = (n: number) => `0x${n.toString().padStart(40, '0')}` as `0x${string}`;

const config: any = {
    chainConfig: {
        contracts: {
            pancakeRouter: validAddr(10),
            batchExecutor: validAddr(20),
            approvalRevoker: validAddr(30),
        },
        tokens: {
            BNB: { address: validAddr(100), symbol: 'BNB', decimals: 18 },
            USDT: { address: validAddr(101), symbol: 'USDT', decimals: 6 },
        }
    }
};

// Create fresh mocks per test to avoid call-count accumulation
function makeMocks() {
    const mockWalletClient: any = {
        getAddresses: vi.fn().mockResolvedValue([validAddr(1)]),
    };
    const mockPublicClient: any = {
        watchBlockNumber: vi.fn().mockReturnValue(() => { }),
        watchContractEvent: vi.fn().mockReturnValue(() => { }),
    };
    return { mockWalletClient, mockPublicClient };
}

describe('SecurityModule P3 - Expanded Monitoring', () => {
    it('should watch config tokens by default', async () => {
        const { mockWalletClient, mockPublicClient } = makeMocks();
        const sec = new SecurityModule(mockWalletClient, mockPublicClient, config);
        const unwatch = await sec.monitorSuspiciousActivity(() => { });

        const callArgs = mockPublicClient.watchContractEvent.mock.calls[0][0];
        expect(callArgs.address).toContain(validAddr(100)); // BNB token
        expect(callArgs.address).toContain(validAddr(101)); // USDT token

        unwatch();
    });

    it('should include additional tokens when provided', async () => {
        const { mockWalletClient, mockPublicClient } = makeMocks();
        const sec = new SecurityModule(mockWalletClient, mockPublicClient, config);
        const extraToken = validAddr(999);

        const unwatch = await sec.monitorSuspiciousActivity(() => { }, [extraToken]);

        const callArgs = mockPublicClient.watchContractEvent.mock.calls[0][0];
        expect(callArgs.address).toContain(extraToken);     // Extra token included
        expect(callArgs.address).toContain(validAddr(100)); // BNB still there

        unwatch();
    });

    it('should deduplicate tokens in the watch list', async () => {
        const { mockWalletClient, mockPublicClient } = makeMocks();
        const sec = new SecurityModule(mockWalletClient, mockPublicClient, config);
        // Pass BNB address as "additional" — should not appear twice
        const unwatch = await sec.monitorSuspiciousActivity(() => { }, [validAddr(100)]);

        const callArgs = mockPublicClient.watchContractEvent.mock.calls[0][0];
        const occurrences = (callArgs.address as string[]).filter(a => a === validAddr(100)).length;
        expect(occurrences).toBe(1);

        unwatch();
    });
});
