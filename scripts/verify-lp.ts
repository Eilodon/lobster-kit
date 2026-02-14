
import { AnalyticsModule } from '../src/analytics';
import { formatEther } from 'viem';

// Mock config
const MOCK_ADDR = '0x1234567890123456789012345678901234567890';

// Mock Public Client
const mockPublicClient = {
    readContract: async (args: any) => {
        // console.log('Mock readContract:', args.functionName);
        if (args.functionName === 'getReserves') {
            // Reserve0: 10 BNB (18 dec), Reserve1: 6000 USDT (18 dec for simplicity in this mock)
            // Note: In real USDT it is 6 decimals, but let's assume 18 for this simple math check
            // or consistent with the code's assumption if it assumes 18.
            return [BigInt('10000000000000000000'), BigInt('6000000000000000000000'), 0];
        }
        if (args.functionName === 'totalSupply') {
            return BigInt('100000000000000000000'); // 100 LP Total
        }
        if (args.functionName === 'balanceOf') {
            return BigInt('10000000000000000000'); // User has 10 LP (10%)
        }
        return BigInt(0);
    },
    getBalance: async () => BigInt('1000000000000000000'), // 1 BNB
    multicall: async () => []
} as any;

// Mock Coingecko (to avoid API calls)
const mockCoingecko = {
    simple: {
        price: () => ({
            binancecoin: { usd: 600 },
            tether: { usd: 1 }
        })
    }
} as any;

// Mock Wallet Client
const mockWalletClient = {
    getAddresses: async () => [MOCK_ADDR]
} as any;

async function main() {
    console.log('🔍 Verifying AnalyticsModule LP Valuation...');

    // Fix: Correct constructor arguments (walletClient, publicClient, config)
    const analytics = new AnalyticsModule(mockWalletClient, mockPublicClient, {} as any);

    // Inject mock Coingecko to avoid real API calls
    (analytics as any).coingecko = mockCoingecko;

    // Mock list of tokens to include an LP token
    // Use private property access for testing
    (analytics as any).priceCache = {
        'token_prices': {
            value: {
                'BNB': 600,
                'USDT': 1
            },
            timestamp: Date.now()
        }
    };

    try {
        console.log('1. Fetching Portfolio Health...');
        // Fix: Correct method name is portfolioHealth
        const health = await analytics.portfolioHealth(MOCK_ADDR);

        console.log('✅ Portfolio computed.');

        const lpPosition = health.positions.find(p => p.asset === 'BNB-USDT');

        if (!lpPosition) {
            throw new Error('❌ LP Position not found in portfolio!');
        }

        console.log('2. Verifying LP Value...');
        // Expected: 
        // Reserves: 10 BNB ($6000) + 6000 USDT ($6000) = $12,000 TVL
        // User Share: 10 / 100 = 10%
        // Expected Value: $1,200

        console.log(`   LP Value USD: $${lpPosition.valueUSD}`);

        if (Math.abs(lpPosition.valueUSD - 1200) < 1) {
            console.log('✅ LP Valuation Logic matches expectation ($1200)!');
        } else {
            console.error(`❌ LP Valuation Mismatch. Expected ~$1200, got $${lpPosition.valueUSD}`);
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Verification Failed:', error);
        process.exit(1);
    }
}

main();
