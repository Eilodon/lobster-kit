
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsModule } from '../../src/analytics';
import { PublicClient, WalletClient, parseEther } from 'viem';
import axios from 'axios';

vi.mock('axios');

describe('AnalyticsModule', () => {
    let analytics: AnalyticsModule;

    const mockPublicClient = {
        readContract: vi.fn(),
        getBalance: vi.fn()
    } as unknown as PublicClient;

    const mockWalletClient = {
        getAddresses: vi.fn().mockResolvedValue(['0xUser']),
        account: { address: '0xUser', type: 'local' }
    } as unknown as WalletClient;

    const mockConfig = {};

    beforeEach(() => {
        vi.resetAllMocks();
        analytics = new AnalyticsModule(mockWalletClient as any, mockPublicClient, mockConfig);

        // Mock CoinGecko response defaults
        (axios.get as any).mockResolvedValue({
            data: {
                binancecoin: { usd: 600 },
                'pancakeswap-token': { usd: 5 },
                tether: { usd: 1 }
            }
        });
    });

    it('should calculate LP value correctly', async () => {
        // Mock BNB Balance
        (mockPublicClient.getBalance as any).mockResolvedValue(parseEther('1.0')); // 1 BNB

        // Mock Contract Calls for LP
        (mockPublicClient.readContract as any).mockImplementation((args: any) => {
            // Mock balanceOf for LP Token (user has 10 LP)
            if (args.functionName === 'balanceOf' && args.address.includes('0xLP')) {
                return parseEther('10');
            }
            // Mock getReserves (10 BNB + 6000 USDT)
            if (args.functionName === 'getReserves') {
                return [parseEther('10'), 6000000000n, 0]; // 6000 USDT (6 decimals)
            }
            // Mock totalSupply (100 LP Total)
            if (args.functionName === 'totalSupply') {
                return parseEther('100');
            }
            return BigInt(0);
        });

        // Inject token list manually since it's private/hardcoded in class usually
        // We will override the private fetchPancakeSwapPositions logic via `fetchRealPositions` test
        // But `fetchPancakeSwapPositions` uses hardcoded `lpTokens`.
        // To properly test without modifying code, we need to mock the `readContract` to match the HARDCODED address in `analytics.ts`.
        // Address in code: 0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16 (BNB-BUSD)
        // or 0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE (BNB-USDT)

        // Let's match BNB-USDT address
        const LP_ADDR = '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE';

        // Override mock implementation to be specific
        (mockPublicClient.readContract as any).mockImplementation((args: any) => {
            if (args.address === LP_ADDR) {
                if (args.functionName === 'balanceOf') return parseEther('10');
                if (args.functionName === 'getReserves') return [parseEther('10'), 6000000000n, 0]; // 6000 USDT (6 dec)
                if (args.functionName === 'totalSupply') return parseEther('100');
                if (args.functionName === 'token0') return '0x0000000000000000000000000000000000000000'; // BNB is token0
            }
            return BigInt(0);
        });

        const health = await analytics.portfolioHealth('0xUser');

        // Expected Logic:
        // Price BNB = $600
        // Price USDT = $1
        // Reserves = 10 * 600 + 6000 * 1 = $12,000 TVL
        // User Share = 10 / 100 = 10%
        // Value = $1,200

        const lpPos = health.positions.find(p => p.asset === 'BNB-USDT');
        expect(lpPos).toBeDefined();
        // Allow small float variance
        expect(lpPos?.valueUSD).toBeCloseTo(1200, 0);
    });

    it('should handle reversed token order for LP valuation (P1-03)', async () => {
        // Mock BNB Balance
        (mockPublicClient.getBalance as any).mockResolvedValue(parseEther('1.0'));

        const LP_ADDR = '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE';
        const USDT_ADDR = '0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3'; // Confirmed USDT addr in OPBNB_CONFIG

        (mockPublicClient.readContract as any).mockImplementation((args: any) => {
            if (args.address === LP_ADDR) {
                // Return reversed token0: USDT is token0 now!
                if (args.functionName === 'token0') return USDT_ADDR;

                // Return reversed reserves: [6000 USDT (6 dec), 10 BNB (18 dec)]
                // Note: parseEther("6000") creates 18 decimals, so for USDT (6 decimals) we need 6000 * 10^6
                if (args.functionName === 'getReserves') return [6000000000n, parseEther('10'), 0];

                if (args.functionName === 'totalSupply') return parseEther('100');
                if (args.functionName === 'balanceOf') return parseEther('10');
            }
            return BigInt(0);
        });

        const health = await analytics.portfolioHealth('0xUser');
        const lpPos = health.positions.find(p => p.asset === 'BNB-USDT');

        // Should still be ~1200 USD
        expect(lpPos?.valueUSD).toBeCloseTo(1200, 0);
    });

    it('should handle API failures gracefully', async () => {
        // Mock API failure
        (axios.get as any).mockRejectedValue(new Error('Network Error'));

        // Should fallback to default values ($600 BNB)
        const health = await analytics.portfolioHealth('0xUser');

        // Even with failure, it should return a valid object, not crash
        expect(health).toBeDefined();
        expect(health.riskLevel).toBeDefined();
    });
});
