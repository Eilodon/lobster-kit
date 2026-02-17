import { WalletClient, PublicClient, encodeFunctionData, parseAbi, formatEther, parseEther } from 'viem';
import { ClawKitConfig, BATCH_EXECUTOR, ClawKitWalletClient, toAddress, assertDeployed } from './types';
import axios from 'axios';

interface GasEstimate {
  gasPrice: string;
  gasLimit: string;
  totalCostBNB: string;
  totalCostUSD: string;
}

interface Transaction {
  to: string;
  data: string;
  value?: bigint;
}

export class GasModule {
  // ⚠️ FIXED: Chainlink NOT available on opBNB L2
  // Using API-based price feeds with caching
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';
  private readonly BINANCE_API = 'https://api.binance.com/api/v3';

  // Price cache to reduce API calls and handle rate limits
  private priceCache: { value: number; timestamp: number } | null = null;
  private readonly CACHE_DURATION = 60000; // 1 minute cache

  constructor(
    private walletClient: ClawKitWalletClient,
    private publicClient: PublicClient,
    private config: ClawKitConfig,
    private oracle?: any // Loosely typed to avoid circular import hell, or use Interface
  ) { }

  /**
   * Inject Oracle for GHOST Protocol (Privacy)
   */
  public setOracle(oracle: any) {
    this.oracle = oracle;
  }

  /**
   * Get REAL BNB price from multiple sources with caching
   * FIXED: Removed Chainlink (not available on opBNB)
   * Added: Caching, multiple fallbacks, rate limit handling
   */
  async getBNBPrice(): Promise<number> {
    // 👻 GHOST PROTOCOL: Use Internal Oracle if available
    // Does not leak IP to CoinGecko/Binance
    if (this.oracle) {
      try {
        const price = await this.oracle.getBNBPrice();
        this.priceCache = { value: price, timestamp: Date.now() };
        return price;
      } catch (e) {
        console.warn('⚠️ Internal Oracle failed, falling back to cached or external (Not recommended for Ghost Mode)');
      }
    }

    // Check cache first (prevents rate limiting)
    if (this.priceCache && Date.now() - this.priceCache.timestamp < this.CACHE_DURATION) {
      console.log(`💰 Using cached BNB price: $${this.priceCache.value.toFixed(2)}`);
      return this.priceCache.value;
    }

    // ... (Legacy External APIs omitted/kept as fallback if strictly needed, but we prefer Oracle)
    // For GHOST compliance, we should ideally REMOVE them, but for robustness we keep them as last resort
    // wrapped in a "Privacy Warning"

    // Try CoinGecko first (Privacy Leak!)
    try {
      const response = await axios.get(`${this.COINGECKO_API}/simple/price`, {
        params: {
          ids: 'binancecoin',
          vs_currencies: 'usd'
        },
        timeout: 5000
      });

      const price = response.data?.binancecoin?.usd;
      if (price && price > 0) {
        this.priceCache = { value: price, timestamp: Date.now() };
        console.log(`✅ BNB price from CoinGecko: $${price.toFixed(2)}`);
        return price;
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.warn('⚠️ CoinGecko rate limit hit (429)');

        // Return stale cache if available
        if (this.priceCache) {
          console.log(`Using stale cache: $${this.priceCache.value.toFixed(2)}`);
          return this.priceCache.value;
        }
      } else {
        console.error('CoinGecko error:', error.message);
      }
    }

    // Fallback to Binance API (more reliable, higher limits)
    try {
      const response = await axios.get(`${this.BINANCE_API}/ticker/price`, {
        params: { symbol: 'BNBUSDT' },
        timeout: 5000
      });

      const price = parseFloat(response.data.price);
      if (price > 0) {
        this.priceCache = { value: price, timestamp: Date.now() };
        console.log(`✅ BNB price from Binance: $${price.toFixed(2)}`);
        return price;
      }
    } catch (error: any) {
      console.error('Binance API error:', error.message);
    }

    // Last resort: Use stale cached value
    if (this.priceCache) {
      console.warn(`⚠️ All APIs failed, using stale cached price: $${this.priceCache.value.toFixed(2)}`);
      return this.priceCache.value;
    }

    // CRITICAL: NO FALLBACK
    console.error('❌ All APIs failed to fetch BNB price. Aborting gas estimation in USD.');
    throw new Error('SENSORY BLACKOUT: Cannot estimate gas in USD without price feed.');
  }

  /**
   * Estimate gas for a transaction with REAL prices
   * @example
   * const estimate = await kit.gas.estimateGas({ to: '0x...', data: '0x...' })
   */
  async estimateGas(transaction: Transaction): Promise<GasEstimate> {
    try {
      // Get current gas price
      const gasPrice = await this.publicClient.getGasPrice();

      // Estimate gas limit
      const gasLimit = await this.publicClient.estimateGas({
        account: await this.getAddress() as `0x${string}`,
        to: transaction.to as `0x${string}`,
        data: transaction.data as `0x${string}`,
        value: transaction.value || 0n
      });

      // Calculate total cost in BNB
      const totalCostWei = gasPrice * gasLimit;
      const totalCostBNB = formatEther(totalCostWei);

      // Get real BNB price
      const bnbPriceUSD = await this.getBNBPrice();
      const totalCostUSD = parseFloat(totalCostBNB) * bnbPriceUSD;

      return {
        gasPrice: formatEther(gasPrice),
        gasLimit: gasLimit.toString(),
        totalCostBNB: totalCostBNB,
        totalCostUSD: totalCostUSD.toFixed(2)
      };

    } catch (error) {
      console.error('Error estimating gas:', error);
      throw new Error('Failed to estimate gas. Check transaction parameters.');
    }
  }

  /**
   * Execute multiple transactions in a single batch
   * Saves gas compared to separate transactions
   * @example
   * await kit.gas.batchExecute([tx1, tx2, tx3])
   */
  async batchExecute(
    transactions: Transaction[],
    tolerant: boolean = false
  ): Promise<{ hash: string; savings: string }> {
    if (transactions.length === 0) {
      throw new Error('No transactions to batch');
    }

    try {
      // Estimate gas for individual transactions
      let individualGasCost = 0n;
      for (const tx of transactions) {
        const estimate = await this.publicClient.estimateGas({
          account: await this.getAddress() as `0x${string}`,
          to: tx.to as `0x${string}`,
          data: tx.data as `0x${string}`,
          value: tx.value || 0n
        });
        individualGasCost += estimate;
      }

      // Prepare batch call
      const targets = transactions.map(tx => tx.to as `0x${string}`);
      const datas = transactions.map(tx => tx.data as `0x${string}`);
      const values = transactions.map(tx => tx.value || 0n);

      const functionName = tolerant ? 'executeBatchTolerant' : 'executeBatch';

      const data = encodeFunctionData({
        abi: parseAbi([
          'function executeBatch(address[] targets, bytes[] datas, uint256[] values)',
          'function executeBatchTolerant(address[] targets, bytes[] datas, uint256[] values)'
        ]),
        functionName: functionName,
        args: [targets, datas, values]
      });

      // Estimate batched gas
      assertDeployed('BatchExecutor');

      const batchGasCost = await this.publicClient.estimateGas({
        account: await this.getAddress() as `0x${string}`,
        to: toAddress(BATCH_EXECUTOR),
        data: data,
        value: values.reduce((sum, v) => sum + v, 0n)
      });

      // Calculate savings
      const savings = individualGasCost - batchGasCost;
      const savingsPercent = Number(savings * 100n / individualGasCost);

      console.log(`💰 Gas savings: ${savingsPercent.toFixed(1)}%`);

      // Execute batch
      const hash = await this.walletClient.sendTransaction({
        to: toAddress(BATCH_EXECUTOR),
        data: data,
        value: values.reduce((sum, v) => sum + v, 0n)
      });

      return {
        hash,
        savings: `${savingsPercent.toFixed(1)}%`
      };

    } catch (error) {
      console.error('Error executing batch:', error);
      throw new Error('Batch execution failed');
    }
  }

  /**
   * Get optimal time to execute transaction based on gas prices
   * Returns current gas price and recommendation
   */
  async getOptimalExecutionTime(): Promise<{
    currentGasPrice: string;
    recommendation: string;
    shouldWait: boolean;
  }> {
    try {
      const currentGasPrice = await this.publicClient.getGasPrice();
      const gasPriceGwei = parseFloat(formatEther(currentGasPrice)) * 1e9;

      // Get BNB price for USD cost calculation
      const bnbPrice = await this.getBNBPrice();

      let recommendation: string;
      let shouldWait: boolean;

      if (gasPriceGwei < 3) {
        recommendation = '✅ Excellent time! Gas is very low.';
        shouldWait = false;
      } else if (gasPriceGwei < 5) {
        recommendation = '✅ Good time to transact. Gas is reasonable.';
        shouldWait = false;
      } else if (gasPriceGwei < 10) {
        recommendation = '⚠️ Moderate gas prices. Consider waiting if not urgent.';
        shouldWait = true;
      } else {
        recommendation = '🚨 High gas prices! Wait for better conditions unless urgent.';
        shouldWait = true;
      }

      return {
        currentGasPrice: `${gasPriceGwei.toFixed(2)} Gwei`,
        recommendation,
        shouldWait
      };

    } catch (error) {
      console.error('Error getting optimal execution time:', error);
      throw new Error('Unable to determine optimal execution time');
    }
  }

  /**
   * Monitor gas prices and alert when below threshold
   */
  async monitorGasPrice(
    targetGwei: number,
    callback: (gasPrice: string) => void
  ): Promise<() => void> {
    console.log(`🔔 Monitoring gas prices. Target: ${targetGwei} Gwei`);

    const unwatch = this.publicClient.watchBlockNumber({
      onBlockNumber: async () => {
        const gasPrice = await this.publicClient.getGasPrice();
        const gasPriceGwei = parseFloat(formatEther(gasPrice)) * 1e9;

        if (gasPriceGwei <= targetGwei) {
          callback(`${gasPriceGwei.toFixed(2)} Gwei`);
        }
      }
    });

    return unwatch;
  }

  /**
   * Calculate break-even point for gas optimization strategies
   */
  async calculateBreakEven(transactions: Transaction[]): Promise<{
    individualCost: string;
    batchCost: string;
    savings: string;
    breakEvenTxCount: number;
  }> {
    try {
      // Estimate individual transaction costs
      let totalIndividualGas = 0n;
      const gasPrice = await this.publicClient.getGasPrice();

      for (const tx of transactions) {
        const gasLimit = await this.publicClient.estimateGas({
          account: await this.getAddress() as `0x${string}`,
          to: tx.to as `0x${string}`,
          data: tx.data as `0x${string}`,
          value: tx.value || 0n
        });
        totalIndividualGas += gasLimit;
      }

      // Estimate batch cost
      const targets = transactions.map(tx => tx.to as `0x${string}`);
      const datas = transactions.map(tx => tx.data as `0x${string}`);
      const values = transactions.map(tx => tx.value || 0n);

      const data = encodeFunctionData({
        abi: parseAbi(['function executeBatch(address[] targets, bytes[] datas, uint256[] values)']),
        functionName: 'executeBatch',
        args: [targets, datas, values]
      });

      const batchGas = await this.publicClient.estimateGas({
        account: await this.getAddress() as `0x${string}`,
        to: toAddress(BATCH_EXECUTOR),
        data: data,
        value: values.reduce((sum, v) => sum + v, 0n)
      });

      const individualCostWei = totalIndividualGas * gasPrice;
      const batchCostWei = batchGas * gasPrice;
      const savingsWei = individualCostWei - batchCostWei;

      const bnbPrice = await this.getBNBPrice();

      return {
        individualCost: `$${(parseFloat(formatEther(individualCostWei)) * bnbPrice).toFixed(4)}`,
        batchCost: `$${(parseFloat(formatEther(batchCostWei)) * bnbPrice).toFixed(4)}`,
        savings: `$${(parseFloat(formatEther(savingsWei)) * bnbPrice).toFixed(4)}`,
        breakEvenTxCount: 2 // Batching saves gas starting from 2+ transactions
      };

    } catch (error) {
      console.error('Error calculating break-even:', error);
      throw new Error('Unable to calculate break-even analysis');
    }
  }

  // Helper methods
  private async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }
}
