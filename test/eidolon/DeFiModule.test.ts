import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '../../src/defi';
import { ClawKitConfig, OPBNB_CONFIG, resolveTokenAddress } from '../../src/types';

describe('DeFiModule', () => {
    let defi: DeFiModule;
    let mockWallet: any;
    let mockPublic: any;

    const MOCK_USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Valid address

    beforeEach(() => {
        mockWallet = {
            getAddresses: vi.fn().mockResolvedValue([MOCK_USER]),
            sendTransaction: vi.fn().mockResolvedValue('0xHash')
        };
        mockPublic = {
            call: vi.fn().mockResolvedValue('0x'),
            estimateGas: vi.fn().mockResolvedValue(100000n),
            getGasPrice: vi.fn().mockResolvedValue(1000000000n),
            readContract: vi.fn().mockResolvedValue(1000000000000000000n),
            waitForTransactionReceipt: vi.fn().mockResolvedValue({}),
        };

        const config: ClawKitConfig = {
            chainConfig: OPBNB_CONFIG
        };

        defi = new DeFiModule(mockWallet, mockPublic, config);

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
                amount: '1.0'
            });

            // 1. Thermodynamics check (estimateGas)
            // 2. Simulation (call)
            expect(mockPublic.call).toHaveBeenCalled();
            expect(mockWallet.sendTransaction).toHaveBeenCalled();
        });

        it('should ABORT validation if simulation fails', async () => {
            mockPublic.call.mockRejectedValue(new Error('Simulation Reverted'));

            await expect(defi.swap({
                from: 'BNB',
                to: 'USDT',
                amount: '1.0'
            })).rejects.toThrow('Simulation Reverted');

            expect(mockWallet.sendTransaction).not.toHaveBeenCalled();
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
