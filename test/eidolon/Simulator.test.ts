import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EidolonSimulator, ShadowTransaction } from '../../src/eidolon/simulation/EidolonSimulator';
import { ClawKit } from '../../src/index';

// Mock ClawKit and PublicClient
const mockCall = vi.fn();
const mockEstimateGas = vi.fn();
const mockCreateAccessList = vi.fn();

const mockKit = {
    publicClient: {
        call: mockCall,
        estimateGas: mockEstimateGas,
        createAccessList: mockCreateAccessList
    }
} as any as ClawKit;

describe('EidolonSimulator: Hardening Body', () => {
    let simulator: EidolonSimulator;

    beforeEach(() => {
        vi.clearAllMocks();
        simulator = new EidolonSimulator(mockKit);
    });

    it('should NOT auto-fund account (Secure Default)', async () => {
        const tx = {
            to: '0xTarget',
            data: '0xData',
            value: 100n,
            account: '0xSender'
        };
        const mockCall = vi.spyOn((simulator as any).client, 'call').mockResolvedValue({ data: '0x' });
        const mockEst = vi.spyOn((simulator as any).client, 'estimateGas').mockResolvedValue(21000n);

        await simulator.simulate(tx);

        // Verify stateOverride is NOT injected (Secure Default)
        expect(mockCall).toHaveBeenCalledWith(expect.objectContaining({
            stateOverride: undefined
        }));
    });

    it('should respect USER-DEFINED overrides', async () => {
        const tx: ShadowTransaction = {
            to: '0xTarget',
            data: '0xData',
            value: 100n,
            account: '0xSender',
            stateOverride: { '0xSender': { balance: 500n } }
        };

        mockCall.mockResolvedValue({ data: '0xResult' });
        mockEstimateGas.mockResolvedValue(21000n);

        await simulator.simulate(tx);

        // Verify custom override was preserved
        expect(mockCall).toHaveBeenCalledWith(expect.objectContaining({
            stateOverride: { '0xSender': { balance: 500n } }
        }));
    });

    it('should Detect Blast Radius (Footprint) via Access List', async () => {
        const tx: ShadowTransaction = {
            to: '0xTarget',
            data: '0xData',
            value: 0n,
            account: '0xSender'
        };

        mockCall.mockResolvedValue({ data: '0x' });
        mockEstimateGas.mockResolvedValue(21000n);
        mockCreateAccessList.mockResolvedValue({
            accessList: [
                { address: '0xContractA', storageKeys: [] },
                { address: '0xContractB', storageKeys: [] }
            ]
        });

        const result = await simulator.simulate(tx);

        expect(result.touchedAddresses).toEqual(['0xContractA', '0xContractB']);
        expect(mockCreateAccessList).toHaveBeenCalled();
    });

    it('should Handle Access List Failure gracefully', async () => {
        const tx: ShadowTransaction = {
            to: '0xTarget',
            data: '0xData',
            account: '0xSender'
        };

        mockCall.mockResolvedValue({ data: '0x' });
        mockEstimateGas.mockResolvedValue(21000n);
        mockCreateAccessList.mockRejectedValue(new Error('Not Supported'));

        const result = await simulator.simulate(tx);

        // Should still succeed simulation even if footprint scan fails
        expect(result.success).toBe(true);
        expect(result.touchedAddresses).toEqual([]);
    });

    it('should produce risk matrix with worst-case gas projection', async () => {
        const tx: ShadowTransaction = {
            to: '0xTarget',
            data: '0xData',
            account: '0xSender'
        };

        mockCall.mockResolvedValue({ data: '0x' });
        mockEstimateGas.mockResolvedValue(100000n);
        mockCreateAccessList.mockResolvedValue({
            accessList: [{ address: '0xContractA', storageKeys: [] }]
        });

        const matrix = await simulator.simulateRiskMatrix(tx);

        expect(matrix.allPassed).toBe(true);
        expect(matrix.base.success).toBe(true);
        expect(matrix.footprint.touchedCount).toBe(1);
        expect(matrix.gasWorstCase.estimatedGas).toBe(130000n); // +30% buffer
    });
});
