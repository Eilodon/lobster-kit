/**
 * Pyth Network Oracle Configuration
 */
export interface PythConfig {
    endpoint?: string;
    priceFeedIds?: {
        BNB?: string;
        USDT?: string;
        [symbol: string]: string | undefined;
    };
}
