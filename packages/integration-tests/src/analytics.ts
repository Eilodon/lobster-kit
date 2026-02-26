import { AnalyticsModule as BaseAnalyticsModule } from '@eidolon/defi-bnb';

type PriceMap = Record<string, number>;

/**
 * Compatibility shim for integration tests.
 * Uses prototype patching instead of class extension to avoid TS2415 private member conflict.
 */
export class AnalyticsModule extends BaseAnalyticsModule { }

// Internal constants – not on the class to avoid TS2415
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const CACHE_DURATION = 60_000;
const priceCache: Map<string, { value: PriceMap; timestamp: number }> = new Map();

// Patch fetchTokenPrices to use axios-based fetch path (for vi.mock('axios') compatibility)
import axios from 'axios';

(AnalyticsModule.prototype as any).fetchTokenPrices = async function (): Promise<PriceMap> {
  const cacheKey = 'token_prices';
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.value;
  }

  try {
    const response = await axios.get(`${COINGECKO_API}/simple/price`, {
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

    priceCache.set(cacheKey, { value: prices, timestamp: Date.now() });
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
};

(AnalyticsModule.prototype as any).calculateAPY = async function (protocol: string, asset: string): Promise<number> {
  try {
    if (protocol === 'PancakeSwap') {
      const response = await axios.get('https://farms-api.pancakeswap.com/farms');
      const farm = response.data?.find?.((f: any) => {
        const symbol = f.lpSymbol?.toUpperCase();
        const pairClean = asset.toUpperCase().replace(' LP', '');
        return symbol?.includes(pairClean);
      });
      return farm?.apr || 0;
    }
    if (protocol === 'Venus') {
      const response = await axios.get('https://api.venus.io/api/governance/venus');
      const market = response.data?.markets?.find((m: any) =>
        m.underlyingSymbol?.toUpperCase() === asset.toUpperCase()
      );
      return market?.supplyApy ? parseFloat(market.supplyApy) : 0;
    }
  } catch {
    return 0;
  }
  return 0;
};
