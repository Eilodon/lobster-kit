import { WalletClient, PublicClient, createPublicClient, http, isAddress } from 'viem';
import { opBNB } from 'viem/chains';
import { DeFiModule } from './defi';
import { NFTModule } from './nft';
import { SecurityModule } from './security';
import { WalletModule } from './wallet';
import { GasModule } from './gas';
import { AnalyticsModule } from './analytics';
import { EidolonSwarm } from './eidolon/swarm/EidolonSwarm';
import { MarketStream } from './eidolon/sensors/MarketStream';
import { EidolonBus, EidolonEventType } from './eidolon/events/EidolonBus';

import { ClawKitConfig, ClawKitWalletClient, OPBNB_CONFIG } from './types';
import { verifyConfigIntegrity } from './utils/ConfigIntegrity';

export class ClawKit {
  public readonly defi: DeFiModule;
  public readonly nft: NFTModule;
  public readonly security: SecurityModule;
  public readonly wallet: WalletModule;
  public readonly gas: GasModule;
  public readonly analytics: AnalyticsModule;
  public readonly swarm: EidolonSwarm;
  public readonly marketStream: MarketStream;

  public readonly walletClient: ClawKitWalletClient;
  public readonly publicClient: PublicClient;
  public readonly config: ClawKitConfig;

  constructor(walletClient: ClawKitWalletClient, config: ClawKitConfig) {
    this.validateConfig(config); // 🛡️ Zero-Trust Boot

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

    // Initialize Hive Mind
    this.swarm = new EidolonSwarm();

    // Initialize Sensory System (Market Stream)
    this.marketStream = new MarketStream();
    this.setupSensoryLinks();
  }

  private setupSensoryLinks() {
    // 🧠 Wire Reflexes: Market Stream -> Nervous System (Bus)
    this.marketStream.on('price', (data) => {
      EidolonBus.getInstance().emitEvent({
        type: EidolonEventType.PRICE_UPDATE,
        timestamp: data.time,
        payload: {
          symbol: data.symbol,
          price: data.price,
          source: 'BINANCE_WS'
        }
      });
    });

    // Start listening if configured (or default auto-start?)
    // For now, let's auto-start to ensure aliveness.
    this.marketStream.start();
  }

  /**
   * 🛡️ ATOMIC CONFIG VALIDATION
   * Prevents runtime failures by ensuring rigorous config integrity at boot.
   */
  private validateConfig(config: ClawKitConfig) {
    verifyConfigIntegrity(config, 'ClawKit');

    if (!config.chainConfig) {
      console.warn("⚠️ ChainConfig missing - Defaulting to opBNB (Standard Mode)");
      config.chainConfig = OPBNB_CONFIG; // FIX U8: Apply defaults instead of skipping validation
    }

    // validate contracts
    for (const [key, addr] of Object.entries(config.chainConfig.contracts)) {
      if (typeof addr === 'string' && addr && !isAddress(addr)) {
        throw new Error(`💥 ATOMIC CRASH: Invalid contract address for '${key}': ${addr}`);
      }
    }

    // validate tokens
    for (const [symbol, info] of Object.entries(config.chainConfig.tokens)) {
      if (!isAddress(info.address)) {
        throw new Error(`💥 ATOMIC CRASH: Invalid token address for '${symbol}': ${info.address}`);
      }
    }
    console.log("🛡️ ATOMIC CONFIG: Integrity Verified.");
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
export * from './math/TokenAmount';
export * from './math/Q64x96';

export * from './eidolon';
export * from './connectors';

// Default export
export default ClawKit;
