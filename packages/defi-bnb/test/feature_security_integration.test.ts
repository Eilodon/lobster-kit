import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '../src/defi';
import { TOKENS } from '../src/types';

// Mock dependencies
const mockPublicClient = {
    readContract: vi.fn(),
    getGasPrice: vi.fn(),
    estimateGas: vi.fn(),
    call: vi.fn(),
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
            pancakeRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            pancakeQuoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'
        },
        tokens: {
            ...TOKENS,
            BNB: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, symbol: 'BNB' },
            WBNB: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WBNB' },
            USDT: { address: '0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3', decimals: 18, symbol: 'USDT' },
            MALICIOUS: { address: '0x1111111111111111111111111111111111111111', decimals: 18, symbol: 'MALICIOUS' },
            SAFE: { address: '0x2222222222222222222222222222222222222222', decimals: 18, symbol: 'SAFE' }
        }
    }
} as any;

const MALICIOUS_TOKEN = '0x1111111111111111111111111111111111111111';
const SAFE_TOKEN = '0x2222222222222222222222222222222222222222';

// Mock PriceService
vi.mock('../src/services/PriceService', () => {
    const mockPriceService = {
        getBNBPrice: vi.fn().mockResolvedValue(600),
        getTokenPriceByAddress: vi.fn().mockResolvedValue(1), // Mock price to avoid impact check errors
        fetchTokenPrices: vi.fn().mockResolvedValue({ BNB: 300 })
    };
    return {
        getPriceService: () => mockPriceService
    };
});

describe('Feature: Security Integration (Immune System)', () => {
    let defi: DeFiModule;
    let mockSecurity: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSecurity = {
            scanContract: vi.fn()
        };
        mockSecurity = {
            scanContract: vi.fn()
        };
        defi = new DeFiModule(mockWalletClient, mockPublicClient, mockConfig, mockSecurity);

        // Mock getRealQuote to avoid external calls and "No Pool" error
        vi.spyOn(defi, 'getRealQuote').mockResolvedValue({
            amountOutMin: 1000000000000000000n, // 1.0 (assuming 18 decimals - Equal value to input)
            fee: 500,
            gasEstimate: 100000n
        });
    });

    it('should BLOCK swap if target token has High Risk Score', async () => {
        // Setup: Security reports HIGH RISK
        mockSecurity.scanContract.mockResolvedValue({
            riskScore: 90,
            isHoneypot: true
        });

        const params = {
            from: 'BNB',
            to: MALICIOUS_TOKEN,
            amount: '1.0',
            amountUSD: 100
        };

        await expect(defi.swap(params)).rejects.toThrow(/Security Guard: High Risk Detected/);
        expect(mockSecurity.scanContract).toHaveBeenCalledWith(MALICIOUS_TOKEN);
    });

    it('should ALLOW swap if target token is SAFE', async () => {
        // Setup: Security reports LOW RISK
        mockSecurity.scanContract.mockResolvedValue({
            riskScore: 10,
            isHoneypot: false
        });

        // Mock remaining swap logic to proceed
        // 1. Decimals
        mockPublicClient.readContract.mockResolvedValue(18);
        // 2. Gas
        mockPublicClient.estimateGas.mockResolvedValue(21000n);
        mockPublicClient.getGasPrice.mockResolvedValue(1000000000n);
        // 3. Sim
        mockPublicClient.call.mockResolvedValue('0x');
        // 4. Send
        mockWalletClient.sendTransaction.mockResolvedValue('0xTxHash');

        const params = {
            from: 'BNB',
            to: SAFE_TOKEN,
            amount: '1.0',
            amountUSD: 100
        };

        const result = await defi.swap(params);
        expect(result.hash).toBe('0xTxHash');
        expect(mockSecurity.scanContract).toHaveBeenCalled();
    });

    it('should BYPASS security check if force: true is used', async () => {
        // Setup: Security reports HIGH RISK
        mockSecurity.scanContract.mockResolvedValue({
            riskScore: 99,
            isHoneypot: true
        });

        // Mock remaining swap logic
        mockPublicClient.readContract.mockResolvedValue(18);
        mockPublicClient.estimateGas.mockResolvedValue(21000n);
        mockPublicClient.getGasPrice.mockResolvedValue(1000000000n);
        mockPublicClient.call.mockResolvedValue('0x');
        mockWalletClient.sendTransaction.mockResolvedValue('0xTxHash');

        const params = {
            from: 'BNB',
            to: MALICIOUS_TOKEN,
            amount: '1.0',
            amountUSD: 100,
            force: true // <--- OVERRIDE
        };

        const result = await defi.swap(params);
        expect(result.hash).toBe('0xTxHash');

        // Expected behavior: scanContract might NOT be called, or called but ignored.
        // Implementation: if (force !== true) { scan... }
        // So scanContract shoud NOT be called.
        expect(mockSecurity.scanContract).not.toHaveBeenCalled();
    });

    it('should NOT scan trusted tokens (BNB/WBNB/USDT)', async () => {
        // Trust list in implementation: BNB, WBNB, USDT.
        // Let's assume TOKENS are set up correctly in default config or mock.
        // defi.tokens uses mockConfig.chainConfig.tokens.

        // Trust list is implicitly checked via this.tokens which comes from config
        // defined at top of file.

        // Mock remaining swap logic
        mockPublicClient.readContract.mockResolvedValue(18);
        mockPublicClient.estimateGas.mockResolvedValue(21000n);
        mockPublicClient.getGasPrice.mockResolvedValue(1000000000n);
        mockPublicClient.call.mockResolvedValue('0x');
        mockWalletClient.sendTransaction.mockResolvedValue('0xTxHash');

        const params = {
            from: 'USDT',
            to: '0x4200000000000000000000000000000000000006', // WBNB
            amount: '1.0',
            amountUSD: 100
        };

        await defi.swap(params);
        expect(mockSecurity.scanContract).not.toHaveBeenCalled();
    });
});
