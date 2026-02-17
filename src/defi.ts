import { WalletClient, PublicClient, parseEther, parseUnits, formatEther, encodeFunctionData, parseAbi, SimulateContractParameters } from 'viem';
import { ClawKitConfig, SwapParams, StakeParams, LendParams, BorrowParams, RepayParams, TOKENS, TokenSymbol, ClawKitWalletClient, OPBNB_CONFIG, toAddress, getTokenDecimals } from './types';
import axios from 'axios';
import { withRetry } from './utils/Resilience';

const PANCAKE_V3_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' }
        ],
        name: 'params',
        type: 'tuple'
      }
    ],
    name: 'exactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      {
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' }
        ],
        name: 'params',
        type: 'tuple'
      }
    ],
    name: 'exactInput',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function'
  }
] as const;

export class DeFiModule {

  constructor(
    private walletClient: ClawKitWalletClient,
    private publicClient: PublicClient,
    private config: ClawKitConfig
  ) {
    if (!this.config.chainConfig) {
      console.warn("⚠️ No chain config provided, defaulting to opBNB");
      this.config.chainConfig = OPBNB_CONFIG;
    }
  }

  private get contracts() {
    return this.config.chainConfig!.contracts;
  }

  private get tokens() {
    return this.config.chainConfig!.tokens;
  }

  /**
   * 🛡️ SIMULATION GUARD
   * Pre-validates transaction to prevent failures and gas waste.
   */
  private async simulateTransaction(
    to: string,
    data: string,
    value: bigint = 0n,
    account: string
  ): Promise<void> {
    try {
      // FIX F4: Simulate before sending
      await this.publicClient.call({
        account: toAddress(account),
        to: toAddress(to),
        data: data as `0x${string}`,
        value,
      });
    } catch (error: any) {
      console.error('❌ Simulation Failed:', error.shortMessage || error.message);
      throw new Error(`Simulation failed: ${error.shortMessage || error.message}`);
    }
  }

  /**
   * ⚡ FLASH ACCOUNTING: Thermodynamic Check
   * Ensure we are not burning move energy (Gas) than the food is worth.
   */
  private async checkThermodynamics(
    to: string,
    data: string,
    value: bigint,
    amountIn: bigint
  ): Promise<void> {
    try {
      const userAddress = await this.getAddress();
      const gasEstimate = await this.publicClient.estimateGas({
        account: toAddress(userAddress),
        to: toAddress(to),
        data: data as `0x${string}`,
        value
      });

      const gasPrice = await this.publicClient.getGasPrice();
      const gasCost = gasEstimate * gasPrice;

      // Logic: If Gas Cost > 10% of Trade Value, ABORT.
      // Note: Both gasCost and amountIn are in Wei, so comparison is unit-consistent
      // for native token swaps. For ERC20 swaps, amountIn is in token's smallest unit.
      if (value > 0n || amountIn > 0n) {
        const tradeValue = value > 0n ? value : amountIn;
        const threshold = tradeValue / 10n; // 10% in same unit

        if (gasCost > threshold) {
          throw new Error(`Thermodynamic Fail: Gas cost (${formatEther(gasCost)} BNB) > 10% of Trade Value (${formatEther(tradeValue)})`);
        }
        // FIX P1-04: Use BigInt division to avoid Number precision loss on large values
        const costBps = gasCost * 10000n / tradeValue; // basis points
      }

    } catch (error) {
      if (String(error).includes('Thermodynamic')) throw error;
      console.warn("Could not verify thermodynamics (Oracle needed for Token value)", error);
    }
  }

  /**
   * Swap tokens using PancakeSwap V3 (ExactInputSingle)
   * FIXED: Bug #1 (Decimals) & Bug #5 (V3 ABI)
   * @example
   * await kit.defi.swap({ from: 'BNB', to: 'USDT', amount: '0.1' })
   */
  async swap(params: SwapParams): Promise<{ hash: string; amountOut: string }> {
    const { from, to, amount, slippage = 0.5, deadline = 20 } = params;

    // Resolve token addresses
    const fromToken = this.resolveTokenAddress(from);
    const toToken = this.resolveTokenAddress(to);

    // FIX Bug #1: Dynamic Decimal Resolution
    const fromDecimals = getTokenDecimals(from);
    const amountIn = parseUnits(amount, fromDecimals);

    // Get real quote from PancakeSwap V3 Quoter
    // We get the best fee tier from the quote result
    const quoteResult = await this.getRealQuote(fromToken, toToken, amountIn, slippage);
    const amountOutMin = quoteResult.amountOutMin;
    const feeTier = quoteResult.fee;

    // Build transaction
    const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;
    const userAddress = await this.getAddress();
    const router = this.contracts.pancakeRouter; // V3 Router

    try {
      // 🛡️ Pre-computation: Prepare Data
      let data: `0x${string}`;
      let value = 0n;

      const isNativeIn = fromToken === this.tokens.BNB.address || fromToken === this.tokens.WBNB.address;

      if (fromToken === this.tokens.BNB.address) {
        // Native BNB -> Token
        // V3 Router handles native ETH/BNB wrapping automatically if msg.value > 0 and tokenIn is WBNB
        // But technically exactInputSingle params.tokenIn must be WBNB address
        value = amountIn;
      } else {
        // Token -> Token
        await this.ensureApproval(fromToken, router, amountIn);
        value = 0n;
      }

      // V3 Params
      const v3Params = {
        tokenIn: isNativeIn ? (this.tokens.WBNB.address as `0x${string}`) : toAddress(fromToken),
        tokenOut: toAddress(toToken),
        fee: feeTier,
        recipient: toAddress(userAddress),
        deadline: BigInt(deadlineTimestamp),
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
      };

      data = encodeFunctionData({
        abi: PANCAKE_V3_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [v3Params]
      });

      // ⚡ CHECK 1: FLASH ACCOUNTING (Thermodynamics)
      try {
        await this.checkThermodynamics(router, data, value, amountIn);
      } catch (err: any) {
        console.error('⚡ CRITICAL FAILURE (Thermodynamic):', err.message);

        // FIX Bug #3 (Part 1): Revoke approval on error
        if (fromToken !== this.tokens.BNB.address) {
          console.warn('🔄 Revoking approval due to thermodynamic failure...');
          await this.revokeApproval(fromToken, router);
        }
        throw err;
      }

      // 🛡️ CHECK 2: SIMULATION (The Hunter's Eye)
      try {
        await this.simulateTransaction(router, data, value, userAddress);
      } catch (err: any) {
        console.error('🛡️ Simulation Failed:', err.message);
        // FIX Bug #3 (Part 2): Revoke approval on simulation failure
        if (fromToken !== this.tokens.BNB.address) {
          console.warn('🔄 Revoking approval due to simulation failure...');
          await this.revokeApproval(fromToken, router);
        }
        throw err;
      }

      // 🚀 EXECUTION (The Strike)
      const hash = await this.walletClient.sendTransaction({
        to: toAddress(router),
        data,
        value
      });

      return {
        hash,
        amountOut: formatEther(amountOutMin) // Display purpose
      };

    } catch (error: any) {
      console.error('Swap error:', error);
      this.handleSwapError(error);
      throw error;
    }
  }

  private handleSwapError(error: any) {
    if (error.message?.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
      throw new Error('Slippage tolerance exceeded. Try increasing slippage or reducing amount.');
    } else if (error.message?.includes('INSUFFICIENT_INPUT_AMOUNT')) {
      throw new Error('Insufficient balance for swap.');
    } else if (error.message?.includes('EXPIRED')) {
      throw new Error('Transaction deadline expired. Try again.');
    }
  }

  /**
   * Ensure token approval for spender
   * Updated to support force behavior if needed, but standard flow checks allowance.
   */
  private async ensureApproval(
    tokenAddress: string,
    spender: string,
    amount: bigint
  ): Promise<void> {
    const owner = await this.getAddress();

    // Check current allowance
    const allowance = await this.publicClient.readContract({
      address: toAddress(tokenAddress),
      abi: parseAbi(['function allowance(address owner, address spender) view returns (uint256)']),
      functionName: 'allowance',
      args: [toAddress(owner), toAddress(spender)]
    });

    // If allowance is sufficient, return
    if (allowance >= amount) {
      return;
    }

    if (allowance < amount) {
      console.info(`🔓 Approving ${tokenAddress} for ${spender}...`);

      // FIX U3: Optimize Approval Strategy (Approve MAX_UINT)
      // Saves gas on repeated swaps
      const MAX_UINT = 2n ** 256n - 1n;

      // ERC20_ABI is not defined in the provided context, assuming it's available globally or imported.
      // For a complete solution, it would need to be defined, e.g., `const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);`
      const { request } = await this.publicClient.simulateContract({
        address: tokenAddress as `0x${string}`,
        abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']), // Using parseAbi directly for ERC20 approve
        functionName: 'approve',
        args: [toAddress(spender), MAX_UINT],
        account: toAddress(this.walletClient.account.address), // Ensure account is `Address` type
      });

      const hash = await this.walletClient.writeContract(request);
      console.info(`⏳ Approval Tx Sent: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });
      console.info(`✅ Approval Confirmed.`);
    }
  }

  /**
   * FIX Bug #3: Dedicated Revoke Function
   * Forces approval to 0 regardless of current state to clear risks.
   */
  private async revokeApproval(
    tokenAddress: string,
    spender: string
  ): Promise<void> {
    const owner = await this.getAddress();
    console.warn(`Warning: Revoking approval for ${tokenAddress} to ${spender}`);

    const data = encodeFunctionData({
      abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
      functionName: 'approve',
      args: [toAddress(spender), 0n]
    });

    try {
      // We assume this might be called in an error state, so we try-catch the revoke itself 
      // to ensuring it doesn't mask the original error if it fails (though unlikely for 0 approve)
      const hash = await this.walletClient.sendTransaction({
        to: toAddress(tokenAddress),
        data
      });
      await this.publicClient.waitForTransactionReceipt({ hash }); // Optional wait
      console.info('✅ Approval revoked (Reset to 0)');
    } catch (e) {
      console.error("Failed to revoke approval:", e);
    }
  }

  /**
  * Get real quote from PancakeSwap
  * FIXED: Try multiple fee tiers to find liquidity
  */
  /**
  * Get real quote from PancakeSwap
  * FIXED: Try multiple fee tiers to find liquidity
  */
  public async getRealQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    slippage: number
  ): Promise<{ amountOutMin: bigint; fee: number }> {
    // FIXED: Parallel execution for all fee tiers (Hyper-Routing)
    const feeTiers = [
      { fee: 2500, name: '0.25%' },  // Most common
      { fee: 500, name: '0.05%' },   // Stable pairs
      { fee: 10000, name: '1.00%' }, // Exotic pairs
      { fee: 100, name: '0.01%' }    // Stablecoin pairs
    ];

    const quoterAddress = this.contracts.pancakeQuoter;
    const quoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) view returns (uint256 amountOut)']);

    // Fire all requests in parallel
    const quotePromises = feeTiers.map(async (tier) => {
      try {
        const amountOut = await this.publicClient.readContract({
          address: toAddress(quoterAddress),
          abi: quoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn: toAddress(tokenIn),
            tokenOut: toAddress(tokenOut),
            amountIn: amountIn,
            fee: tier.fee,
            sqrtPriceLimitX96: 0n
          }]
        });
        return { ...tier, amountOut, error: null };
      } catch (error) {
        // console.error(`Error fetching quote for tier ${tier.fee}:`, error);
        return { ...tier, amountOut: 0n, error };
      }
    });

    const results = await Promise.all(quotePromises);

    // Filter successful quotes and sort by best output (High to Low)
    const validQuotes = results
      .filter(r => r.amountOut > 0n)
      .sort((a, b) => Number(b.amountOut - a.amountOut)); // bigint sort

    if (validQuotes.length === 0) {
      throw new Error(
        'No PancakeSwap V3 pool found for this trading pair on any fee tier. ' +
        'Cannot provide a quote without a real pool.'
      );
    }

    const bestQuote = validQuotes[0];
    const amountOutMin = bestQuote.amountOut - (bestQuote.amountOut * BigInt(Math.floor(slippage * 100)) / 10000n);

    // Helper to format output based on target token decimals for logging
    // We don't have target token decimals easily here without lookup, so using formatEther as approx or generic
    // But since this is just logging, it's fine.
    console.info(`✅ Hyper-Routing Winner: ${bestQuote.name} (Out: ${bestQuote.amountOut})`);

    return {
      amountOutMin,
      fee: bestQuote.fee
    };
  }

  /**
   * Stake tokens in PancakeSwap pools - REAL implementation
   * @example
   * await kit.defi.stake({ pool: 'CAKE', amount: '10' })
   */
  async stake(params: StakeParams): Promise<{ hash: string }> {
    const { pool, amount } = params;

    try {
      // Get pool info from PancakeSwap API
      if (!pool) throw new Error('Pool symbol required for staking');
      const poolInfo = await this.getPancakePoolInfo(pool);
      if (!poolInfo) {
        throw new Error(`Pool ${pool} not found`);
      }

      const amountToStake = parseEther(amount);
      const lpTokenAddress = poolInfo.lpAddress;
      const masterChef = this.contracts.pancakeMasterChef;
      const userAddress = await this.getAddress();

      // Ensure approval for MasterChef
      await this.ensureApproval(lpTokenAddress, masterChef, amountToStake);

      // Deposit into pool
      const data = encodeFunctionData({
        abi: parseAbi(['function deposit(uint256 pid, uint256 amount)']),
        functionName: 'deposit',
        args: [BigInt(poolInfo.pid), amountToStake]
      });

      await this.simulateTransaction(masterChef, data, 0n, userAddress);

      const hash = await this.walletClient.sendTransaction({
        to: toAddress(masterChef),
        data
      });

      console.info(`✅ Staked ${amount} ${pool} tokens`);
      return { hash };

    } catch (error: any) {
      console.error('Stake error:', error);
      throw new Error(`Staking failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Get PancakeSwap pool info
   */
  private async getPancakePoolInfo(poolSymbol: string): Promise<any> {
    try {
      const response = await withRetry(() => axios.get('https://farms-api.pancakeswap.com/farms', {
        timeout: 5000
      }));

      if (response.data && Array.isArray(response.data)) {
        const pool = response.data.find((p: any) =>
          p.lpSymbol?.toLowerCase().includes(poolSymbol.toLowerCase())
        );

        if (pool) {
          return {
            pid: pool.pid,
            lpAddress: pool.lpAddress,
            symbol: pool.lpSymbol,
            apr: pool.apr
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error fetching pool info:', error);
      return null;
    }
  }

  /**
   * Harvest rewards from all pools
   * ⚡ OPTIMIZED: Uses BatchExecutor if available for 1-tx harvest
   */
  async harvestAll(): Promise<{ totalRewards: string; transactions: string[] }> {
    const userAddress = await this.getAddress();
    const transactions: string[] = [];
    const masterChef = this.contracts.pancakeMasterChef;

    try {
      // Get user's staked pools (mock for now, normally would retry-fetch)
      const userPools = await this.getUserStakedPools(userAddress);

      if (userPools.length === 0) {
        return { totalRewards: '0', transactions: [] };
      }

      let totalRewards = 0n;
      const batchData: { target: string; callData: string; value: bigint }[] = [];

      // 1. Prepare all harvest calls
      for (const pool of userPools) {
        const data = encodeFunctionData({
          abi: parseAbi(['function withdraw(uint256 pid, uint256 amount)']),
          functionName: 'withdraw',
          args: [BigInt(pool.pid), 0n]
        });
        batchData.push({
          target: masterChef,
          callData: data,
          value: 0n
        });
        totalRewards += pool.pendingRewards;
      }

      // 2. Check for BatchExecutor
      // We read from config directly to ensure latest address
      const batchExecutor = this.config.chainConfig?.contracts?.batchExecutor ||
        this.config.contracts?.BatchExecutor;

      if (batchExecutor && batchExecutor !== '0x0000000000000000000000000000000000000000') {
        console.info(`⚡ Optimizing: Batching ${batchData.length} harvests via Executor: ${batchExecutor}`);

        const batchAbi = parseAbi([
          'function executeBatch(address[] targets, uint256[] values, bytes[] datas) payable'
        ]);

        const targets = batchData.map(b => b.target as `0x${string}`);
        const datas = batchData.map(b => b.callData as `0x${string}`);
        const values = batchData.map(b => b.value);

        const data = encodeFunctionData({
          abi: batchAbi,
          functionName: 'executeBatch',
          args: [targets, values, datas]
        });

        await this.simulateTransaction(batchExecutor, data, 0n, userAddress);

        const hash = await this.walletClient.sendTransaction({
          to: toAddress(batchExecutor),
          data
        });

        transactions.push(hash);
        console.info(`✅ Batch Harvest Complete! Hash: ${hash}`);

      } else {
        // Fallback to sequential
        console.warn('⚠️ BatchExecutor not deployed. Falling back to sequential harvest (Slow).');

        for (const item of batchData) {
          const hash = await this.walletClient.sendTransaction({
            to: toAddress(item.target),
            data: item.callData as `0x${string}`,
            value: item.value
          });
          transactions.push(hash);
          console.info(`✅ Harvested single pool. Hash: ${hash}`);
        }
      }

      return {
        totalRewards: formatEther(totalRewards),
        transactions
      };

    } catch (error) {
      console.error('Harvest error:', error);
      return {
        totalRewards: '0',
        transactions
      };
    }
  }

  /**
   * Get user's staked pools
   */
  /**
   * Get user's staked pools
   * FIX L2: Real on-chain query to MasterChef
   */
  private async getUserStakedPools(address: string): Promise<any[]> {
    const masterChef = this.contracts.pancakeMasterChef;

    try {
      // 1. Get pool length
      const poolLength = await this.publicClient.readContract({
        address: toAddress(masterChef),
        abi: parseAbi(['function poolLength() view returns (uint256)']),
        functionName: 'poolLength'
      }) as bigint;

      const pools = [];
      // 2. Iterate pools (Optimized: In production, use Multicall or Graph)
      // For now, limiting to first 20 pools to avoid RPC timeout if thousands exist
      // or just iterate known PIDs if we had a config.
      // We'll iterate up to 10 for demo/safety, or loop all if small.
      const scanLimit = poolLength > 20n ? 20n : poolLength;

      for (let pid = 0n; pid < scanLimit; pid++) {
        const userInfo = await this.publicClient.readContract({
          address: toAddress(masterChef),
          abi: parseAbi(['function userInfo(uint256 pid, address user) view returns (uint256 amount, uint256 rewardDebt)']),
          functionName: 'userInfo',
          args: [pid, toAddress(address)]
        }) as [bigint, bigint];

        if (userInfo[0] > 0n) {
          // Determine pending rewards
          const pending = await this.publicClient.readContract({
            address: toAddress(masterChef),
            abi: parseAbi(['function pendingCake(uint256 pid, address user) view returns (uint256)']),
            functionName: 'pendingCake', // V3 might be different, assuming V2/MasterChef style
            args: [pid, toAddress(address)]
          }) as bigint;

          pools.push({
            pid: Number(pid),
            stakedAmount: userInfo[0],
            pendingRewards: pending
          });
        }
      }
      return pools;
    } catch (e) {
      console.warn('Failed to fetch staked pools', e);
      return [];
    }
  }

  /**
   * Auto-compound: Harvest rewards and reinvest
   * @example
   * await kit.defi.autoCompound()
   */
  async autoCompound(): Promise<{ hash: string; reinvestedAmount: string }> {
    try {
      // 1. Harvest all rewards
      const { totalRewards, transactions } = await this.harvestAll();

      if (parseFloat(totalRewards) === 0) {
        throw new Error('No rewards to compound');
      }

      // 2. Find highest APY pool
      const bestPool = await this.findBestAPYPool();

      if (!bestPool) {
        throw new Error('No suitable pool found for compounding');
      }

      // 3. Stake harvested rewards back
      const stakeResult = await this.stake({
        pool: bestPool.symbol,
        token: bestPool.lpAddress,
        amount: totalRewards
      });

      console.info(`✅ Auto-compounded ${totalRewards} tokens into ${bestPool.symbol} pool`);

      return {
        hash: stakeResult.hash,
        reinvestedAmount: totalRewards
      };

    } catch (error: any) {
      console.error('Auto-compound error:', error);
      throw new Error(`Auto-compound failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Find pool with highest APY
   */
  private async findBestAPYPool(): Promise<any> {
    try {
      const response = await withRetry(() => axios.get('https://farms-api.pancakeswap.com/farms', {
        timeout: 5000
      }));

      if (response.data && Array.isArray(response.data)) {
        // Filter active pools and sort by APR
        const activePools = response.data
          .filter((p: any) => p.apr > 0)
          .sort((a: any, b: any) => b.apr - a.apr);

        if (activePools.length > 0) {
          return {
            symbol: activePools[0].lpSymbol,
            apr: activePools[0].apr,
            lpAddress: activePools[0].lpAddress,
            pid: activePools[0].pid
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding best APY pool:', error);
      return null;
    }
  }

  /**
   * Get current APY for a pool
   */
  async getPoolAPY(pool: string): Promise<number> {
    const poolInfo = await this.getPancakePoolInfo(pool);
    return poolInfo?.apr || 0;
  }

  // Helper methods

  private resolveTokenAddress(symbolOrAddress: string): string {
    // If it's already an address
    if (symbolOrAddress.startsWith('0x')) {
      return symbolOrAddress;
    }

    // Resolve from known tokens
    const symbol = symbolOrAddress.toUpperCase() as TokenSymbol;
    // Look in config tokens first, then default to types.TOKENS for safety
    const tokenInfo = this.tokens[symbol] || TOKENS[symbol];
    return tokenInfo ? tokenInfo.address : symbolOrAddress;
  }

  private async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }

  private checkVenusSupport() {
    if (!this.contracts.venusComptroller || !this.contracts.venusMarkets) {
      throw new Error(`Venus Protocol is not supported or configured on this chain (${this.config.chainConfig?.name})`);
    }
  }

  private resolveVToken(asset: string): string {
    this.checkVenusSupport();
    const markets = this.contracts.venusMarkets!;
    const vToken = markets[asset.toUpperCase()];
    if (!vToken) {
      throw new Error(`No Venus market found for ${asset}`);
    }
    return vToken;
  }

  /**
   * Supply assets to Venus Protocol
   * @example
   * await kit.defi.lend({ asset: 'BNB', amount: '0.1' })
   */
  async lend(params: LendParams): Promise<{ hash: string }> {
    this.checkVenusSupport();
    const { asset, amount } = params;
    const vTokenAddress = this.resolveVToken(asset);

    // FIX Bug #1: Dynamic Decimals for Lend
    const decimals = getTokenDecimals(asset);
    const amountBigInt = parseUnits(amount, decimals);
    const userAddress = await this.getAddress();

    try {
      console.info(`Supplying ${amount} ${asset} to Venus...`);

      if (asset === 'BNB' || asset === 'WBNB') {
        const data = encodeFunctionData({
          abi: parseAbi(['function mint() payable']),
          functionName: 'mint',
          args: []
        });

        await this.simulateTransaction(vTokenAddress, data, amountBigInt, userAddress);

        const hash = await this.walletClient.sendTransaction({
          to: toAddress(vTokenAddress),
          data,
          value: amountBigInt
        });

        console.info(`✅ Supplied BNB. Hash: ${hash}`);
        return { hash };
      } else {
        const tokenAddress = this.resolveTokenAddress(asset);
        await this.ensureApproval(tokenAddress, vTokenAddress, amountBigInt);

        const data = encodeFunctionData({
          abi: parseAbi(['function mint(uint256 mintAmount) returns (uint256)']),
          functionName: 'mint',
          args: [amountBigInt]
        });

        await this.simulateTransaction(vTokenAddress, data, 0n, userAddress);

        const hash = await this.walletClient.sendTransaction({
          to: toAddress(vTokenAddress),
          data
        });

        console.log(`✅ Supplied ${asset}. Hash: ${hash}`);
        return { hash };
      }
    } catch (error: any) {
      console.error('Lend error:', error);
      throw new Error(`Lend failed: ${error.message}`);
    }
  }

  /**
   * Borrow assets from Venus Protocol
   * @example
   * await kit.defi.borrow({ asset: 'USDT', amount: '50' })
   */
  async borrow(params: BorrowParams): Promise<{ hash: string }> {
    this.checkVenusSupport();
    const { asset, amount } = params;
    const vTokenAddress = this.resolveVToken(asset);

    // FIX Bug #1: Dynamic Decimals for Borrow
    const decimals = getTokenDecimals(asset);
    const amountBigInt = parseUnits(amount, decimals);

    try {
      console.log(`Borrowing ${amount} ${asset} from Venus...`);
      const userAddress = await this.getAddress();

      const data = encodeFunctionData({
        abi: parseAbi(['function borrow(uint256 borrowAmount) returns (uint256)']),
        functionName: 'borrow',
        args: [amountBigInt]
      });

      await this.simulateTransaction(vTokenAddress, data, 0n, userAddress);

      const hash = await this.walletClient.sendTransaction({
        to: toAddress(vTokenAddress),
        data
      });

      console.log(`✅ Borrowed ${asset}. Hash: ${hash}`);
      return { hash };
    } catch (error: any) {
      console.error('Borrow error:', error);
      throw new Error(`Borrow failed: ${error.message}`);
    }
  }

  /**
   * Repay borrowed assets to Venus Protocol
   * @example
   * await kit.defi.repay({ asset: 'USDT', amount: '50' })
   */
  async repay(params: RepayParams): Promise<{ hash: string }> {
    this.checkVenusSupport();
    const { asset, amount } = params;
    const vTokenAddress = this.resolveVToken(asset);

    // FIX Bug #1: Dynamic Decimals for Repay
    const decimals = getTokenDecimals(asset);
    const amountBigInt = parseUnits(amount, decimals);
    const userAddress = await this.getAddress();

    try {
      console.log(`Repaying ${amount} ${asset} to Venus...`);

      if (asset === 'BNB' || asset === 'WBNB') {
        const data = encodeFunctionData({
          abi: parseAbi(['function repayBorrow() payable']),
          functionName: 'repayBorrow',
          args: []
        });

        await this.simulateTransaction(vTokenAddress, data, amountBigInt, userAddress);

        const hash = await this.walletClient.sendTransaction({
          to: toAddress(vTokenAddress),
          data,
          value: amountBigInt
        });

        console.log(`✅ Repaid BNB. Hash: ${hash}`);
        return { hash };
      } else {
        const tokenAddress = this.resolveTokenAddress(asset);
        await this.ensureApproval(tokenAddress, vTokenAddress, amountBigInt);

        const data = encodeFunctionData({
          abi: parseAbi(['function repayBorrow(uint256 repayAmount) returns (uint256)']),
          functionName: 'repayBorrow',
          args: [amountBigInt]
        });

        await this.simulateTransaction(vTokenAddress, data, 0n, userAddress);

        const hash = await this.walletClient.sendTransaction({
          to: toAddress(vTokenAddress),
          data
        });

        console.log(`✅ Repaid ${asset}. Hash: ${hash}`);
        return { hash };
      }
    } catch (error: any) {
      console.error('Repay error:', error);
      throw new Error(`Repay failed: ${error.message}`);
    }
  }

  /**
   * Enter markets to enable collateral
   */
  async enterMarkets(assets: string[]): Promise<{ hash: string }> {
    this.checkVenusSupport();
    const vTokens = assets.map(a => this.resolveVToken(a));
    const userAddress = await this.getAddress();

    try {
      console.log(`Entering markets for ${assets.join(', ')}...`);
      const data = encodeFunctionData({
        abi: parseAbi(['function enterMarkets(address[] vTokens) returns (uint256[])']),
        functionName: 'enterMarkets',
        args: [vTokens as `0x${string}`[]]
      });

      const comptroller = this.contracts.venusComptroller!;

      await this.simulateTransaction(comptroller, data, 0n, userAddress);

      const hash = await this.walletClient.sendTransaction({
        to: toAddress(comptroller),
        data
      });

      console.log('✅ Entered markets');
      return { hash };
    } catch (error: any) {
      console.error('Enter markets error:', error);
      throw new Error(`Enter markets failed: ${error.message}`);
    }
  }
}

// Simplified PancakeSwap Router ABI

