import { AnalyticsModule as BaseAnalyticsModule } from '@clawkit/defi-bnb';
import axios from 'axios';

type PriceMap = Record<string, number>;

/**
 * Compatibility shim for integration tests:
 * keeps axios-based fetch path so vi.mock('axios') remains reliable.
 */
export class AnalyticsModule extends BaseAnalyticsModule {
  private readonly COINGECKO_API = 'https://api.coingecko.com/api/v3';
  private readonly CACHE_DURATION = 60_000;
  private priceCache: { token_prices?: { value: PriceMap; timestamp: number } } = {};

  public async fetchTokenPrices(): Promise<PriceMap> {
    const cacheKey = 'token_prices';
    const cached = this.priceCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.value;
    }

    try {
      const response = await axios.get(`${this.COINGECKO_API}/simple/price`, {
        params: {
          ids: 'binancecoin,usd-coin,tether,pancakeswap-token,bitcoin,ethereum',
          vs_currencies: 'usd',
          include_24hr_change: true
        },
        timeout: 5000
      });

      const prices: PriceMap = {
        BNB: response.data.binancecoin?.usd || 0,
        WBNB: response.data.binancecoin?.usd || 0,
        USDT: response.data.tether?.usd || 1,
        USDC: response.data['usd-coin']?.usd || 1,
        BUSD: 1,
        CAKE: response.data['pancakeswap-token']?.usd || 0,
        BTC: response.data.bitcoin?.usd || 0,
        ETH: response.data.ethereum?.usd || 0
      };

      this.priceCache[cacheKey] = { value: prices, timestamp: Date.now() };
      return prices;
    } catch (error: unknown) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { status?: unknown } }).response?.status === 'number'
          ? (error as { response: { status: number } }).response.status
          : undefined;

      if (status === 429 && cached) {
        return cached.value;
      }

      return {
        BNB: 600,
        WBNB: 600,
        USDT: 1,
        USDC: 1,
        BUSD: 1,
        CAKE: 2.5
      };
    }
  }
}
