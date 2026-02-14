import { PublicClient, parseEther, formatEther, parseUnits, formatUnits, encodeFunctionData } from 'viem';
import { ClawKitConfig, TransferParams, TOKENS, getTokenDecimals, resolveTokenAddress, toAddress, type TokenInfo, type ClawKitWalletClient } from './types';

export class WalletModule {
  constructor(
    private walletClient: ClawKitWalletClient,
    private publicClient: PublicClient,
    private config: ClawKitConfig
  ) { }

  /**
   * Send BNB or tokens
   * @example
   * await kit.wallet.send({ to: '0x...', amount: '0.1' }) // BNB
   * await kit.wallet.send({ token: 'USDT', to: '0x...', amount: '10' }) // USDT
   */
  async send(params: TransferParams): Promise<{ hash: string }> {
    const { token, to, amount } = params;

    // Send BNB
    if (!token) {
      const hash = await this.walletClient.sendTransaction({
        to: toAddress(to),
        value: parseEther(amount)
      });
      return { hash };
    }

    // Send ERC20 token
    // FIX H4: Use per-token decimals instead of universal 18
    const tokenAddress = resolveTokenAddress(token);
    const decimals = getTokenDecimals(token);

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [toAddress(to), parseUnits(amount, decimals)]
    });

    const hash = await this.walletClient.sendTransaction({
      to: toAddress(tokenAddress),
      data
    });

    return { hash };
  }

  /**
   * Batch send to multiple addresses
   */
  async sendBatch(transfers: TransferParams[]): Promise<{ hashes: string[] }> {
    const hashes: string[] = [];

    for (const transfer of transfers) {
      const { hash } = await this.send(transfer);
      hashes.push(hash);
    }

    return { hashes };
  }

  /**
   * Get BNB balance
   */
  async getBalance(address?: string): Promise<string> {
    const addr = address || await this.getAddress();
    const balance = await this.publicClient.getBalance({ address: toAddress(addr) });
    return formatEther(balance);
  }

  /**
   * Get token balance
   */
  async getTokenBalance(tokenAddress: string, address?: string): Promise<string> {
    const addr = address || await this.getAddress();

    const balance = await this.publicClient.readContract({
      address: toAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [toAddress(addr)]
    }) as bigint;

    // FIX H4: Use per-token decimals for formatting
    const decimals = getTokenDecimals(tokenAddress);
    return formatUnits(balance, decimals);
  }

  /**
   * Get all token balances
   */
  async getAllBalances(address?: string): Promise<Record<string, string>> {
    const addr = address || await this.getAddress();
    const balances: Record<string, string> = {};

    // Get BNB balance
    balances.BNB = await this.getBalance(addr);

    // Get token balances
    for (const [symbol, tokenInfo] of Object.entries(TOKENS) as [string, TokenInfo][]) {
      if (symbol !== 'BNB') {
        try {
          balances[symbol] = await this.getTokenBalance(tokenInfo.address, addr);
        } catch {
          balances[symbol] = '0';
        }
      }
    }

    return balances;
  }

  // Helper methods

  private async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }
}

// ERC20 ABI
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;
