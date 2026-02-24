import axios from 'axios';
import { withRetry } from '@eidolon/core';

/**
 * 🛡️ GoPlus Security API Client
 * " The Eyes of the Citadel "
 * 
 * Fetches real-time security data for tokens on BNB Chain.
 * API Docs: https://docs.gopluslabs.io/
 */

export interface TokenSecurityData {
    is_honeypot: boolean;
    honeypot_with_same_creator: boolean;
    buy_tax: string;
    sell_tax: string;
    cannot_buy: boolean;
    cannot_sell_all: boolean;
    is_blacklisted: boolean;
    is_whitelisted: boolean;
    is_open_source: boolean;
    is_proxy: boolean;
    is_mintable: boolean;
    owner_change_balance: boolean; // Can owner change balance?
    owner_address: string;
    creator_address: string;
    dex: unknown[]; // List of DEXs where it is traded
    liquidity_locked?: boolean;
}

export class GoPlusSecurity {
    constructor(private chainId: number = 204) { }

    private get API_URL() {
        return `https://api.gopluslabs.io/api/v1/token_security/${this.chainId}`;
    }

    /**
     * Fetch security data for a token address
     */
    public async checkToken(tokenAddress: string): Promise<TokenSecurityData | null> {
        try {
            const response = await withRetry(
                () => axios.get(`${this.API_URL}?contract_addresses=${tokenAddress}`, { timeout: 5000 }),
                {
                    maxAttempts: 3,
                    baseDelay: 300,
                    maxDelay: 2000,
                    totalTimeoutMs: 10000
                }
            );

            if (response.data?.result?.[tokenAddress.toLowerCase()]) {
                const raw = response.data.result[tokenAddress.toLowerCase()];
                let liquidityLocked: boolean | undefined = undefined;
                if (raw.is_locked !== undefined && raw.is_locked !== null) {
                    liquidityLocked = raw.is_locked === '1' || raw.is_locked === 1 || raw.is_locked === true;
                } else if (Array.isArray(raw.lp_holders) && raw.lp_holders.length > 0) {
                    liquidityLocked = raw.lp_holders.some((h: unknown) => {
                        if (!h || typeof h !== 'object') return false;
                        const holder = h as { is_locked?: unknown };
                        return holder.is_locked === '1' || holder.is_locked === 1 || holder.is_locked === true;
                    });
                }

                // Map raw API response to our typed interface
                // GoPlus returns strings "1"/"0" for booleans often
                return {
                    is_honeypot: raw.is_honeypot === '1',
                    honeypot_with_same_creator: raw.honeypot_with_same_creator === '1',
                    buy_tax: raw.buy_tax || '0',
                    sell_tax: raw.sell_tax || '0',
                    cannot_buy: raw.cannot_buy === '1',
                    cannot_sell_all: raw.cannot_sell_all === '1',
                    is_blacklisted: raw.is_blacklisted === '1',
                    is_whitelisted: raw.is_whitelisted === '1',
                    is_open_source: raw.is_open_source === '1',
                    is_proxy: raw.is_proxy === '1',
                    is_mintable: raw.is_mintable === '1',
                    owner_change_balance: raw.owner_change_balance === '1',
                    owner_address: raw.owner_address || '',
                    creator_address: raw.creator_address || '',
                    dex: raw.dex || [],
                    liquidity_locked: liquidityLocked
                };
            }

            // If response is weird but not an error, we treat as unknown/unsafe
            throw new Error(`GoPlus API returned invalid data for ${tokenAddress}`);

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('❌ GoPlus API Error:', message);
            // Fail Closed: We MUST know the security state. If the Oracle is blind, the Agent halts.
            throw new Error(`Security Oracle Offline: ${message}`);
        }
    }
}
