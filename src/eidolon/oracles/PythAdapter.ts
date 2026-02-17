
import axios from 'axios';
import { PythConfig } from '../../types';

export class PythAdapter {
    private readonly DEFAULT_ENDPOINT = 'https://hermes.pyth.network';

    constructor(private config?: PythConfig) { }

    private get endpoint(): string {
        return this.config?.endpoint || this.DEFAULT_ENDPOINT;
    }

    /**
     * Get latest price for a symbol
     * @param symbol 'BNB' | 'USDT'
     * @returns Price as number (e.g. 305.50)
     */
    public async getPrice(symbol: 'BNB' | 'USDT'): Promise<number> {
        const feedId = this.config?.priceFeedIds?.[symbol] || this.getDefaultFeedId(symbol);

        try {
            const response = await axios.get(`${this.endpoint}/v2/updates/price/latest`, {
                params: {
                    ids: [feedId],
                    encoding: 'hex',
                    parsed: true
                },
                timeout: 10000 // Robust timeout
            });

            if (response.data?.parsed?.[0]) {
                const priceData = response.data.parsed[0].price;
                const price = Number(priceData.price);
                const expo = Number(priceData.expo);

                // precise calculation: price * 10^expo using BigInt to avoid float issues
                const priceBig = BigInt(priceData.price);
                const expoNum = Number(priceData.expo);

                if (expoNum >= 0) {
                    return Number(priceBig * 10n ** BigInt(expoNum));
                } else {
                    return Number(priceBig) / Math.pow(10, -expoNum);
                }
            }

            throw new Error('Invalid Pyth response format');
        } catch (error: any) {
            console.error(`👁️ Pyth Sensing Error (${symbol}):`, error.message);
            throw error; // Propagate error to trigger circuit breaker
        }
    }

    private getDefaultFeedId(symbol: 'BNB' | 'USDT'): string {
        // Default opBNB/BSC feed IDs (Fetched from Hermes)
        switch (symbol) {
            case 'BNB': return '2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f';
            case 'USDT': return '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b';
            default: throw new Error(`Unknown symbol for Pyth: ${symbol}`);
        }
    }
}
