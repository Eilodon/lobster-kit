
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClawKit } from '../src/index';

// Mock dependencies
const mockWalletClient: any = {
    getAddresses: vi.fn(),
    getChainId: vi.fn()
};
const mockConfig: any = {
    rpcUrl: 'http://localhost',
    chainConfig: {
        tokens: {},
        contracts: {}
    }
};

const mockStart = vi.fn();
vi.mock('@clawkit/soul', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        MarketStream: vi.fn().mockImplementation(() => ({
            on: vi.fn(),
            start: mockStart
        })),
        EidolonSwarm: vi.fn()
    };
});

// Mock modules to avoid complex init
vi.mock('../src/defi', () => ({ DeFiModule: vi.fn().mockReturnValue({ setPriceOracle: vi.fn() }) }));
vi.mock('../src/nft', () => ({ NFTModule: vi.fn() }));
vi.mock('@clawkit/defi-bnb', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        SecurityModule: vi.fn(),
        WalletModule: vi.fn(),
        GasModule: vi.fn()
    };
});
vi.mock('../src/analytics', () => ({ AnalyticsModule: vi.fn() }));

describe('ClawKit Usage P1 Fixes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Privacy Guard', () => {
        it('should NOT start market stream in strict privacy mode', () => {
            new ClawKit(mockWalletClient, { ...mockConfig, privacyMode: 'strict' });
            expect(mockStart).not.toHaveBeenCalled();
        });

        it('should start market stream in normal mode', () => {
            new ClawKit(mockWalletClient, { ...mockConfig, privacyMode: 'balanced' });
            expect(mockStart).toHaveBeenCalled();
        });
    });
});
