import { WalletClient, PublicClient, createPublicClient, http } from 'viem';
import { opBNB } from 'viem/chains';
import { DeFiModule } from './defi';
import { NFTModule } from './nft';
import { SecurityModule } from './security';
import { WalletModule } from './wallet';
import { GasModule } from './gas';
import { AnalyticsModule } from './analytics';

import { ClawKitConfig, ClawKitWalletClient } from './types';

export class ClawKit {
  public readonly defi: DeFiModule;
  public readonly nft: NFTModule;
  public readonly security: SecurityModule;
  public readonly wallet: WalletModule;
  public readonly gas: GasModule;
  public readonly analytics: AnalyticsModule;

  private readonly walletClient: ClawKitWalletClient;
  private readonly publicClient: PublicClient;
  private readonly config: ClawKitConfig;

  constructor(walletClient: ClawKitWalletClient, config: ClawKitConfig) {
    this.walletClient = walletClient;
    this.config = config;

    // Setup public client for reading blockchain state
    this.publicClient = createPublicClient({
      chain: opBNB,
      transport: http(config.rpcUrl || 'https://opbnb-mainnet-rpc.bnbchain.org')
    });

    // Initialize all modules
    this.defi = new DeFiModule(walletClient, this.publicClient, config);
    this.nft = new NFTModule(walletClient, this.publicClient, config);
    this.security = new SecurityModule(walletClient, this.publicClient, config);
    this.wallet = new WalletModule(walletClient, this.publicClient, config);
    this.gas = new GasModule(walletClient, this.publicClient, config);
    this.analytics = new AnalyticsModule(walletClient, this.publicClient, config);
  }

  /**
   * Get the current account address
   */
  async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }

  /**
   * Get the current chain ID
   */
  async getChainId(): Promise<number> {
    return await this.walletClient.getChainId();
  }

  /**
   * Check if connected to opBNB
   */
  async isOpBNB(): Promise<boolean> {
    const chainId = await this.getChainId();
    return chainId === opBNB.id;
  }
}

// Export all modules for direct use
export * from './defi';
export * from './nft';
export * from './security';
export * from './wallet';
export * from './gas';
export * from './analytics';

// Export types
export * from './types';

export * from './eidolon';
export * from './connectors';

// Default export
export default ClawKit;
