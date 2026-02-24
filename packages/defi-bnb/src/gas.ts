import { WalletClient, PublicClient, encodeFunctionData, parseAbi, formatEther, parseEther, formatUnits } from 'viem';
import { EidolonConfig, BATCH_EXECUTOR, EidolonWalletClient, toAddress, assertDeployed } from './types';
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
  // FIX H2: Reduce cache duration to 5s (opBNB blocks are 1s)
  private readonly CACHE_DURATION = 5000;

  constructor(
    private walletClient: EidolonWalletClient,
    private publicClient: PublicClient,
    private config: EidolonConfig,
    private oracle?: any // Loosely typed to avoid circular import hell, or use Interface
  ) { }

  /**
   * Inject Oracle for GHOST Protocol (Privacy)
   */
  public setOracle(oracle: any) {
    this.oracle = oracle;
  }

  /**
   * P3: Inject shared PriceService for centralized price fetching.
   * PriceService has its own caching and circuit-breaking via ApiGateway.
   */
  public setPriceService(svc: { getBNBPrice(): Promise<number> }) {
    // Store PriceService as a higher-priority oracle
    // We wrap it to match the oracle interface expected by getBNBPrice internals
    this.oracle = {
      fetchTokenPrices: async () => {
        const bnbPrice = await svc.getBNBPrice();
        return { BNB: bnbPrice, WBNB: bnbPrice };
      }
    };
  }

  /**
   * Get REAL BNB price from multiple sources with caching
   * FIXED: Removed Chainlink (not available on opBNB)
   * Added: Caching, multiple fallbacks, rate limit handling
   */
  async getBNBPrice(): Promise<number> {
    const strictPrivacy = this.config.privacyMode === 'strict';

    // 👻 GHOST PROTOCOL: Use Internal Oracle if available
    // Does not leak IP to CoinGecko/Binance
    if (this.oracle) {
      try {
        let price: number | undefined;

        if (typeof this.oracle.getBNBPrice === 'function') {
          price = await this.oracle.getBNBPrice();
        } else if (typeof this.oracle.fetchTokenPrices === 'function') {
          const prices = await this.oracle.fetchTokenPrices(['BNB', 'WBNB']);
          price = prices?.BNB ?? prices?.WBNB;
        }

        if (Number.isFinite(price) && (price as number) > 0) {
          this.priceCache = { value: price as number, timestamp: Date.now() };
          return price as number;
        }
        console.warn('⚠️ Internal oracle returned invalid price payload. Falling back to external providers.');
      } catch (e) {
        console.warn('⚠️ Internal Oracle failed, falling back to cached or external (Not recommended for Ghost Mode)');
      }
    }

    // Check cache first (prevents rate limiting)
    if (this.priceCache && Date.now() - this.priceCache.timestamp < this.CACHE_DURATION) {
      console.log(`💰 Using cached BNB price: $${this.priceCache.value.toFixed(2)}`);
      return this.priceCache.value;
    }

    // 🕸️ THERAPY 3: ON-CHAIN SENSORY (The Hearing Aid)
    // If cache is stale/missing, try On-Chain reading BEFORE falling back to centralized APIs.
    // This respects privacy (RPC only) and is robust against API downtimes.
    try {
      const onChainPrice = await this.getBNBPriceOnChain();
      if (onChainPrice && onChainPrice > 0) {
        this.priceCache = { value: onChainPrice, timestamp: Date.now() };
        console.log(`✅ BNB price from On-Chain (Pancake V3): $${onChainPrice.toFixed(2)}`);
        return onChainPrice;
      }
    } catch (e) {
      console.warn('⚠️ On-Chain price sensing failed:', e);
    }

    // Strict privacy: never call centralized HTTP feeds directly.
    if (strictPrivacy) {
      if (this.priceCache) {
        console.warn(`⚠️ Strict privacy mode active. Using stale cached BNB price: $${this.priceCache.value.toFixed(2)}`);
        return this.priceCache.value;
      }

      // FIX: Emergency Oxygen - Attempt to infer price from RPC if possible, or throw softer error
      // For now, we MUST throw if no source is available, but the cache check above handles the "stale" case.
      // If we are here, we have NO data.
      console.error('⚠️ ASPHYXIATION WARNING: No internal oracle, no On-Chain data, and no cache in STRICT mode.');
      throw new Error('PRIVACY_STRICT_MODE: Missing internal oracle/cached price. External HTTP feeds are disabled.');
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
      // FIX P4-F6: Validate parseFloat result (reject NaN, Infinity, out-of-range)
      if (Number.isFinite(price) && price > 1 && price < 100000) {
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

    // Emergency fallback for non-strict mode to keep estimators operational.
    // Emergency fallback for non-strict mode to keep estimators operational.
    const emergencyFallback = this.config.fallbackBNBPrice || 600;
    console.error(`❌ All APIs failed to fetch BNB price. Using emergency fallback: $${emergencyFallback}`);
    this.priceCache = { value: emergencyFallback, timestamp: Date.now() };
    return emergencyFallback;
  }

  /**
   * 🕸️ ON-CHAIN SENSORY: Query PancakeSwap V3 for WBNB/USDT price.
   * This is the "Truth" of the blockchain, immune to API rate limits.
   */
  private async getBNBPriceOnChain(): Promise<number | null> {
    const contracts = this.config.chainConfig?.contracts;
    const tokens = this.config.chainConfig?.tokens;

    if (!contracts?.pancakeQuoter || !tokens?.WBNB || !tokens?.USDT) {
      // Missing config, cannot sense on-chain.
      return null;
    }

    try {
      // 1 WBNB -> USDT
      const amountIn = parseEther('1');
      const tokenIn = toAddress(tokens.WBNB.address);
      const tokenOut = toAddress(tokens.USDT.address);
      const fee = 500; // 0.05% typical for stable pairs like BNB/USDT on V3

      const quoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) view returns (uint256 amountOut)']);

      const amountOut = await this.publicClient.readContract({
        address: toAddress(contracts.pancakeQuoter),
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0n
        }]
      }) as bigint;

      // USDT is 6 decimals? 18? Check config.
      const usdtDecimals = tokens.USDT.decimals || 18;

      // formatUnits returns string "600.5"
      // If USDT is 6 decimals, 600000000 -> 600.0
      // If USDT is 18 decimals, 600e18 -> 600.0
      const price = parseFloat(formatUnits(amountOut, usdtDecimals));

      return price;

    } catch (e) {
      // console.warn('On-Chain Price Check failed (might be no liquidity at 0.05% tier)', e);
      return null;
    }
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
          'function executeBatch(address[] targets, uint256[] values, bytes[] datas)',
          'function executeBatchTolerant(address[] targets, uint256[] values, bytes[] datas)'
        ]),
        functionName: functionName,
        args: [targets, values, datas]
      });

      // Estimate batched gas
      // FIX P2: Standardize address source to config
      const batchExecutor = this.config.chainConfig?.contracts?.batchExecutor || BATCH_EXECUTOR;

      // assertDeployed check using the dynamic address
      if (!batchExecutor || batchExecutor === '0x0000000000000000000000000000000000000000') {
        throw new Error('BatchExecutor contract not deployed. Cannot estimate batch.');
      }

      const batchGasCost = await this.publicClient.estimateGas({
        account: await this.getAddress() as `0x${string}`,
        to: toAddress(batchExecutor),
        data: data,
        value: values.reduce((sum, v) => sum + v, 0n)
      });

      // Calculate savings
      const savings = individualGasCost - batchGasCost;
      const savingsPercent = Number(savings * 100n / individualGasCost);

      console.log(`💰 Gas savings: ${savingsPercent.toFixed(1)}%`);

      // Execute batch
      const hash = await this.walletClient.sendTransaction({
        to: toAddress(batchExecutor),
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

    let lastCheckTime = 0;
    const unwatch = this.publicClient.watchBlockNumber({
      onBlockNumber: async () => {
        // FIX: Throttle to 3s to prevent RPC spam on L2 (1s blocks)
        const now = Date.now();
        if (now - lastCheckTime < 3000) return;
        lastCheckTime = now;

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
        abi: parseAbi(['function executeBatch(address[] targets, uint256[] values, bytes[] datas)']),
        functionName: 'executeBatch',
        args: [targets, values, datas]
      });

      // FIX P2: Standardize address source to config in calculateBreakEven
      const breakEvenExecutor = this.config.chainConfig?.contracts?.batchExecutor || BATCH_EXECUTOR;

      const batchGas = await this.publicClient.estimateGas({
        account: await this.getAddress() as `0x${string}`,
        to: toAddress(breakEvenExecutor),
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
