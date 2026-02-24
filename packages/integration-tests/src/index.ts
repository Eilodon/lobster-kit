import { PublicClient, createPublicClient, http } from 'viem';
import { opBNB } from 'viem/chains';
import type { EidolonConfig, EidolonWalletClient } from './types';
import { OPBNB_CONFIG } from './types';
import { DeFiModule } from './defi';
import { NFTModule } from './nft';
import { SecurityModule, WalletModule, GasModule } from '@eidolon/defi-bnb';
import { AnalyticsModule } from './analytics';
import { getPriceService } from './services/PriceService';
import { MarketStream, EidolonSwarm } from '@eidolon/soul';

/**
 * Legacy compatibility facade used by integration tests.
 * Reconstructs old monolith behavior (constructor side-effects + module layout)
 * while internal modules are now sourced from package split outputs.
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
  /** Generic aliases for IEidolon compatibility */
  public readonly readClient: PublicClient;
  public readonly writeClient: EidolonWalletClient;
  public readonly config: EidolonConfig;

  private marketStream?: MarketStream;
  private swarm?: EidolonSwarm;

  constructor(walletClient: EidolonWalletClient, config: EidolonConfig) {
    this.walletClient = walletClient;
    this.config = {
      ...config,
      chainConfig: config.chainConfig || OPBNB_CONFIG
    };

    this.publicClient = createPublicClient({
      chain: opBNB,
      transport: http(this.config.rpcUrl || 'https://opbnb-mainnet-rpc.bnbchain.org')
    });
    this.readClient = this.publicClient;
    this.writeClient = walletClient;

    this.defi = new DeFiModule(walletClient, this.publicClient, this.config);
    this.nft = new NFTModule(walletClient, this.publicClient, this.config);
    this.security = new SecurityModule(walletClient, this.publicClient, this.config);
    this.wallet = new WalletModule(walletClient, this.publicClient, this.config);
    this.gas = new GasModule(walletClient, this.publicClient, this.config);
    this.analytics = new AnalyticsModule(walletClient, this.publicClient, this.config);

    this.defi.setPriceOracle(this.analytics);
    const priceService = getPriceService(this.config);
    priceService.setOracle(this.analytics);
    if (
      this.config.privacyMode !== 'strict' &&
      typeof (this.gas as unknown as { setPriceService?: (svc: unknown) => void }).setPriceService === 'function'
    ) {
      (this.gas as unknown as { setPriceService: (svc: unknown) => void }).setPriceService(priceService);
    }

    if (this.config?.privacyMode !== 'strict') {
      this.marketStream = new MarketStream();
      this.marketStream.start();
      this.swarm = new EidolonSwarm();
    }
  }

  async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }

  async getChainId(): Promise<number> {
    return await this.walletClient.getChainId();
  }

  async isOpBNB(): Promise<boolean> {
    return (await this.getChainId()) === opBNB.id;
  }
}

export default Eidolon;
