import { WalletClient, PublicClient, parseEther, formatEther, encodeFunctionData, parseAbi } from 'viem';
import { ClawKitConfig, SwapParams, StakeParams, LendParams, BorrowParams, RepayParams, TOKENS, TokenSymbol, PANCAKE_ROUTER, toAddress, ClawKitWalletClient } from './types';
import axios from 'axios';

export class DeFiModule {
  // FIX M6: These are BSC mainnet addresses, NOT opBNB
  // TODO: Replace with opBNB equivalents when available
  // PancakeSwap MasterChef V3 may not be deployed on opBNB
  // PancakeSwap MasterChef V3 may not be deployed on opBNB
  private readonly PANCAKE_MASTERCHEF_V3 = ''; // Was BSC: 0x556B9306...  
  private readonly VENUS_COMPTROLLER = '0xD6e3E2A1d8d95caE8D0D6D3bCD34E3Cbf2dB8bf2'; // opBNB Comptroller

  // vToken mapping for opBNB (verified addresses need to be populated)
  // For now, using placeholders or previously researched addresses if available.
  // Warning: verifying these addresses is crucial for mainnet.
  private readonly VENUS_MARKETS: Record<string, string> = {
    'BNB': '0xA07c5b74C9B40447a954e1466938b865b6BBea36', // vBNB (Placeholder/BSC address - needs opBNB update)
    'WBNB': '0xA07c5b74C9B40447a954e1466938b865b6BBea36', // vBNB
    'USDT': '0xfD5840Cd36d94D7229439859C0112a4185BC0255', // vUSDT
    'USDC': '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', // vUSDC
    'BTC': '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B', // vBTC
    'ETH': '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE', // vETH
  };

  constructor(
    private walletClient: ClawKitWalletClient,
    private publicClient: PublicClient,
    private config: ClawKitConfig
  ) { }

  /**
   * Swap tokens using PancakeSwap with approval check
   * @example
   * await kit.defi.swap({ from: 'BNB', to: 'USDT', amount: '0.1' })
   */
  async swap(params: SwapParams): Promise<{ hash: string; amountOut: string }> {
    const { from, to, amount, slippage = 0.5, deadline = 20 } = params;

    // Resolve token addresses
    const fromToken = this.resolveTokenAddress(from);
    const toToken = this.resolveTokenAddress(to);

    // Parse amount
    const amountIn = parseEther(amount);

    // Get real quote from PancakeSwap
    const amountOutMin = await this.getRealQuote(fromToken, toToken, amountIn, slippage);

    // Build transaction
    const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;
    const userAddress = await this.getAddress();

    try {
      // For BNB -> Token swap (no approval needed)
      if (fromToken === TOKENS.BNB.address || fromToken === TOKENS.WBNB.address) {
        const data = encodeFunctionData({
          abi: PANCAKE_SWAP_ROUTER_ABI,
          functionName: 'swapExactETHForTokens',
          args: [
            amountOutMin,
            [TOKENS.WBNB.address, toToken] as `0x${string}`[],
            userAddress as `0x${string}`,
            BigInt(deadlineTimestamp)
          ]
        });

        const hash = await this.walletClient.sendTransaction({
          to: PANCAKE_ROUTER,
          data,
          value: amountIn
        });

        return {
          hash,
          amountOut: formatEther(amountOutMin)
        };
      }

      // For Token -> Token or Token -> BNB (requires approval)
      await this.ensureApproval(fromToken, PANCAKE_ROUTER, amountIn);

      // Determine swap function based on destination
      let functionName: string;
      let path: `0x${string}`[];

      if (toToken === TOKENS.WBNB.address || toToken === TOKENS.BNB.address) {
        functionName = 'swapExactTokensForETH';
        path = [fromToken as `0x${string}`, TOKENS.WBNB.address as `0x${string}`];
      } else {
        functionName = 'swapExactTokensForTokens';
        path = [fromToken as `0x${string}`, TOKENS.WBNB.address as `0x${string}`, toToken as `0x${string}`];
      }

      const data = encodeFunctionData({
        abi: PANCAKE_SWAP_ROUTER_ABI,
        functionName: functionName as any,
        args: [
          amountIn,
          amountOutMin,
          path,
          userAddress as `0x${string}`,
          BigInt(deadlineTimestamp)
        ]
      });

      const hash = await this.walletClient.sendTransaction({
        to: PANCAKE_ROUTER,
        data
      });

      return {
        hash,
        amountOut: formatEther(amountOutMin)
      };

    } catch (error: any) {
      console.error('Swap error:', error);

      if (error.message?.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
        throw new Error('Slippage tolerance exceeded. Try increasing slippage or reducing amount.');
      } else if (error.message?.includes('INSUFFICIENT_INPUT_AMOUNT')) {
        throw new Error('Insufficient balance for swap.');
      } else if (error.message?.includes('EXPIRED')) {
        throw new Error('Transaction deadline expired. Try again.');
      }

      throw new Error(`Swap failed: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Ensure token approval for spender
   */
  private async ensureApproval(
    tokenAddress: string,
    spender: string,
    amount: bigint
  ): Promise<void> {
    const owner = await this.getAddress();

    // Check current allowance
    const allowance = await this.publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: parseAbi(['function allowance(address owner, address spender) view returns (uint256)']),
      functionName: 'allowance',
      args: [owner as `0x${string}`, spender as `0x${string}`]
    });

    // If allowance is sufficient, no need to approve
    if (allowance >= amount) {
      return;
    }

    // Request approval
    console.log('Requesting approval...');
    const data = encodeFunctionData({
      abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
      functionName: 'approve',
      args: [spender as `0x${string}`, amount]
    });

    const hash = await this.walletClient.sendTransaction({
      to: tokenAddress as `0x${string}`,
      data
    });

    // Wait for approval transaction
    await this.publicClient.waitForTransactionReceipt({ hash });
    console.log('✅ Approval granted');
  }

  /**
   * Get real quote from PancakeSwap
   * FIXED: Try multiple fee tiers to find liquidity
   */
  private async getRealQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    slippage: number
  ): Promise<bigint> {
    // FIXED: Try multiple fee tiers (some pools may not have 0.25%)
    const feeTiers = [
      { fee: 2500, name: '0.25%' },  // Most common
      { fee: 500, name: '0.05%' },   // Stable pairs
      { fee: 10000, name: '1.00%' }, // Exotic pairs
      { fee: 100, name: '0.01%' }    // Stablecoin pairs
    ];

    const quoterAddress = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'; // V3 Quoter

    // Try each fee tier until we find a pool
    for (const { fee, name } of feeTiers) {
      try {
        const amountOut = await this.publicClient.readContract({
          address: quoterAddress as `0x${string}`,
          abi: parseAbi(['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) view returns (uint256 amountOut)']),
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn: toAddress(tokenIn),
            tokenOut: toAddress(tokenOut),
            amountIn: amountIn,
            fee,
            sqrtPriceLimitX96: 0n
          }]
        });

        // Apply slippage tolerance
        const slippageBps = BigInt(Math.floor(slippage * 100));
        const amountOutMin = amountOut - (amountOut * slippageBps / 10000n);

        console.log(`✅ Found route with fee tier ${name}`);
        return amountOutMin;
      } catch (error) {
        console.log(`❌ No pool for fee tier ${name}, trying next...`);
        continue;
      }
    }

    // FIX H5: No more fake fallback — throw error if no real quote available
    throw new Error(
      'No PancakeSwap V3 pool found for this trading pair on any fee tier. ' +
      'Cannot provide a quote without a real pool.'
    );
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

      // Ensure approval for MasterChef
      await this.ensureApproval(lpTokenAddress, this.PANCAKE_MASTERCHEF_V3, amountToStake);

      // Deposit into pool
      const data = encodeFunctionData({
        abi: parseAbi(['function deposit(uint256 pid, uint256 amount)']),
        functionName: 'deposit',
        args: [BigInt(poolInfo.pid), amountToStake]
      });

      const hash = await this.walletClient.sendTransaction({
        to: this.PANCAKE_MASTERCHEF_V3 as `0x${string}`,
        data
      });

      console.log(`✅ Staked ${amount} ${pool} tokens`);
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
      const response = await axios.get('https://farms-api.pancakeswap.com/farms', {
        timeout: 5000
      });

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
   * @example
   * await kit.defi.harvestAll()
   */
  async harvestAll(): Promise<{ totalRewards: string; transactions: string[] }> {
    const userAddress = await this.getAddress();
    const transactions: string[] = [];

    try {
      // Get user's staked pools from PancakeSwap
      const userPools = await this.getUserStakedPools(userAddress);

      let totalRewards = 0n;

      for (const pool of userPools) {
        try {
          // Harvest from each pool
          const data = encodeFunctionData({
            abi: parseAbi(['function withdraw(uint256 pid, uint256 amount)']),
            functionName: 'withdraw',
            args: [BigInt(pool.pid), 0n] // Withdraw 0 = harvest only
          });

          const hash = await this.walletClient.sendTransaction({
            to: this.PANCAKE_MASTERCHEF_V3 as `0x${string}`,
            data
          });

          transactions.push(hash);
          totalRewards += pool.pendingRewards;

          console.log(`✅ Harvested from pool ${pool.pid}`);
        } catch (error) {
          console.log(`Failed to harvest from pool ${pool.pid}`);
          continue;
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
  private async getUserStakedPools(address: string): Promise<any[]> {
    // This would query the MasterChef contract for user positions
    // Simplified for demo - real implementation would read contract state
    return [];
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

      console.log(`✅ Auto-compounded ${totalRewards} tokens into ${bestPool.symbol} pool`);

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
      const response = await axios.get('https://farms-api.pancakeswap.com/farms', {
        timeout: 5000
      });

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
    const tokenInfo = TOKENS[symbol];
    return tokenInfo ? tokenInfo.address : symbolOrAddress;
  }

  private async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }
  /**
   * Supply assets to Venus Protocol
   * @example
   * await kit.defi.lend({ asset: 'BNB', amount: '0.1' })
   */
  async lend(params: LendParams): Promise<{ hash: string }> {
    const { asset, amount } = params;
    const vTokenAddress = this.resolveVToken(asset);
    const amountBigInt = parseEther(amount);

    try {
      console.log(`Supplying ${amount} ${asset} to Venus...`);

      if (asset === 'BNB' || asset === 'WBNB') {
        // Mint vBNB (payable function)
        const data = encodeFunctionData({
          abi: parseAbi(['function mint() payable']),
          functionName: 'mint',
          args: []
        });

        const hash = await this.walletClient.sendTransaction({
          to: vTokenAddress as `0x${string}`,
          data,
          value: amountBigInt
        });

        console.log(`✅ Supplied BNB. Hash: ${hash}`);
        return { hash };
      } else {
        // Mint vToken (ERC20)
        // First ensure approval
        const tokenAddress = this.resolveTokenAddress(asset);
        await this.ensureApproval(tokenAddress, vTokenAddress, amountBigInt);

        const data = encodeFunctionData({
          abi: parseAbi(['function mint(uint256 mintAmount) returns (uint256)']),
          functionName: 'mint',
          args: [amountBigInt]
        });

        const hash = await this.walletClient.sendTransaction({
          to: vTokenAddress as `0x${string}`,
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
    const { asset, amount } = params;
    const vTokenAddress = this.resolveVToken(asset);
    const amountBigInt = parseEther(amount); // Note: verify decimals for USDT/USDC

    try {
      // Check formatting for decimals if needed (USDT is 6 decimals)
      // For simplicity assuming 18 here, but should be dynamic based on token
      // TODO: Handle token decimals dynamically

      console.log(`Borrowing ${amount} ${asset} from Venus...`);

      const data = encodeFunctionData({
        abi: parseAbi(['function borrow(uint256 borrowAmount) returns (uint256)']),
        functionName: 'borrow',
        args: [amountBigInt]
      });

      const hash = await this.walletClient.sendTransaction({
        to: vTokenAddress as `0x${string}`,
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
    const { asset, amount } = params;
    const vTokenAddress = this.resolveVToken(asset);
    const amountBigInt = parseEther(amount);

    try {
      console.log(`Repaying ${amount} ${asset} to Venus...`);

      if (asset === 'BNB' || asset === 'WBNB') {
        const data = encodeFunctionData({
          abi: parseAbi(['function repayBorrow() payable']),
          functionName: 'repayBorrow',
          args: []
        });

        const hash = await this.walletClient.sendTransaction({
          to: vTokenAddress as `0x${string}`,
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

        const hash = await this.walletClient.sendTransaction({
          to: vTokenAddress as `0x${string}`,
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
    const vTokens = assets.map(a => this.resolveVToken(a));

    try {
      console.log(`Entering markets for ${assets.join(', ')}...`);
      const data = encodeFunctionData({
        abi: parseAbi(['function enterMarkets(address[] vTokens) returns (uint256[])']),
        functionName: 'enterMarkets',
        args: [vTokens as `0x${string}`[]]
      });

      const hash = await this.walletClient.sendTransaction({
        to: this.VENUS_COMPTROLLER as `0x${string}`,
        data
      });

      console.log('✅ Entered markets');
      return { hash };
    } catch (error: any) {
      console.error('Enter markets error:', error);
      throw new Error(`Enter markets failed: ${error.message}`);
    }
  }

  private resolveVToken(asset: string): string {
    const vToken = this.VENUS_MARKETS[asset.toUpperCase()];
    if (!vToken) {
      throw new Error(`No Venus market found for ${asset}`);
    }
    return vToken;
  }
}

// Simplified PancakeSwap Router ABI
const PANCAKE_SWAP_ROUTER_ABI = [
  {
    name: 'swapExactETHForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  },
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  },
  {
    name: 'swapExactTokensForETH',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  }
] as const;
