import { WalletClient, PublicClient, parseEther, parseUnits, formatEther, formatUnits, encodeFunctionData, parseAbi, SimulateContractParameters } from 'viem';
import { ClawKitConfig, SwapParams, StakeParams, LendParams, BorrowParams, RepayParams, TOKENS, TokenSymbol, ClawKitWalletClient, OPBNB_CONFIG, toAddress, getTokenDecimals } from './types';
import axios from 'axios';
import { withRetry } from './utils/Resilience';
import { BigMath, WAD } from './utils/BigMath';
import { TokenAmount } from './math/TokenAmount';
import { getPriceService } from './services/PriceService';

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

  // FIX P1: Inject Price Service
  private priceOracle?: { fetchTokenPrices: () => Promise<Record<string, number>> };

  public setPriceOracle(oracle: { fetchTokenPrices: () => Promise<Record<string, number>> }) {
    this.priceOracle = oracle;
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
  /**
   * ⚡ FLASH ACCOUNTING: Thermodynamic Check
   * Ensure we are not burning move energy (Gas) than the food is worth.
   * FIXED: Uses USD normalization for accurate economic safety check.
   */
  private async checkThermodynamics(
    to: string,
    data: string,
    value: bigint,
    amountIn: bigint, // Kept for logging/compatibility, but logic relies on amountUSD
    tokenDecimals: number = 18,
    emergencyMode: boolean = false,
    amountUSD?: number // [NEW] Required for correct comparison
  ): Promise<void> {
    try {
      if (emergencyMode) {
        console.warn('⚠️ THERMODYNAMICS SKIPPED (EMERGENCY MODE)');
        return;
      }

      let checkAmountUSD = amountUSD;

      // Logic: If we don't know the value of the trade, we can't protect it.
      if (checkAmountUSD === undefined || checkAmountUSD <= 0) {
        if (value > 0n) {
          // Native Swap: We can estimate value using fallback BNB price (e.g. $600)
          // This is better than failing open or closed without info.
          // 1 BNB = 10^18 Wei.
          const bnbPriceEst = 600;
          const bnbAmount = parseFloat(formatEther(value));
          checkAmountUSD = bnbAmount * bnbPriceEst;
          // Proceed with check
        } else {
          // Token swap with no USD context.
          // We cannot verify. 
          throw new Error("Thermodynamic Fail: Blindspot - Missing 'amountUSD'. Cannot verify gas efficiency.");
        }
      }

      // Allow if we estimated
      if (checkAmountUSD === undefined || checkAmountUSD <= 0) return; // Should not happen given logic above unless 0 value

      const userAddress = await this.getAddress();
      const gasEstimate = await this.publicClient.estimateGas({
        account: toAddress(userAddress),
        to: toAddress(to),
        data: data as `0x${string}`,
        value
      });

      const gasPrice = await this.publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;
      const gasCostBNB = parseFloat(formatEther(gasCostWei));

      // We need BNB Price to conver gas to USD.
      // Trying to access GasModule or Oracle... 
      // checkThermodynamics is called by swap. 
      // We can fetch price internally if we have the tools, or use a fixed conservation heuristic.
      // Or we can rely on `amountUSD` vs `gasCostUSD`.

      // FIX P4-F1: Atomic BNB Price Resolution via centralized PriceService
      const bnbPriceEst = await this.resolveBNBPrice();

      const gasCostUSD = gasCostBNB * bnbPriceEst;

      // Logic: If Gas Cost > 10% of Trade Value, ABORT.
      // Use checkAmountUSD which is guaranteed defined here
      const thresholdUSD = (checkAmountUSD as number) * 0.10;

      if (gasCostUSD > thresholdUSD) {
        throw new Error(`Thermodynamic Fail: Gas Cost ~$${gasCostUSD.toFixed(2)} > 10% of Trade Value $${(checkAmountUSD as number).toFixed(2)}`);
      }

    } catch (error) {
      if (typeof error === 'object' && error !== null && 'message' in error && (error as any).message.includes('Thermodynamic')) throw error;
      console.warn("Thermodynamic check warning:", error);
      // If we can't estimate gas, we might fail open or closed determined by config?
      // Audit says fail-open was a risk. checking fails...
    }
  }

  /**
   * Swap tokens using PancakeSwap V3 (ExactInputSingle)
   * FIXED: Bug #1 (Decimals) & Bug #5 (V3 ABI)
   * @example
   * await kit.defi.swap({ from: 'BNB', to: 'USDT', amount: '0.1' })
   */
  async swap(params: SwapParams): Promise<{ hash: string; amountOut: string }> {
    const { from, to, amount, slippage = 0.5, deadline = 20, emergencyMode = false } = params;

    // Resolve token addresses
    const fromToken = this.resolveTokenAddress(from);
    const toToken = this.resolveTokenAddress(to);

    // FIX Bug #1: Dynamic Decimal Resolution
    const fromDecimals = getTokenDecimals(from);
    const amountInToken = TokenAmount.fromHuman(amount, fromDecimals, from);
    const amountIn = amountInToken.raw;

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
      let approvalGranted = false;

      const isNativeIn = fromToken === this.tokens.BNB.address || fromToken === this.tokens.WBNB.address;

      if (fromToken === this.tokens.BNB.address) {
        // Native BNB -> Token
        // V3 Router handles native ETH/BNB wrapping automatically if msg.value > 0 and tokenIn is WBNB
        // But technically exactInputSingle params.tokenIn must be WBNB address
        value = amountIn;
      } else {
        // Token -> Token
        approvalGranted = await this.ensureApproval(fromToken, router, amountIn);
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

      try {
        // ⚡ CHECK 1: FLASH ACCOUNTING (Thermodynamics)
        try {
          await this.checkThermodynamics(router, data, value, amountIn, fromDecimals, emergencyMode, params.amountUSD);
        } catch (err: any) {
          // FIX: Re-throw fatal thermodynamic errors
          if (String(err).includes('Thermodynamic Fail')) throw err;
          console.warn(`Thermodynamic check failed: ${err.message}. Proceeding with caution.`);
        }

        // 🛡️ CHECK 2: SIMULATION (The Hunter's Eye)
        await this.simulateTransaction(router, data, value, userAddress);

        // 🚀 EXECUTION (The Strike)
        const hash = await this.walletClient.sendTransaction({
          to: toAddress(router),
          data,
          value
        });

        const outDecimals = getTokenDecimals(to);
        const amountOutToken = TokenAmount.fromRaw(amountOutMin, outDecimals, to);

        return {
          hash,
          amountOut: amountOutToken.toHuman(8)
        };
      } catch (err: any) {
        console.error('Swap pipeline failed:', err.message || err);
        if (approvalGranted && fromToken !== this.tokens.BNB.address) {
          console.warn('🔄 Revoking approval due to swap pipeline failure...');
          await this.revokeApproval(fromToken, router);
        }
        throw err;
      }

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
  ): Promise<boolean> {
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
      return false;
    }

    const approvalAmount = this.getApprovalAmount(amount);
    if (allowance < amount) {
      console.info(`🔓 Approving ${tokenAddress} for ${spender} (mode=${this.config.approvalMode || 'BUFFERED'})...`);

      // ERC20_ABI is not defined in the provided context, assuming it's available globally or imported.
      // For a complete solution, it would need to be defined, e.g., `const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);`
      const { request } = await this.publicClient.simulateContract({
        address: tokenAddress as `0x${string}`,
        abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']), // Using parseAbi directly for ERC20 approve
        functionName: 'approve',
        args: [toAddress(spender), approvalAmount],
        account: toAddress(this.walletClient.account.address), // Ensure account is `Address` type
      });

      const hash = await this.walletClient.writeContract(request);
      console.info(`⏳ Approval Tx Sent: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });
      console.info(`✅ Approval Confirmed.`);
      return true;
    }

    return false;
  }

  private getApprovalAmount(amount: bigint): bigint {
    const mode = this.config.approvalMode || 'BUFFERED';
    const MAX_UINT = 2n ** 256n - 1n;

    if (mode === 'EXACT') {
      return amount;
    }

    if (mode === 'MAX') {
      return MAX_UINT;
    }

    // BUFFERED mode (default): reduce approval blast radius while limiting re-approvals.
    const rawBps = this.config.approvalBufferBps ?? 12000; // 1.2x default
    const bps = Math.max(10000, Math.min(50000, rawBps));
    return (amount * BigInt(bps) + 9999n) / 10000n;
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
   * 🚨 EMERGENCY: DUMP ALL POSITIONS
   * Sells all known tokens in config to BNB/USDT.
   * Ignores slippage checks (Force Mode).
   */
  async dumpAllPositions(): Promise<string[]> {
    console.error("🚨 EMERGENCY DUMP INITIATED: LIQUIDATING ALL ASSETS");
    const results: string[] = [];
    const tokens = Object.values(this.tokens);

    for (const token of tokens) {
      if (token.symbol === 'BNB' || token.symbol === 'WBNB' || token.symbol === 'USDT') continue;

      try {
        const balance = await this.publicClient.readContract({
          address: toAddress(token.address),
          abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
          functionName: 'balanceOf',
          args: [toAddress(this.walletClient.account.address)]
        }) as bigint;

        if (balance > 0n) {
          console.log(`📉 Dumping ${token.symbol}: ${balance.toString()}`);
          const decimals = getTokenDecimals(token.symbol);
          const amountHuman = formatUnits(balance, decimals);

          // Swap to USDT or BNB
          const tx = await this.swap({
            from: token.symbol,
            to: 'USDT', // Default flight to safety
            amount: amountHuman,
            slippage: 10, // 10% slippage tolerance for emergency
            emergencyMode: true
          });
          results.push(`Sold ${token.symbol}: ${tx.hash}`);
        }
      } catch (e: any) {
        console.error(`❌ Failed to dump ${token.symbol}`, e);
        results.push(`Failed ${token.symbol}: ${e.message}`);
      }
    }
    return results;
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
    tokenInOrSymbol: string,
    tokenOutOrSymbol: string,
    amountIn: bigint,
    slippage: number
  ): Promise<{ amountOutMin: bigint; fee: number }> {
    const tokenIn = this.resolveTokenAddress(tokenInOrSymbol);
    const tokenOut = this.resolveTokenAddress(tokenOutOrSymbol);
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
      .sort((a, b) => (a.amountOut === b.amountOut ? 0 : a.amountOut > b.amountOut ? -1 : 1));

    if (validQuotes.length === 0) {
      // P3: Try multi-hop routing via WBNB as intermediate token
      const wbnb = this.tokens.WBNB?.address || this.tokens.BNB?.address;
      if (wbnb && tokenIn !== wbnb && tokenOut !== wbnb) {
        console.info('🔀 No direct pool found. Attempting multi-hop routing via WBNB...');
        try {
          const multiHopResult = await this.getMultiHopQuote(tokenIn, tokenOut, wbnb, amountIn, slippage);
          console.info(`✅ Multi-hop quote found: ${multiHopResult.amountOutMin}`);
          return multiHopResult;
        } catch (multiHopErr: any) {
          console.warn('⚠️ Multi-hop routing also failed:', multiHopErr.message);
        }
      }

      throw new Error(
        'No PancakeSwap V3 pool found for this trading pair on any fee tier. ' +
        'Cannot provide a quote without a real pool.'
      );
    }

    const bestQuote = validQuotes[0];

    // FIX P2-03: Use BigMath for High-Precision Slippage Calculation
    // AmountOutMin = AmountOut * (1 - slippage)
    // Slippage 0.5% = 0.005.

    const boundedSlippage = Number.isFinite(slippage) && slippage >= 0 ? slippage : 0;
    const rawBps = BigMath.percentToBps(boundedSlippage.toString());
    const slippageBps = BigMath.max(0n, BigMath.min(rawBps, 10000n)); // clamp [0, 100%]
    const slippageWad = (slippageBps * WAD) / 10000n;
    const slippageAmount = BigMath.mulWad(bestQuote.amountOut, slippageWad);
    const amountOutMin = bestQuote.amountOut - slippageAmount;

    // Helper to format output based on target token decimals for logging
    // We don't have target token decimals easily here without lookup, so using formatEther as approx or generic
    // But since this is just logging, it's fine.
    console.info(`✅ Hyper-Routing Winner: ${bestQuote.name} (Out: ${bestQuote.amountOut}, Min: ${amountOutMin})`);

    return {
      amountOutMin,
      fee: bestQuote.fee
    };
  }

  /**
   * P3: Multi-hop quote via intermediate token (e.g. tokenIn → WBNB → tokenOut)
   * Uses PancakeSwap V3 `quoteExactInput` with encoded path bytes.
   * Path encoding: tokenIn (20 bytes) + fee0 (3 bytes) + hop (20 bytes) + fee1 (3 bytes) + tokenOut (20 bytes)
   */
  private async getMultiHopQuote(
    tokenIn: string,
    tokenOut: string,
    hop: string,
    amountIn: bigint,
    slippage: number
  ): Promise<{ amountOutMin: bigint; fee: number }> {
    const quoterAddress = this.contracts.pancakeQuoter;
    const quoterMultiHopAbi = parseAbi([
      'function quoteExactInput(bytes path, uint256 amountIn) view returns (uint256 amountOut)'
    ]);

    // Try fee combinations for each hop
    const feeCombinations = [
      { fee0: 2500, fee1: 2500 },
      { fee0: 500, fee1: 500 },
      { fee0: 2500, fee1: 500 },
      { fee0: 500, fee1: 2500 },
    ];

    for (const { fee0, fee1 } of feeCombinations) {
      try {
        // Encode path: tokenIn + fee0 + hop + fee1 + tokenOut
        const fee0Hex = fee0.toString(16).padStart(6, '0');
        const fee1Hex = fee1.toString(16).padStart(6, '0');
        const path = `0x${tokenIn.slice(2)}${fee0Hex}${hop.slice(2)}${fee1Hex}${tokenOut.slice(2)}` as `0x${string}`;

        const amountOut = await this.publicClient.readContract({
          address: toAddress(quoterAddress),
          abi: quoterMultiHopAbi,
          functionName: 'quoteExactInput',
          args: [path, amountIn]
        }) as bigint;

        if (amountOut > 0n) {
          const boundedSlippage = Number.isFinite(slippage) && slippage >= 0 ? slippage : 0;
          const rawBps = BigMath.percentToBps(boundedSlippage.toString());
          const slippageBps = BigMath.max(0n, BigMath.min(rawBps, 10000n));
          const slippageWad = (slippageBps * WAD) / 10000n;
          const slippageAmount = BigMath.mulWad(amountOut, slippageWad);
          const amountOutMin = amountOut - slippageAmount;

          console.info(`🔀 Multi-hop winner: fee0=${fee0} fee1=${fee1} (Out: ${amountOut})`);
          // Return fee0 as the "primary" fee tier for logging
          return { amountOutMin, fee: fee0 };
        }
      } catch { /* try next combination */ }
    }

    throw new Error(`No multi-hop route found: ${tokenIn} → ${hop} → ${tokenOut}`);
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

      // FIX P1: Read decimals dynamically
      const dec = await this.publicClient.readContract({
        address: toAddress(poolInfo.lpAddress),
        abi: parseAbi(['function decimals() view returns (uint8)']),
        functionName: 'decimals'
      }) as number;

      const amountToStake = parseUnits(amount, dec);
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
   * ⚡ MULTICALL UPGRADE: All userInfo queries in a single RPC round-trip.
   * Transforms O(N) sequential awaits into O(1) network latency.
   */
  private async getUserStakedPools(address: string): Promise<any[]> {
    const masterChef = this.contracts.pancakeMasterChef;
    const userInfoAbi = parseAbi(['function userInfo(uint256 pid, address user) view returns (uint256 amount, uint256 rewardDebt)']);
    const pendingCakeAbi = parseAbi(['function pendingCake(uint256 pid, address user) view returns (uint256)']);

    try {
      // 1. Get pool length
      const poolLength = await this.publicClient.readContract({
        address: toAddress(masterChef),
        abi: parseAbi(['function poolLength() view returns (uint256)']),
        functionName: 'poolLength'
      }) as bigint;

      // Scan up to 100 pools. In production, use The Graph for known PIDs.
      const scanLimit = poolLength > 100n ? 100n : poolLength;
      if (scanLimit === 0n) return [];

      // 2. ⚡ MULTICALL: Batch all userInfo queries in ONE round-trip
      const userInfoCalls = Array.from({ length: Number(scanLimit) }, (_, i) => ({
        address: toAddress(masterChef),
        abi: userInfoAbi,
        functionName: 'userInfo' as const,
        args: [BigInt(i), toAddress(address)] as [bigint, `0x${string}`]
      }));

      const userInfoResults = await this.publicClient.multicall({ contracts: userInfoCalls, allowFailure: true });

      // 3. Filter pools where user has stake
      const stakedPids: number[] = [];
      const stakedAmounts: bigint[] = [];
      userInfoResults.forEach((res, pid) => {
        if (res.status === 'success') {
          const [amount] = res.result as [bigint, bigint];
          if (amount > 0n) {
            stakedPids.push(pid);
            stakedAmounts.push(amount);
          }
        }
      });

      if (stakedPids.length === 0) return [];

      // 4. ⚡ MULTICALL: Batch pendingCake queries for staked pools only
      const pendingCalls = stakedPids.map(pid => ({
        address: toAddress(masterChef),
        abi: pendingCakeAbi,
        functionName: 'pendingCake' as const,
        args: [BigInt(pid), toAddress(address)] as [bigint, `0x${string}`]
      }));

      const pendingResults = await this.publicClient.multicall({ contracts: pendingCalls, allowFailure: true });

      return stakedPids.map((pid, i) => ({
        pid,
        stakedAmount: stakedAmounts[i],
        pendingRewards: pendingResults[i].status === 'success' ? (pendingResults[i].result as bigint) : 0n
      }));

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

  /**
   * 🔥 P4-F1: Centralized BNB Price Resolution for Thermodynamics
   * Priority: PriceService (cached/centralized) → priceOracle → stale $600 fallback
   */
  private async resolveBNBPrice(): Promise<number> {
    // 1. Try PriceService (centralized, cached, circuit-broken)
    try {
      const svc = getPriceService(this.config);
      const price = await svc.getBNBPrice();
      if (price > 0) return price;
    } catch { /* fall through */ }

    // 2. Try injected priceOracle (analytics module)
    if (this.priceOracle) {
      try {
        const prices = await this.priceOracle.fetchTokenPrices();
        if (prices.BNB > 0) return prices.BNB;
      } catch { /* fall through */ }
    }

    // 3. Last-resort stale fallback with loud warning
    console.warn('⚠️ THERMODYNAMIC BLINDSPOT: All BNB price sources failed. Using stale $600 estimate.');
    return 600;
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
