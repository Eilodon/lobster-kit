import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClawKit } from '../src/index';
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { opBNB } from 'viem/chains';
import { OPBNB_CONFIG } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
const { mockPublicClient } = vi.hoisted(() => {
    return {
        mockPublicClient: {
            readContract: vi.fn(),
            getBalance: vi.fn().mockResolvedValue(0n),
            multicall: vi.fn(),
            waitForTransactionReceipt: vi.fn(),
            call: vi.fn(),
            watchBlockNumber: vi.fn().mockReturnValue(() => { }),
            extend: vi.fn().mockReturnThis()
        }
    };
});

// Mock Viem createPublicClient
vi.mock('viem', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        createPublicClient: vi.fn().mockReturnValue(mockPublicClient)
    };
});
// Mock MarketStream
vi.mock('../src/eidolon/sensors/MarketStream', () => ({
    MarketStream: class {
        on() { }
        start() { }
        stop() { }
    }
}));

// Mock EidolonSwarm
vi.mock('../src/eidolon/swarm/EidolonSwarm', () => ({
    EidolonSwarm: class {
        join() { }
        leave() { }
    }
}));



// Mock Axios
vi.mock('axios', () => ({
    default: {
        get: vi.fn().mockResolvedValue({ data: {} })
    }
}));

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Valid address

const mockWalletClient = {
    account: { address: TEST_ADDRESS },
    writeContract: vi.fn().mockResolvedValue('0xHash'),
    sendTransaction: vi.fn().mockResolvedValue('0xHash'),
    getAddresses: vi.fn().mockResolvedValue([TEST_ADDRESS])
};

describe('Audit Remediation Integration', () => {
    let kit: ClawKit;
    const historyFile = path.resolve(process.cwd(), '.clawkit', 'portfolio_history.json');

    beforeEach(() => {
        vi.clearAllMocks();
        try {
            if (fs.existsSync(historyFile)) {
                fs.unlinkSync(historyFile);
            }
        } catch {
            // best-effort cleanup for deterministic tests
        }

        // Setup ClawKit with mocks
        kit = new ClawKit(mockWalletClient as any, {
            rpcUrl: 'https://opbnb.rpc',
            chainConfig: OPBNB_CONFIG,
            privacyMode: 'strict'
        });
        (kit as any).publicClient = mockPublicClient;
    });

    describe('1. Analytics Module (OpBNB Safety)', () => {
        it('should NOT crash when fetching portfolio health on opBNB (Venus Disabled)', async () => {
            // Mock token price fetch to return safe zeros/defaults
            // We can't easily mock private fetchTokenPrices, but we can verify portfolioHealth returns result
            const health = await kit.analytics.portfolioHealth(TEST_ADDRESS);

            expect(health).toBeDefined();
            expect(health.riskLevel).toBe('Low'); // Default safe state
            // Should not have any Venus positions because we disabled them
            const venusPositions = health.positions.filter(p => p.protocol === 'Venus');
            expect(venusPositions.length).toBe(0);
        });

        it('should return empty array for historical value instead of throwing', async () => {
            const history = await kit.analytics.getHistoricalValue(30);
            expect(history).toEqual([]);
        });
    });

    describe('2. Gas Module (Emergency Oxygen)', () => {
        it('should throw explicit ASPHYXIATION error if strict mode and no cache', async () => {
            await expect(kit.gas.getBNBPrice()).rejects.toThrow('PRIVACY_STRICT_MODE');
        });

        it('should use stale cache in strict mode if available (Oxygen)', async () => {
            // Inject cache manually
            (kit.gas as any).priceCache = { value: 600, timestamp: Date.now() - 100000 };

            const price = await kit.gas.getBNBPrice();
            expect(price).toBe(600);
        });
    });

    describe('3. DeFi Module (Panic Button)', () => {
        it('should dump all positions in emergency', async () => {
            // Mock balances: 10 CAKE
            mockPublicClient.readContract.mockResolvedValueOnce(parseEther('10')); // CAKE Balance

            // Mock Swap
            const swapSpy = vi.spyOn(kit.defi, 'swap').mockResolvedValue({ hash: '0xPanicHash', amountOut: '100' });

            const results = await kit.defi.dumpAllPositions();

            expect(results.length).toBeGreaterThan(0);
            // Iteration order usually puts USDC first or unpredictable, but mockResolvedValueOnce gave balance to the first token
            expect(results[0]).toContain('Sold');
            expect(swapSpy).toHaveBeenCalledWith(expect.objectContaining({
                to: 'USDT',
                slippage: 10,
                emergencyMode: true
            }));
        });
    });
});
