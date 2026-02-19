import { PublicClient, formatEther, formatUnits, parseAbi } from 'viem';
import { ClawKitConfig, PortfolioHealth, Position, ClawKitWalletClient, getTokenDecimals, resolveTokenAddress } from './types';
import axios from 'axios';
import { getGateway } from './utils/ApiGateway';
import { ERC20_BALANCE_OF_ABI } from './abi/erc20';
import * as fs from 'fs';
import * as path from 'path';

interface HistoryTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: string;
  status: 'success' | 'failed';
  gasUsed: string;
}

export class AnalyticsModule {
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';
  private readonly PANCAKE_API = 'https://farms-api.pancakeswap.com';

  // FIXED: Add price caching to prevent rate limiting
  private priceCache: { [key: string]: { value: unknown; timestamp: number } } = {};
  private readonly CACHE_DURATION = 60000; // 1 minute cache
  private static readonly HISTORY_FILE = path.resolve(process.cwd(), '.clawkit', 'portfolio_history.json');
  private static readonly MAX_HISTORY_ENTRIES = 365;

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

      // FIX P4-F5: Persist snapshot on successful portfolio health check
      this.persistSnapshot(totalValueUSD);

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
  public async fetchTokenPrices(): Promise<Record<string, number>> {

    const cacheKey = 'token_prices';

    // Check cache first
    if (this.priceCache[cacheKey] &&
      Date.now() - this.priceCache[cacheKey].timestamp < this.CACHE_DURATION) {
      return this.priceCache[cacheKey].value as Record<string, number>;
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
        value: prices,
        timestamp: Date.now()
      };

      return prices;

    } catch (error: unknown) {
      const status = (typeof error === 'object' && error !== null && 'response' in error)
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
      // Handle rate limiting
      if (status === 429) {
        console.warn('⚠️ CoinGecko rate limit (429) - using cache or fallback');

        // Return stale cache if available
        if (this.priceCache[cacheKey]) {
          console.warn('Using stale cache');
          return this.priceCache[cacheKey].value as Record<string, number>;
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Error fetching token prices:', message);
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
      // FIX: Return the defined fallback prices instead of hardcoded 0s
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
    // TODO: Verify if Venus is deployed on opBNB and get correct addresses or switch to Kinza
    // Venus logic disabled for opBNB safety
    const venusMarkets: { vToken: string; symbol: string; decimals: number }[] = [
      // { vToken: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D', symbol: 'BUSD', decimals: 18 }, // BSC Mainnet!
      // { vToken: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', symbol: 'USDT', decimals: 18 },
      // { vToken: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', symbol: 'BNB', decimals: 18 }
    ];

    for (const market of venusMarkets) {
      try {
        // Read vToken balance
        const balance = await this.publicClient.readContract({
          address: market.vToken as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
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
      } catch {
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
    // Popular PancakeSwap LP tokens
    // FIX H1: These were BSC Mainnet addresses. opBNB addresses needed.
    // Use empty list or fetch from factory for now to avoid calling wrong contracts.
    const lpTokens: { address: string; symbol: string }[] = [
      // { address: '...', symbol: 'BNB-USDT' } // TODO: Add opBNB LP addresses
    ];

    for (const lpToken of lpTokens) {
      try {
        const balance = await this.publicClient.readContract({
          address: lpToken.address as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
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

          // FIX P1-03: Query on-chain token0/token1 to correctly map reserves
          const assets = lpToken.symbol.split('-');
          const labelToken0Symbol = assets[0];
          const labelToken1Symbol = assets[1];

          // Get actual on-chain token0 address to determine reserve ordering
          const token0Address = await this.publicClient.readContract({
            address: lpToken.address as `0x${string}`,
            abi: parseAbi(['function token0() view returns (address)']),
            functionName: 'token0'
          }) as `0x${string}`;

          // Resolve expected token addresses
          const labelToken0Address = resolveTokenAddress(labelToken0Symbol);
          const isCorrectOrder = token0Address.toLowerCase() === labelToken0Address?.toLowerCase();

          const actualToken0 = isCorrectOrder ? labelToken0Symbol : labelToken1Symbol;
          const actualToken1 = isCorrectOrder ? labelToken1Symbol : labelToken0Symbol;

          const price0 = prices[actualToken0] || 0;
          const price1 = prices[actualToken1] || 0;

          // FIX Bug #4: Dynamic Decimals for LP Valuation
          const r0 = parseFloat(formatUnits(reserves[0], getTokenDecimals(actualToken0)));
          const r1 = parseFloat(formatUnits(reserves[1], getTokenDecimals(actualToken1)));
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
      } catch {
        continue;
      }
    }

    // P3: Try PancakeSwap V3 Subgraph for real positions if LP list is empty
    // This replaces the need for hardcoded LP addresses
    try {
      const subgraphPositions = await this.fetchSubgraphPositions(address, prices);
      positions.push(...subgraphPositions);
    } catch (subgraphErr: unknown) {
      const message = subgraphErr instanceof Error ? subgraphErr.message : String(subgraphErr);
      console.warn('[Analytics] Subgraph fetch failed, relying on on-chain data only:', message);
    }

    return positions;
  }

  /**
   * P3: Fetch LP positions from PancakeSwap V3 Subgraph (The Graph API)
   * Replaces hardcoded LP address lists — subgraph returns positions dynamically.
   */
  private async fetchSubgraphPositions(
    address: string,
    prices: Record<string, number>
  ): Promise<Position[]> {
    // PancakeSwap V3 opBNB subgraph endpoint
    const SUBGRAPH_URL = 'https://gateway.thegraph.com/api/subgraphs/id/Fj2fBvSdUNLivFmkbaNr8tnFpW3LajMBNBgQCQyVjxSA';

    const query = `{
      positions(where: { owner: "${address.toLowerCase()}", liquidity_gt: "0" }, first: 20) {
        id
        liquidity
        token0 { symbol decimals }
        token1 { symbol decimals }
        depositedToken0
        depositedToken1
        withdrawnToken0
        withdrawnToken1
        pool { feeTier totalValueLockedUSD }
      }
    }`;

    const data = await getGateway(this.config).post<{
      data: { positions: unknown[] }
    }>(SUBGRAPH_URL, { query });

    const rawPositions = data?.data?.positions ?? [];
    return rawPositions.map((p) => {
      const raw = (p && typeof p === 'object') ? p as Record<string, unknown> : {};
      const token0 = (raw.token0 as { symbol?: string } | undefined)?.symbol ?? 'UNKNOWN';
      const token1 = (raw.token1 as { symbol?: string } | undefined)?.symbol ?? 'UNKNOWN';
      const dep0 = parseFloat(String(raw.depositedToken0 ?? '0')) - parseFloat(String(raw.withdrawnToken0 ?? '0'));
      const dep1 = parseFloat(String(raw.depositedToken1 ?? '0')) - parseFloat(String(raw.withdrawnToken1 ?? '0'));
      const p0 = prices[token0] || 0;
      const p1 = prices[token1] || 0;
      const valueUSD = dep0 * p0 + dep1 * p1;
      return {
        protocol: 'PancakeSwap V3',
        type: 'LP' as const,
        asset: `${token0}/${token1}`,
        amount: `${dep0.toFixed(4)} ${token0} + ${dep1.toFixed(4)} ${token1}`,
        valueUSD,
        apy: 0 // Subgraph doesn't return APY directly — use pool TVL for estimation
      };
    });
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
        const market = response.data.markets.find((m: unknown) =>
          (m && typeof m === 'object' && 'underlyingSymbol' in m)
            ? String((m as { underlyingSymbol?: unknown }).underlyingSymbol ?? '').toUpperCase() === asset.toUpperCase()
            : false
        );

        if (market && typeof market === 'object' && 'supplyApy' in market) {
          const apy = parseFloat(String((market as { supplyApy?: unknown }).supplyApy ?? '0'));
          return apy;
        }
      }
    } catch {
      console.warn('Venus API unavailable, using fallback');
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
        const farm = response.data.find((f: unknown) => {
          const symbol = (f && typeof f === 'object' && 'lpSymbol' in f)
            ? String((f as { lpSymbol?: unknown }).lpSymbol ?? '').toUpperCase()
            : '';
          const pairClean = pair.toUpperCase().replace(' LP', '');
          return symbol?.includes(pairClean);
        });

        if (farm && typeof farm === 'object' && 'apr' in farm) {
          return Number((farm as { apr?: unknown }).apr ?? 0);
        }
      }
    } catch {
      console.warn('PancakeSwap API unavailable');
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
    days: number = 30
  ): Promise<Array<{ date: string; valueUSD: number }>> {
    // FIX P4-F5: Read from persisted snapshot file instead of returning empty
    try {
      if (!fs.existsSync(AnalyticsModule.HISTORY_FILE)) return [];
      const raw = fs.readFileSync(AnalyticsModule.HISTORY_FILE, 'utf-8');
      const history: Array<{ date: string; valueUSD: number }> = JSON.parse(raw);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return history.filter(h => new Date(h.date) >= cutoff);
    } catch {
      return [];
    }
  }

  /**
   * P4-F5: Persist a portfolio snapshot to disk
   */
  public persistSnapshot(valueUSD: number): void {
    try {
      const dir = path.dirname(AnalyticsModule.HISTORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let history: Array<{ date: string; valueUSD: number }> = [];
      if (fs.existsSync(AnalyticsModule.HISTORY_FILE)) {
        try {
          history = JSON.parse(fs.readFileSync(AnalyticsModule.HISTORY_FILE, 'utf-8'));
        } catch { history = []; }
      }

      history.push({ date: new Date().toISOString(), valueUSD });

      // Cap at MAX_HISTORY_ENTRIES
      if (history.length > AnalyticsModule.MAX_HISTORY_ENTRIES) {
        history = history.slice(-AnalyticsModule.MAX_HISTORY_ENTRIES);
      }

      fs.writeFileSync(AnalyticsModule.HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
      console.warn('[Analytics] Failed to persist snapshot:', e);
    }
  }

  /**
   * Get transaction history from BSCScan
   */
  async getTransactionHistory(
    limit: number = 50,
    address?: string
  ): Promise<HistoryTx[]> {
    const addr = address || await this.getAddress();

    try {
      // Note: Requires BSCScan API key for production
      // FIX Bug #10: Target opBNB scan API
      const response = await axios.get('https://api-opbnb.bscscan.com/api', {
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
        return response.data.result.map((tx: Record<string, unknown>) => ({
          hash: String(tx.hash ?? ''),
          from: String(tx.from ?? ''),
          to: String(tx.to ?? ''),
          value: formatEther(BigInt(String(tx.value ?? '0'))),
          timestamp: new Date(parseInt(String(tx.timeStamp ?? '0'), 10) * 1000).toISOString(),
          status: String(tx.isError ?? '1') === '0' ? 'success' : 'failed',
          gasUsed: String(tx.gasUsed ?? '')
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
    callback: (event: Record<string, unknown>) => void,
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
