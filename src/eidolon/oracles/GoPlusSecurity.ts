import axios from 'axios';

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
}

export class GoPlusSecurity {
    private readonly API_URL = 'https://api.gopluslabs.io/api/v1/token_security/56'; // 56 = BSC

    /**
     * Fetch security data for a token address
     */
    public async checkToken(tokenAddress: string): Promise<TokenSecurityData | null> {
        try {
            const response = await axios.get(`${this.API_URL}?contract_addresses=${tokenAddress}`);

            if (response.data?.result?.[tokenAddress.toLowerCase()]) {
                const raw = response.data.result[tokenAddress.toLowerCase()];

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
                    dex: raw.dex || []
                };
            }
            return null;
        } catch (error) {
            console.error('❌ GoPlus API Error:', error);
            return null; // Fail safe (or fail closed depending on policy)
        }
    }
}
