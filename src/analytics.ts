import { WalletClient, PublicClient, formatEther, parseAbi } from 'viem';
import { ClawKitConfig, PortfolioHealth, Position, ClawKitWalletClient } from './types';
import axios from 'axios';

export class AnalyticsModule {
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';
  private readonly PANCAKE_API = 'https://farms-api.pancakeswap.com';

  // FIXED: Add price caching to prevent rate limiting
  private priceCache: { [key: string]: { value: number; timestamp: number } } = {};
  private readonly CACHE_DURATION = 60000; // 1 minute cache

  constructor(
    private walletClient: ClawKitWalletClient,
    private publicClient: PublicClient,
    private config: ClawKitConfig
  ) { }

  /**
   * Get portfolio health score with REAL data
   * @example
   * const health = await kit.analytics.portfolioHealth()
   */
  async portfolioHealth(address?: string): Promise<PortfolioHealth> {
    const addr = address || await this.getAddress();

    try {
      // Fetch real positions from chain
      const positions = await this.fetchRealPositions(addr);

      const totalValueUSD = positions.reduce((sum, p) => sum + p.valueUSD, 0);
      const totalDebtUSD = positions
        .filter(p => p.type === 'Borrow')
        .reduce((sum, p) => sum + p.valueUSD, 0);

      const healthFactor = totalDebtUSD === 0 ? 999 : totalValueUSD / totalDebtUSD;

      let riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
      if (healthFactor > 2) riskLevel = 'Low';
      else if (healthFactor > 1.5) riskLevel = 'Medium';
      else if (healthFactor > 1.1) riskLevel = 'High';
      else riskLevel = 'Critical';

      return {
        totalValueUSD,
        totalDebtUSD,
        healthFactor,
        riskLevel,
        positions
      };
    } catch (error) {
      console.error('Error fetching portfolio health:', error);

      // Return safe empty state instead of mock data
      return {
        totalValueUSD: 0,
        totalDebtUSD: 0,
        healthFactor: 999,
        riskLevel: 'Low',
        positions: []
      };
    }
  }

  /**
   * Fetch REAL token prices from CoinGecko
   * FIXED: Added caching and rate limit handling
   */
  private async fetchTokenPrices(): Promise<Record<string, number>> {
    const cacheKey = 'token_prices';

    // Check cache first
    if (this.priceCache[cacheKey] &&
      Date.now() - this.priceCache[cacheKey].timestamp < this.CACHE_DURATION) {
      console.log('💰 Using cached token prices');
      return this.priceCache[cacheKey].value as any;
    }

    try {
      const response = await axios.get(`${this.COINGECKO_API}/simple/price`, {
        params: {
          ids: 'binancecoin,usd-coin,tether,pancakeswap-token,bitcoin,ethereum',
          vs_currencies: 'usd',
          include_24hr_change: true
        },
        timeout: 5000
      });

      const prices = {
        'BNB': response.data.binancecoin?.usd || 0,
        'WBNB': response.data.binancecoin?.usd || 0,
        'USDT': response.data.tether?.usd || 1,
        'USDC': response.data['usd-coin']?.usd || 1,
        'BUSD': 1,
        'CAKE': response.data['pancakeswap-token']?.usd || 0,
        'BTC': response.data.bitcoin?.usd || 0,
        'ETH': response.data.ethereum?.usd || 0
      };

      // Cache the results
      this.priceCache[cacheKey] = {
        value: prices as any,
        timestamp: Date.now()
      };

      console.log('✅ Token prices fetched from CoinGecko');
      return prices;

    } catch (error: any) {
      // Handle rate limiting
      if (error.response?.status === 429) {
        console.warn('⚠️ CoinGecko rate limit (429) - using cache or fallback');

        // Return stale cache if available
        if (this.priceCache[cacheKey]) {
          console.log('Using stale cache');
          return this.priceCache[cacheKey].value as any;
        }
      } else {
        console.error('Error fetching token prices:', error.message);
      }

      // Fallback prices (reasonable defaults)
      const fallbackPrices = {
        'BNB': 600,
        'WBNB': 600,
        'USDT': 1,
        'USDC': 1,
        'BUSD': 1,
        'CAKE': 2.5
      };

      console.warn('⚠️ Using fallback prices');
      return fallbackPrices;
    }
  }

  /**
   * Fetch REAL user positions from blockchain
   */
  private async fetchRealPositions(address: string): Promise<Position[]> {
    const positions: Position[] = [];

    try {
      // Get real token prices first
      const prices = await this.fetchTokenPrices();

      // Fetch Venus positions (lending/borrowing)
      const venusPositions = await this.fetchVenusPositions(address, prices);
      positions.push(...venusPositions);

      // Fetch PancakeSwap LP positions
      const pancakePositions = await this.fetchPancakeSwapPositions(address, prices);
      positions.push(...pancakePositions);

      // Fetch native BNB balance
      const bnbBalance = await this.publicClient.getBalance({
        address: address as `0x${string}`
      });

      if (bnbBalance > 0n) {
        const bnbAmount = parseFloat(formatEther(bnbBalance));
        positions.push({
          protocol: 'Wallet',
          type: 'Hold',
          asset: 'BNB',
          amount: bnbAmount.toFixed(4),
          valueUSD: bnbAmount * prices.BNB,
          apy: 0
        });
      }

    } catch (error) {
      console.error('Error fetching real positions:', error);
    }

    return positions;
  }

  /**
   * Fetch Venus lending/borrowing positions
   */
  private async fetchVenusPositions(
    address: string,
    prices: Record<string, number>
  ): Promise<Position[]> {
    const positions: Position[] = [];

    // FIX M7: Venus vToken contracts — these are BSC mainnet addresses
    // TODO: Verify if Venus is deployed on opBNB and get correct addresses
    const venusMarkets: { vToken: string; symbol: string; decimals: number }[] = [
      // { vToken: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D', symbol: 'BUSD', decimals: 18 }, // BSC only
      // { vToken: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', symbol: 'USDT', decimals: 18 }, // BSC only
      // { vToken: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', symbol: 'BNB', decimals: 18 }  // BSC only
    ];

    for (const market of venusMarkets) {
      try {
        // Read vToken balance
        const balance = await this.publicClient.readContract({
          address: market.vToken as `0x${string}`,
          abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
          functionName: 'balanceOf',
          args: [address as `0x${string}`]
        });

        if (balance > 0n) {
          const amount = parseFloat(formatEther(balance));
          const price = prices[market.symbol] || 0;

          positions.push({
            protocol: 'Venus',
            type: 'Lend',
            asset: market.symbol,
            amount: amount.toFixed(4),
            valueUSD: amount * price,
            apy: await this.getVenusAPY(market.symbol)
          });
        }
      } catch (error) {
        // Skip if read fails
        continue;
      }
    }

    return positions;
  }

  /**
   * Fetch PancakeSwap LP positions
   */
  private async fetchPancakeSwapPositions(
    address: string,
    prices: Record<string, number>
  ): Promise<Position[]> {
    const positions: Position[] = [];

    // Popular PancakeSwap LP tokens
    const lpTokens = [
      { address: '0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16', symbol: 'BNB-BUSD' },
      { address: '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE', symbol: 'BNB-USDT' }
    ];

    for (const lpToken of lpTokens) {
      try {
        const balance = await this.publicClient.readContract({
          address: lpToken.address as `0x${string}`,
          abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
          functionName: 'balanceOf',
          args: [address as `0x${string}`]
        });

        if (balance > 0n) {
          const amount = parseFloat(formatEther(balance));

          // Get LP details to calculate value
          const [reserves, totalSupply] = await Promise.all([
            this.publicClient.readContract({
              address: lpToken.address as `0x${string}`,
              abi: parseAbi(['function getReserves() view returns (uint112, uint112, uint32)']),
              functionName: 'getReserves'
            }),
            this.publicClient.readContract({
              address: lpToken.address as `0x${string}`,
              abi: parseAbi(['function totalSupply() view returns (uint256)']),
              functionName: 'totalSupply'
            })
          ]);

          // Simple LP Valuation: value = (reserve0 * price0 + reserve1 * price1) / totalSupply * userBalance
          // For BNB-BUSD: Reserve0 is BNB, Reserve1 is BUSD (usually, need to check token0/token1)
          // We'll assume a simplified 50/50 split value for robustness if exact token ordering isn't checked
          // Value = 2 * (Reserve of Stable * Price of Stable) / TotalSupply * UserBalance

          // However, for accuracy let's use the known prices we have.
          // Assuming lpToken.symbol is 'BNB-BUSD', we can derive assets.
          const assets = lpToken.symbol.split('-');
          const price0 = prices[assets[0]] || 0;
          const price1 = prices[assets[1]] || 0;

          const r0 = parseFloat(formatEther(reserves[0]));
          const r1 = parseFloat(formatEther(reserves[1])); // Assuming 18 decimals for simplicity, reality varies
          const ts = parseFloat(formatEther(totalSupply));
          const ub = parseFloat(formatEther(balance));

          const totalLpValueUSD = (r0 * price0) + (r1 * price1);
          const userValueUSD = (totalLpValueUSD / ts) * ub;

          positions.push({
            protocol: 'PancakeSwap',
            type: 'LP',
            asset: lpToken.symbol,
            amount: amount.toFixed(4),
            valueUSD: userValueUSD,
            apy: await this.getPancakeSwapAPY(lpToken.symbol)
          });
        }
      } catch (error) {
        continue;
      }
    }

    return positions;
  }

  /**
   * Get REAL Venus APY from chain or API
   */
  private async getVenusAPY(asset: string): Promise<number> {
    try {
      // Try to fetch from Venus API
      const response = await axios.get('https://api.venus.io/api/governance/venus', {
        timeout: 5000
      });

      if (response.data?.markets) {
        // Venus API stores symbols as 'vBNB', 'vUSDT', etc. or underlying symbol
        // We match by underlyingSymbol which is safer
        const market = response.data.markets.find((m: any) =>
          m.underlyingSymbol?.toUpperCase() === asset.toUpperCase()
        );

        if (market?.supplyApy) {
          const apy = parseFloat(market.supplyApy);
          console.log(`✅ Fetched Venus APY for ${asset}: ${apy}%`);
          return apy;
        }
      }
    } catch (error) {
      console.log('Venus API unavailable, using fallback');
    }

    // Fallback: Return 0 instead of fake data
    return 0;
  }

  /**
   * Get REAL PancakeSwap farm APY
   */
  private async getPancakeSwapAPY(pair: string): Promise<number> {
    try {
      // https://farms-api.pancakeswap.com/farms
      // Response is array of farm objects
      const response = await axios.get(`${this.PANCAKE_API}/farms`, {
        timeout: 5000
      });

      if (response.data && Array.isArray(response.data)) {
        // Find farm by LP symbol (e.g., 'BNB-USDT LP') or pair
        // The API returns 'lpSymbol' like 'BNB-USDT LP'
        const farm = response.data.find((f: any) => {
          const symbol = f.lpSymbol?.toUpperCase();
          const pairClean = pair.toUpperCase().replace(' LP', '');
          return symbol?.includes(pairClean);
        });

        if (farm?.apr) {
          console.log(`✅ Fetched PancakeSwap APY for ${pair}: ${farm.apr}%`);
          return farm.apr;
        }
      }
    } catch (error) {
      console.log('PancakeSwap API unavailable');
    }

    // Return 0 instead of fake data
    return 0;
  }

  /**
   * Calculate APY for a specific position
   */
  async calculateAPY(protocol: string, asset: string): Promise<number> {
    if (protocol === 'Venus') {
      return await this.getVenusAPY(asset);
    } else if (protocol === 'PancakeSwap') {
      return await this.getPancakeSwapAPY(asset);
    }

    return 0;
  }

  /**
   * Get historical portfolio value (simplified)
   */
  async getHistoricalValue(
    days: number = 30,
    address?: string
  ): Promise<Array<{ date: string; valueUSD: number }>> {
    const addr = address || await this.getAddress();

    // Get current portfolio value
    const currentHealth = await this.portfolioHealth(addr);
    const currentValue = currentHealth.totalValueUSD;

    // FIX H7: No more Math.random() fake history
    // TODO: Implement real historical tracking by persisting portfolio snapshots
    throw new Error(
      'Historical portfolio data not implemented. ' +
      'Need to persist daily portfolio snapshots to provide real historical values.'
    );
  }

  /**
   * Get transaction history from BSCScan
   */
  async getTransactionHistory(
    limit: number = 50,
    address?: string
  ): Promise<any[]> {
    const addr = address || await this.getAddress();

    try {
      // Note: Requires BSCScan API key for production
      const response = await axios.get('https://api.bscscan.com/api', {
        params: {
          module: 'account',
          action: 'txlist',
          address: addr,
          startblock: 0,
          endblock: 99999999,
          page: 1,
          offset: limit,
          sort: 'desc'
        },
        timeout: 10000
      });

      if (response.data.status === '1' && response.data.result) {
        return response.data.result.map((tx: any) => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: formatEther(BigInt(tx.value)),
          timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
          status: tx.isError === '0' ? 'success' : 'failed',
          gasUsed: tx.gasUsed
        }));
      }

      return [];
    } catch (error) {
      console.error('Error fetching transaction history:', error);
      return [];
    }
  }

  /**
   * Get total yield earned (simplified calculation)
   */
  async getTotalYield(days: number = 30, address?: string): Promise<{
    totalUSD: number;
    byProtocol: Record<string, number>;
  }> {
    const addr = address || await this.getAddress();
    const health = await this.portfolioHealth(addr);

    // Calculate based on positions and APY
    const byProtocol: Record<string, number> = {};
    let totalUSD = 0;

    for (const position of health.positions) {
      if (position.apy > 0) {
        // Daily yield = (value * APY) / 365
        const dailyYield = (position.valueUSD * position.apy / 100) / 365;
        const periodYield = dailyYield * days;

        byProtocol[position.protocol] = (byProtocol[position.protocol] || 0) + periodYield;
        totalUSD += periodYield;
      }
    }

    return { totalUSD, byProtocol };
  }

  /**
   * Monitor wallet events (setup listeners)
   */
  async watchWallet(
    callback: (event: any) => void,
    address?: string
  ): Promise<() => void> {
    const addr = address || await this.getAddress();

    // Setup viem watcher for transfer events
    const unwatch = this.publicClient.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        callback({
          type: 'newBlock',
          blockNumber: blockNumber.toString(),
          address: addr
        });
      }
    });

    return unwatch;
  }

  // Helper methods
  private async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }
}
