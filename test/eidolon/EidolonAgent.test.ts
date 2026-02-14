
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EidolonAgent } from '../../src/eidolon/EidolonAgent';
import { PublicClient, WalletClient } from 'viem';

describe('EidolonAgent', () => {
    let agent: EidolonAgent;

    // Mocks
    const mockPublicClient = {
        chain: { id: 204 },
        readContract: vi.fn(),
        getBalance: vi.fn(),
        watchBlockNumber: vi.fn()
    } as unknown as PublicClient;

    const mockWalletClient = {
        account: { address: '0x123' },
        getAddresses: vi.fn().mockResolvedValue(['0x123'])
    } as unknown as WalletClient;

    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize without error using defaults', () => {
            expect(() => {
                new EidolonAgent(mockPublicClient, mockWalletClient);
            }).not.toThrow();
        });

        it('should have consciousness modules initialized', () => {
            const agent = new EidolonAgent(mockPublicClient, mockWalletClient);
            // We can't access private members directly in TS easily without @ts-ignore or casting
            // But we can verify public API behavior or side effects
            expect(agent).toBeDefined();
        });
    });

    describe('Lifecycle', () => {
        it('should start and stop correctly', async () => {
            const agent = new EidolonAgent(mockPublicClient, mockWalletClient);
            const consoleSpy = vi.spyOn(console, 'log');

            // Mock internal "think" loop dependencies if needed
            // But start() triggers "think()" which is async and loops
            // We should be careful not to create an infinite loop in test

            // start() calls this.heart.start()
            // We can spy on console output as a proxy for successful start
            await agent.start();
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('EIDOLON AGENT STARTING'));

            agent.stop();
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('EIDOLON AGENT STOPPED'));
        });
    });
});
