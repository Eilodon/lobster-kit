import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GasModule } from '../src/gas';
import { EidolonConfig, OPBNB_CONFIG, EIDOLON_CONTRACTS } from '../src/types';
import { parseAbi, encodeFunctionData } from 'viem';

// Mock assertDeployed to avoid "not deployed" error
vi.mock('../src/types', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as any,
        assertDeployed: vi.fn().mockReturnValue('0x1234567890123456789012345678901234567890'),
        toAddress: (a: string) => a
    };
});

describe('GasModule', () => {
    let gas: GasModule;
    let mockPublic: any;
    let mockWallet: any; // Declare mockWallet at this scope

    beforeEach(() => {
        vi.resetAllMocks(); // Add this line

        mockPublic = {
            estimateGas: vi.fn(),
            getGasPrice: vi.fn().mockResolvedValue(1000000000n),
            readContract: vi.fn(),
            call: vi.fn().mockResolvedValue('0x'), // Add call mock
            waitForTransactionReceipt: vi.fn().mockResolvedValue({}) // Add waitForTransactionReceipt mock
        };

        const config: EidolonConfig = {
            chainConfig: {
                ...OPBNB_CONFIG,
                contracts: {
                    ...OPBNB_CONFIG.contracts,
                    batchExecutor: '0x1234567890123456789012345678901234567890'
                }
            },
            rpcUrl: 'https://opbnb.rpc.url' // Add rpcUrl
        };

        mockWallet = { // Assign to the outer scope variable
            getAddresses: vi.fn().mockResolvedValue(['0xUser']),
            sendTransaction: vi.fn().mockResolvedValue('0xHash'),
            account: { address: '0xUser' }
        };
        gas = new GasModule(mockWallet as any, mockPublic, config);
    });

    it('should encode batchExecute with correct ABI order (P0-01)', async () => {
        const txs = [
            { to: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', value: 100n, data: '0x1234' },
            { to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', value: 200n, data: '0x5678' }
        ];

        // We can't spy on internal encodeFunctionData directly as it's imported,
        // but we can spy on publicClient.estimateGas and inspect the data passed to it
        mockPublic.estimateGas.mockResolvedValue(50000n);
        // Also mock wallet.getAddresses and sendTransaction since batchExecute calls them
        const mockWallet = {
            getAddresses: vi.fn().mockResolvedValue(['0xUser']),
            sendTransaction: vi.fn().mockResolvedValue('0xHash'),
            account: { address: '0xUser' }
        };
        // Re-inject wallet mock
        gas = new GasModule(mockWallet as any, mockPublic, {
            chainConfig: {
                ...OPBNB_CONFIG,
                contracts: {
                    ...OPBNB_CONFIG.contracts,
                    batchExecutor: '0x1234567890123456789012345678901234567890'
                }
            }
        });

        await gas.batchExecute(txs);

        // It calls estimateGas for each tx (2) + batch tx (1) = 3
        expect(mockPublic.estimateGas).toHaveBeenCalled();

        // Find the batch execution call (it should have data starting with executeBatch selector)
        // executeBatch selector: 0x...
        // We can just check the last call, or filter. Typically batch is last.
        const callArgs = mockPublic.estimateGas.mock.calls[2][0];

        // Decoding the data to verify structure
        // If ABI was wrong (bytes[], uint256[]), decoding with correct ABI would fail/mismatch
        // We manually encode with the CORRECT ABI and compare hex strings

        const targets = txs.map(t => t.to);
        const values = txs.map(t => t.value);
        const datas = txs.map(t => t.data);

        const expectedData = encodeFunctionData({
            abi: parseAbi([
                'function executeBatch(address[] targets, uint256[] values, bytes[] datas)',
                'function executeBatchTolerant(address[] targets, uint256[] values, bytes[] datas)'
            ]),
            functionName: 'executeBatch',
            args: [targets as `0x${string}`[], values, datas as `0x${string}`[]]
        });

        expect(callArgs.data).toBe(expectedData);
    });

    it('should block external price feeds in strict privacy mode without oracle/cache', async () => {
        const strictConfig: EidolonConfig = {
            chainConfig: OPBNB_CONFIG,
            rpcUrl: 'https://opbnb.rpc.url',
            privacyMode: 'strict'
        };
        const strictGas = new GasModule(mockWallet as any, mockPublic, strictConfig);

        await expect(strictGas.getBNBPrice()).rejects.toThrow(/PRIVACY_STRICT_MODE/);
    });
});
