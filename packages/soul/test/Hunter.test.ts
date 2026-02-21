
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '@clawkit/defi-bnb';
import { ClawKitConfig } from '@clawkit/defi-bnb';
import { parseEther } from 'viem';

// Mock dependencies
const mockWalletClient = {
    getAddresses: vi.fn().mockResolvedValue(['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266']),
    sendTransaction: vi.fn().mockResolvedValue('0x7ce087095034a02095f9c1df5c3285741f23594000305417ab4d63339ed9f572')
} as any;

const mockPublicClient = {
    readContract: vi.fn(),
    call: vi.fn(),
    estimateGas: vi.fn(),
    getGasPrice: vi.fn(),
    waitForTransactionReceipt: vi.fn()
} as any;

const mockConfig = {
    chainConfig: {
        contracts: {
            pancakeRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            pancakeQuoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'
        }, // Valid Router/Quoter
        tokens: {
            BNB: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' }, // Valid BNB
            WBNB: { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' }, // Valid WBNB
            USDT: { address: '0x55d398326f99059fF775485246999027B3197955' } // Valid USDT
        }
    }
} as any;

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

describe('DeFiModule: Hunter Upgrade', () => {
    let defi: DeFiModule;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockSecurity = { scanContract: vi.fn().mockResolvedValue({ riskScore: 0 }) } as any;
        defi = new DeFiModule(mockWalletClient, mockPublicClient, mockConfig, mockSecurity);
        // Mock getRealQuote to return a valid amount
        defi.getRealQuote = vi.fn().mockResolvedValue({
            amountOutMin: parseEther('1.0'),
            fee: 2500
        });
        // Mock ensureApproval
        (defi as any).ensureApproval = vi.fn().mockResolvedValue(true);
    });

    it('should ABORT and REVOKE APPROVAL if Gas Cost > 10% (Flash Accounting)', async () => {
        const revokeSpy = vi.spyOn(defi as any, 'revokeApproval').mockResolvedValue(undefined);

        // Setup Thermodynamics Failure
        mockPublicClient.getGasPrice.mockResolvedValue(parseEther('0.000000001'));
        mockPublicClient.estimateGas.mockResolvedValue(200000000n); // 0.2 BNB cost (20%)

        // Use USDT -> BNB to trigger approval logic (BNB -> Token skips approval)
        const params = { from: 'USDT', to: 'BNB', amount: '1.0' };

        await expect(defi.swap(params)).rejects.toThrow(/Thermodynamic Fail/);

        // Verify explicit revoke path was executed.
        expect(revokeSpy).toHaveBeenCalledWith(
            mockConfig.chainConfig.tokens.USDT.address,
            mockConfig.chainConfig.contracts.pancakeRouter
        );
    });

    it('should ALLOW swap if Gas Cost < 10% of Trade Value', async () => {
        // Setup Thermodynamics Success
        // Gas Cost = 0.001 BNB (0.1%)
        mockPublicClient.getGasPrice.mockResolvedValue(parseEther('0.000000001')); // 1 Gwei
        mockPublicClient.estimateGas.mockResolvedValue(1000000n); // 0.001 BNB cost

        const params = { from: 'BNB', to: 'USDT', amount: '1.0', force: true };

        await expect(defi.swap(params)).resolves.toEqual(expect.objectContaining({ hash: '0x7ce087095034a02095f9c1df5c3285741f23594000305417ab4d63339ed9f572' }));
    });

    it('should FAIL swap if Simulation fails (Hunter Eyes)', async () => {
        // Setup Thermodynamics Success
        mockPublicClient.getGasPrice.mockResolvedValue(parseEther('0.000000001'));
        mockPublicClient.estimateGas.mockResolvedValue(1000000n);

        // Setup Simulation Failure
        mockPublicClient.call.mockRejectedValue(new Error('Execution Reverted: Slippage'));

        const params = { from: 'BNB', to: 'USDT', amount: '1.0', force: true };

        await expect(defi.swap(params)).rejects.toThrow(/Simulation failed/);
    });
});
