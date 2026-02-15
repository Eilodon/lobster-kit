import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EidolonSimulator } from '../../src/eidolon/simulation/EidolonSimulator';
import { ClawKit } from '../../src/index';

// Mock viem public client
const mockClient = {
    call: vi.fn(),
    estimateGas: vi.fn()
};

const mockKit = {
    publicClient: mockClient
} as any as ClawKit;

describe('EidolonSimulator (Shadow Clones)', () => {
    let simulator: EidolonSimulator;

    beforeEach(() => {
        simulator = new EidolonSimulator(mockKit);
        vi.clearAllMocks();
    });

    it('should return success if gas estimation works', async () => {
        mockClient.call.mockResolvedValue({ data: '0x' });
        mockClient.estimateGas.mockResolvedValue(21000n);

        const result = await simulator.simulate({
            to: '0x123',
            data: '0x',
            account: '0xUser'
        });

        expect(result.success).toBe(true);
        expect(result.gasUsed).toBe(21000n);
    });

    it('should return failure if gas estimation reverts', async () => {
        mockClient.call.mockRejectedValue(new Error('Execution reverted'));
        // Or if call succeeds but estimateGas fails
        mockClient.estimateGas.mockRejectedValue(new Error('Gas estimation failed'));

        const result = await simulator.simulate({
            to: '0x123',
            data: '0x',
            account: '0xUser'
        });

        expect(result.success).toBe(false);
        expect(result.revertReason).toContain('Execution reverted');
    });
});
