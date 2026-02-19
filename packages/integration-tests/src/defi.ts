import { DeFiModule as BaseDeFiModule } from '@clawkit/defi-bnb';

type PriceOracle = {
  fetchTokenPrices: () => Promise<Record<string, number>>;
};

/**
 * Compatibility shim for integration tests:
 * prioritize injected oracle before live PriceService so tests remain deterministic.
 */
export class DeFiModule extends BaseDeFiModule {
  private async resolveBNBPrice(): Promise<number> {
    const oracle = (this as unknown as { priceOracle?: PriceOracle }).priceOracle;
    if (oracle) {
      try {
        const prices = await oracle.fetchTokenPrices();
        const bnb = prices.BNB;
        if (typeof bnb === 'number' && Number.isFinite(bnb) && bnb > 0) {
          return bnb;
        }
      } catch {
        // Fall through to the base resolver for fallback handling.
      }
    }

    return await (BaseDeFiModule.prototype as unknown as { resolveBNBPrice: () => Promise<number> }).resolveBNBPrice.call(this);
  }
}
