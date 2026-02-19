import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeFiModule } from '../src/defi';
import { ClawOracle } from '../src/eidolon/sensors/ClawOracle';
import { EmotionalCore } from '../src/eidolon/EmotionalCore';
import { parseEther } from 'viem';

// --- MOCKS ---
const mockPublicClient = {
    readContract: vi.fn(),
    call: vi.fn()
};

const mockWalletClient = {
    account: { address: '0x1234567890123456789012345678901234567890' },
    getAddresses: vi.fn().mockResolvedValue(['0x1234567890123456789012345678901234567890'])
};

const mockConfig = {
    chainConfig: {
        contracts: {
            pancakeQuoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
            pancakeRouter: '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86'
        },
        tokens: {
            WBNB: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WBNB' },
            USDT: { address: '0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3', decimals: 6, symbol: 'USDT' }
        },
        pythConfig: {
            priceServiceUrl: 'https://hermes.pyth.network'
        }
    }
};

describe('🦅 EIDOLON-V: The Singularity Upgrade Verification', () => {

    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('⚡ HYPER-ROUTING (Parallel Execution)', () => {
        it('should query ALL fee tiers in parallel and pick the best one', async () => {
            const defi = new DeFiModule(mockWalletClient as any, mockPublicClient as any, mockConfig as any);

            // Mock responses for different fee tiers
            mockPublicClient.readContract.mockImplementation(async (params) => {
                const args = params.args;
                if (!args || !args[0]) return 100n;
                const param = args[0];
                const fee = Number(param.fee);

                if (fee === 2500) return 100n;
                if (fee === 500) return 120n;
                if (fee === 10000) return 80n;
                if (fee === 100) return 0n;
                return 100n;
            });

            // Make sure Promise.all logic works
            // In the implementation, we use Promise.all.
            // We can't verify parallelism strictly here, but we verify 4 calls were made.

            const WBNB = mockConfig.chainConfig.tokens.WBNB.address;
            const USDT = mockConfig.chainConfig.tokens.USDT.address;
            const result = await defi.getRealQuote(WBNB, USDT, 1000n, 0);

            // Expect 4 calls (Hyper-Routing)
            expect(mockPublicClient.readContract).toHaveBeenCalledTimes(4);

            // Expect best result (120n) to be chosen
            expect(result.amountOutMin).toBe(120n);
        });

        it('should sort very large bigint quotes without Number overflow', async () => {
            const defi = new DeFiModule(mockWalletClient as any, mockPublicClient as any, mockConfig as any);
            const huge = 2n ** 255n;

            mockPublicClient.readContract.mockImplementation(async (params) => {
                const fee = Number(params.args[0].fee);
                if (fee === 2500) return huge - 1n;
                if (fee === 500) return huge;
                if (fee === 10000) return huge - 2n;
                return 0n;
            });

            const WBNB = mockConfig.chainConfig.tokens.WBNB.address;
            const USDT = mockConfig.chainConfig.tokens.USDT.address;
            const result = await defi.getRealQuote(WBNB, USDT, 1000n, 0);

            expect(result.amountOutMin).toBe(huge);
            expect(result.fee).toBe(500);
        });
    });

    describe('👁️ OMNISCIENT ORACLE (Liquidity Probing)', () => {
        it('should detect THIN liquidity when slippage is high', async () => {
            // Mock ClawKit context
            const mockKit = {
                config: {
                    pythConfig: { priceServiceUrl: 'https://hermes.pyth.network' }
                },
                defi: {
                    getRealQuote: vi.fn()
                },
                gas: {
                    getOptimalExecutionTime: vi.fn().mockResolvedValue({ currentGasPrice: '0.000005' })
                }
            };

            const oracle = new ClawOracle(mockKit as any);

            // Mock Probe calls:
            // 1. getBNBPrice call (returns 1e18 quote) -> $600
            // 2. Small Probe ($100) -> Returns good price
            // 3. Large Probe ($10k) -> Returns bad price

            mockKit.defi.getRealQuote.mockImplementation(async (tIn, tOut, amount, slip) => {
                const amt = Number(amount);
                // 1. Price Check (1 BNB ~ 1e18) -> 600 USD
                if (amt > 0.9e18 && amt < 1.1e18) return { amountOutMin: 600000000n }; // 600e6
                // 2. Small Probe (~0.16 BNB) -> 100 USD
                if (amt < 0.2e18) return { amountOutMin: 100000000n }; // 100e6
                // 3. Large Probe (~16.6 BNB) -> 9000 USD (Slippage)
                if (amt > 10e18) return { amountOutMin: 9000000000n }; // 9000e6
                return { amountOutMin: 0n };
            });

            const state = await oracle.sense();

            expect(mockKit.defi.getRealQuote).toHaveBeenCalledTimes(3);
            expect(state.liquidityDepth).toBe('THIN');
        });

        it('should return DEEP liquidity when price is stable', async () => {
            const mockKit = {
                config: {
                    pythConfig: { priceServiceUrl: 'https://hermes.pyth.network' }
                },
                defi: { getRealQuote: vi.fn() },
                gas: { getOptimalExecutionTime: vi.fn().mockResolvedValue({ currentGasPrice: '0.000005' }) }
            };
            const oracle = new ClawOracle(mockKit as any);

            mockKit.defi.getRealQuote
                .mockResolvedValueOnce({ amountOutMin: 600000000n })   // Price Check: $600
                .mockResolvedValueOnce({ amountOutMin: 100000000n })   // Small: $100 -> $100
                .mockResolvedValueOnce({ amountOutMin: 10000000000n }); // Large: $10000 -> $10000

            const state = await oracle.sense();
            expect(state.liquidityDepth).toBe('DEEP');
        });

        it('should fail-closed on critical oracle divergence', async () => {
            const mockKit = {
                config: {
                    pythConfig: { priceServiceUrl: 'https://hermes.pyth.network' }
                },
                defi: { getRealQuote: vi.fn() },
                gas: { getOptimalExecutionTime: vi.fn().mockResolvedValue({ currentGasPrice: '0.000005' }) }
            };
            const oracle = new ClawOracle(mockKit as any);
            vi.spyOn((oracle as any).pyth, 'getPrice').mockResolvedValue(600);

            // 1 BNB quote reports only $100 -> >80% divergence
            mockKit.defi.getRealQuote.mockResolvedValue({ amountOutMin: 100000000n });

            await expect(oracle.getBNBPrice()).rejects.toThrow(/SENSORY BLACKOUT/);
        });
    });

    describe('🧠 CAPITAL-AGNOSTIC BRAIN (ROI Rewards)', () => {
        it('dopamine should scale with ROI, not absolute value', () => {
            const brain = new EmotionalCore();
            const initialState = { ...brain['state'] };

            // Scenario 1: $10 profit on $100 capital (10% ROI)
            // Expect +20 Dopamine (ROI * 200)
            brain.stimulate(10, 'PROFIT', 100);
            const dopamineGain1 = brain['state'].dopamine - initialState.dopamine;

            // Reset
            brain['state'] = { ...initialState };

            // Scenario 2: $100 profit on $1000 capital (10% ROI)
            brain.stimulate(100, 'PROFIT', 1000);
            const dopamineGain2 = brain['state'].dopamine - initialState.dopamine;

            // Impacts should be identical because ROI is identical (10%)
            expect(dopamineGain1).toBeCloseTo(dopamineGain2, 1);

            // Check value magnitude (10% ROI -> +20 Dopamine)
            expect(dopamineGain1).toBeCloseTo(20, 0);
        });

        it('should handle legacy calls (no capital provided) safely', () => {
            const brain = new EmotionalCore();
            // Reset dopamine to avoid cap
            brain['state'].dopamine = 0;

            brain.stimulate(100, 'PROFIT'); // Log scaling: log(101)*2 ~ 9.2

            const gain = brain['state'].dopamine;
            expect(gain).toBeGreaterThan(8);
            expect(gain).toBeLessThan(12);
        });
    });
});
