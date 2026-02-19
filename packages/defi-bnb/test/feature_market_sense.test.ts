import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '../src/defi';
import { TOKENS } from '../src/types';

// Mock Dependencies
const mockPublicClient = {
    readContract: vi.fn(),
    getGasPrice: vi.fn(),
    estimateGas: vi.fn(),
    call: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    simulateContract: vi.fn().mockResolvedValue({ request: {} }),
} as any;

const VALID_USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const mockWalletClient = {
    getAddresses: vi.fn().mockResolvedValue([VALID_USER]),
    sendTransaction: vi.fn(),
    writeContract: vi.fn(),
    account: { address: VALID_USER }
} as any;

const mockConfig = {
    chainConfig: {
        contracts: {
            pancakeRouter: '0xRouter',
            pancakeQuoter: '0xQuoter'
        },
        tokens: {
            ...TOKENS,
            BNB: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, symbol: 'BNB' },
            USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, symbol: 'USDT' }
        }
    }
} as any;

const mockSecurity = {
    scanContract: vi.fn().mockResolvedValue({ riskScore: 0 })
} as any;

// Mock PriceService
const mockPriceService = {
    getTokenPriceByAddress: vi.fn(),
    getBNBPrice: vi.fn().mockResolvedValue(300),
};

vi.mock('../src/services/PriceService', () => ({
    getPriceService: () => mockPriceService
}));

describe('Feature: Market Sense (Price Impact)', () => {
    let defi: DeFiModule;

    beforeEach(() => {
        vi.clearAllMocks();
        defi = new DeFiModule(mockWalletClient, mockPublicClient, mockConfig, mockSecurity);

        // Mock internal methods to isolate Price Impact check
        vi.spyOn(defi as any, 'getDynamicTokenDecimals').mockResolvedValue(18);
        vi.spyOn(defi as any, 'checkThermodynamics').mockResolvedValue(undefined);
        vi.spyOn(defi as any, 'simulateTransaction').mockResolvedValue(undefined); // Bypass sim
        vi.spyOn(defi as any, 'getRealQuote').mockResolvedValue({
            amountOutMin: 9000000000000000000n, // 9.0 tokens
            fee: 500,
            gasEstimate: 100000n
        });
    });

    it('should BLOCK swap if Price Impact is > 10%', async () => {
        // Scenario: Swapping 1 BNB ($300) for USDT.
        // Market Price: BNB=$300, USDT=$1.
        // Quote returns: 100 USDT ($100).
        // Loss: ($300 - $100) / $300 = 66% > 10% -> BLOCK.

        mockPriceService.getTokenPriceByAddress.mockImplementation(async (addr) => {
            if (addr === mockConfig.chainConfig.tokens.BNB.address) return 300;
            if (addr === mockConfig.chainConfig.tokens.USDT.address) return 1;
            return 0;
        });

        // Quote returns 100 USDT (mocked above is 9.0, let's override for this test)
        vi.spyOn(defi as any, 'getRealQuote').mockResolvedValue({
            amountOutMin: 100000000000000000000n, // 100 USDT (18 decimals mocked)
            fee: 500,
            gasEstimate: 100000n
        });

        const params = {
            from: 'BNB',
            to: 'USDT',
            amount: '1.0', // 1 BNB
        };

        await expect(defi.swap(params)).rejects.toThrow(/Price Impact Too High/);
    });

    it('should ALLOW swap if Price Impact is SAFE (< 10%)', async () => {
        // Scenario: Swapping 1 BNB ($300) for USDT.
        // Quote returns: 290 USDT ($290).
        // Loss: ($300 - $290) / $300 = 3.3% < 10% -> ALLOW.

        mockPriceService.getTokenPriceByAddress.mockImplementation(async (addr) => {
            if (addr === mockConfig.chainConfig.tokens.BNB.address) return 300;
            if (addr === mockConfig.chainConfig.tokens.USDT.address) return 1;
            return 0;
        });

        vi.spyOn(defi as any, 'getRealQuote').mockResolvedValue({
            amountOutMin: 290000000000000000000n, // 290 USDT
            fee: 500,
            gasEstimate: 100000n
        });

        // Mock sendTransaction to verify success
        mockWalletClient.sendTransaction.mockResolvedValue('0xTxHash');

        const params = {
            from: 'BNB',
            to: 'USDT',
            amount: '1.0',
        };

        const result = await defi.swap(params);
        expect(result.hash).toBe('0xTxHash');
    });

    it('should BYPASS check if force: true is used', async () => {
        // High impact scenario but force is true
        mockPriceService.getTokenPriceByAddress.mockImplementation(async (addr) => {
            if (addr === mockConfig.chainConfig.tokens.BNB.address) return 300;
            if (addr === mockConfig.chainConfig.tokens.USDT.address) return 1;
            return 0;
        });

        vi.spyOn(defi as any, 'getRealQuote').mockResolvedValue({
            amountOutMin: 100000000000000000000n, // 100 USDT (High Impact)
            fee: 500,
            gasEstimate: 100000n
        });

        mockWalletClient.sendTransaction.mockResolvedValue('0xTxHash');

        const params = {
            from: 'BNB',
            to: 'USDT',
            amount: '1.0',
            force: true // FORCE
        };

        const result = await defi.swap(params);
        expect(result.hash).toBe('0xTxHash');
    });
});
