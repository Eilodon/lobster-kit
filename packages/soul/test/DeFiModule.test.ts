import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '@clawkit/defi-bnb';
import { ClawKitConfig, OPBNB_CONFIG, resolveTokenAddress } from '@clawkit/defi-bnb';

describe('DeFiModule', () => {
    let defi: DeFiModule;
    let mockWallet: any;
    let mockPublic: any;

    const MOCK_USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Valid address

    beforeEach(() => {
        mockWallet = {
            getAddresses: vi.fn().mockResolvedValue([MOCK_USER]),
            sendTransaction: vi.fn().mockResolvedValue('0xHash'),
            writeContract: vi.fn().mockResolvedValue('0xApproveHash'),
            account: { address: MOCK_USER }
        };
        mockPublic = {
            call: vi.fn().mockResolvedValue('0x'),
            estimateGas: vi.fn().mockResolvedValue(100000n),
            getGasPrice: vi.fn().mockResolvedValue(1000000000n),
            readContract: vi.fn().mockResolvedValue(1000000000000000000n),
            simulateContract: vi.fn().mockResolvedValue({ request: {} }),
            waitForTransactionReceipt: vi.fn().mockResolvedValue({}),
        };

        const config: ClawKitConfig = {
            chainConfig: OPBNB_CONFIG
        };

        const mockSecurity = {
            scanContract: vi.fn().mockResolvedValue({ riskScore: 0 })
        } as any;

        defi = new DeFiModule(mockWallet, mockPublic, config, mockSecurity);

        // Mock getRealQuote to avoid external calls
        vi.spyOn(defi, 'getRealQuote').mockResolvedValue({
            amountOutMin: 900000000000000000n, // 0.9
            fee: 2500
        });
    });

    describe('Swap Safety', () => {
        it('should simulate transaction before sending', async () => {
            await defi.swap({
                from: 'BNB',
                to: 'USDT',
                amount: '1.0',
                amountUSD: 100
            });

            // 1. Thermodynamics check (estimateGas)
            // 2. Simulation (call)
            expect(mockPublic.call).toHaveBeenCalled();
            expect(mockWallet.sendTransaction).toHaveBeenCalled();

            // Verify call/simulation uses executeBatch (P0-02)
            const callArgs = mockPublic.call.mock.lastCall[0];
            // We expect the data to be encoded for executeBatch
            expect(callArgs.data).toBeDefined();
        });

        it('should ABORT validation if simulation fails', async () => {
            mockPublic.call.mockRejectedValue(new Error('Simulation Reverted'));

            await expect(defi.swap({
                from: 'BNB',
                to: 'USDT',
                amount: '1.0',
                amountUSD: 100
            })).rejects.toThrow('Simulation Reverted');

            expect(mockWallet.sendTransaction).not.toHaveBeenCalled();
        });

        it('should use EXACT approval mode when configured', async () => {
            mockPublic.readContract.mockResolvedValueOnce(0n); // allowance
            mockPublic.estimateGas.mockResolvedValue(1n);
            mockPublic.getGasPrice.mockResolvedValue(1n);
            const config: ClawKitConfig = {
                chainConfig: OPBNB_CONFIG,
                approvalMode: 'EXACT'
            };
            const mockSecurity = {
                scanContract: vi.fn().mockResolvedValue({ riskScore: 0 })
            } as any;
            const exactDefi = new DeFiModule(mockWallet, mockPublic, config, mockSecurity);
            vi.spyOn(exactDefi, 'getRealQuote').mockResolvedValue({
                amountOutMin: 900000n,
                fee: 2500
            });

            await exactDefi.swap({
                from: 'USDT',
                to: 'WBNB',
                amount: '1',
                amountUSD: 100,
                force: true
            });

            const approveCall = mockPublic.simulateContract.mock.calls[0][0];
            expect(approveCall.args[1]).toBe(1000000n); // 1 USDT (6 decimals)
        });

        it('should revoke approval if swap execution fails after approval', async () => {
            mockPublic.readContract.mockResolvedValueOnce(0n); // allowance
            mockPublic.estimateGas.mockResolvedValue(1n);
            mockPublic.getGasPrice.mockResolvedValue(1n);
            mockWallet.sendTransaction
                .mockRejectedValueOnce(new Error('send failed'))
                .mockResolvedValueOnce('0xRevoke');

            await expect(defi.swap({
                from: 'USDT',
                to: 'WBNB',
                amount: '1',
                amountUSD: 100
            })).rejects.toThrow('send failed');

            // 1st: swap send fails, 2nd: revoke approval attempt
            expect(mockWallet.sendTransaction).toHaveBeenCalledTimes(2);
        });
    });

    describe('Token Resolution (Types)', () => {
        it('should resolve known properties correctly', () => {
            // BNB -> Address
            const bnbAddr = resolveTokenAddress('BNB');
            expect(bnbAddr).toBe(OPBNB_CONFIG.tokens.BNB.address);

            // Address -> Address
            const randomAddr = '0x1234567890123456789012345678901234567890';
            expect(resolveTokenAddress(randomAddr)).toBe(randomAddr);
        });
    });
});
