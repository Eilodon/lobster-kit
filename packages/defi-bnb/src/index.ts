import { WalletClient, PublicClient, createPublicClient, http, isAddress } from 'viem';
import { opBNB } from 'viem/chains';
import { DeFiModule } from './defi';
import { NFTModule } from './nft';
import { SecurityModule } from './security';
import { WalletModule } from './wallet';
import { GasModule } from './gas';
import { AnalyticsModule } from './analytics';

import { EidolonConfig, EidolonWalletClient, OPBNB_CONFIG } from './types';
import { verifyConfigIntegrity } from './utils/ConfigIntegrity';
import { getPriceService } from './services/PriceService';

/**
 * Eidolon — BNB Chain DeFi Toolkit
 *
 * This is the adapter facade for DeFi operations on opBNB.
 * For Eidolon soul/AI features, use @eidolon/soul.
 * For MCP runtime, use packages/mcp-rust (via `pnpm mcp`).
 */
export class Eidolon {
  public readonly defi: DeFiModule;
  public readonly nft: NFTModule;
  public readonly security: SecurityModule;
  public readonly wallet: WalletModule;
  public readonly gas: GasModule;
  public readonly analytics: AnalyticsModule;

  public readonly walletClient: EidolonWalletClient;
  public readonly publicClient: PublicClient;
  public readonly config: EidolonConfig;

  constructor(walletClient: EidolonWalletClient, config: EidolonConfig) {
    this.validateConfig(config);

    this.walletClient = walletClient;
    this.config = config;

    this.publicClient = createPublicClient({
      chain: opBNB,
      transport: http(config.rpcUrl || 'https://opbnb-mainnet-rpc.bnbchain.org')
    });

    // Initialize DeFi modules
    // Initialize DeFi modules
    this.security = new SecurityModule(walletClient, this.publicClient, config);
    this.defi = new DeFiModule(walletClient, this.publicClient, config, this.security);
    this.nft = new NFTModule(walletClient, this.publicClient, config);
    this.wallet = new WalletModule(walletClient, this.publicClient, config);
    this.gas = new GasModule(walletClient, this.publicClient, config);
    this.analytics = new AnalyticsModule(walletClient, this.publicClient, config);

    // Wire analytics as price oracle
    this.defi.setPriceOracle(this.analytics);

    // Wire PriceService
    const priceService = getPriceService(config);
    priceService.setOracle(this.analytics);
    if (typeof (this.gas as any).setPriceService === 'function') {
      this.gas.setPriceService(priceService);
    } else {
      console.warn('⚠️ Gas module does not expose setPriceService; skipping PriceService injection.');
    }
  }

  private validateConfig(config: EidolonConfig) {
    verifyConfigIntegrity(config, 'Eidolon');

    if (!config.chainConfig) {
      console.warn("⚠️ ChainConfig missing - Defaulting to opBNB (Standard Mode)");
      config.chainConfig = OPBNB_CONFIG;
    }

    for (const [key, addr] of Object.entries(config.chainConfig.contracts)) {
      if (typeof addr === 'string' && addr && !isAddress(addr)) {
        throw new Error(`💥 ATOMIC CRASH: Invalid contract address for '${key}': ${addr}`);
      }
    }

    for (const [symbol, info] of Object.entries(config.chainConfig.tokens)) {
      if (!isAddress(info.address)) {
        throw new Error(`💥 ATOMIC CRASH: Invalid token address for '${symbol}': ${info.address}`);
      }
    }
    console.log("🛡️ ATOMIC CONFIG: Integrity Verified.");
  }

  async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }

  async getChainId(): Promise<number> {
    return await this.walletClient.getChainId();
  }

  async isOpBNB(): Promise<boolean> {
    const chainId = await this.getChainId();
    return chainId === opBNB.id;
  }
}

// Export all DeFi modules
export * from './defi';
export * from './nft';
export * from './security';
export * from './wallet';
export * from './gas';
export * from './analytics';
export * from './types';
export * from './math/TokenAmount';
export * from './math/Q64x96';
export * from './services/PriceService';
export * from './utils/ApiGateway';
export * from './adapters/OpBnbDefiAdapter';

export default Eidolon;
