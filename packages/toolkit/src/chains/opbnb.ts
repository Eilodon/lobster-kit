/**
 * 🔶 opBNB CHAIN CONFIGURATION
 *
 * BNB-specific constants, contract addresses, and token registry.
 * Import from '@clawkit/toolkit/chains/opbnb' (or './chains/opbnb')
 * only in domain adapters — never in the universal kernel.
 *
 * Sources: pancakeswap.finance, binance.org (verified 2026)
 */

import { ChainConfig, TokenInfo, ClawKitConfig } from '../types';

// ═══════════════════════════════════════════════════════
//  OPBNB CHAIN CONFIG
// ═══════════════════════════════════════════════════════

export const OPBNB_CONFIG: ChainConfig = {
    name: 'opBNB',
    chainId: 204,
    tokens: {
        BNB: {
            address: '0x0000000000000000000000000000000000000000',
            decimals: 18,
            symbol: 'BNB',
        },
        WBNB: {
            address: '0x4200000000000000000000000000000000000006',
            decimals: 18,
            symbol: 'WBNB',
        },
        USDT: {
            address: '0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3',
            decimals: 6,
            symbol: 'USDT',
        },
        USDC: {
            address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // Verified opBNB USDC (Bridged)
            decimals: 6,
            symbol: 'USDC',
        },
        CAKE: {
            address: '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898', // CAKE on opBNB
            decimals: 18,
            symbol: 'CAKE',
        },
    },
    contracts: {
        pancakeRouter: '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86',
        pancakeQuoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
        pancakeMasterChef: '0x556B9306565093C855AEA9AE92A594704c2Cd59e',
        venusComptroller: undefined,
        venusMarkets: {}
    }
};

// ═══════════════════════════════════════════════════════
//  CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════

/** Deprecated global token reference. Use config.chainConfig.tokens instead. */
export const TOKENS = OPBNB_CONFIG.tokens;
export const PANCAKE_ROUTER = OPBNB_CONFIG.contracts.pancakeRouter;
export const PANCAKE_QUOTER = OPBNB_CONFIG.contracts.pancakeQuoter;

// ═══════════════════════════════════════════════════════
//  CLAWKIT HELPER CONTRACTS
// ═══════════════════════════════════════════════════════

export const CLAWKIT_CONTRACTS = {
    DynamicBadge: '0x0000000000000000000000000000000000000000' as string,
    BatchExecutor: '0x0000000000000000000000000000000000000000' as string,
    ApprovalRevoker: '0x0000000000000000000000000000000000000000' as string,
};

export function assertDeployed(name: keyof typeof CLAWKIT_CONTRACTS): string {
    const addr = CLAWKIT_CONTRACTS[name];
    if (!addr || addr === '0x0000000000000000000000000000000000000000') {
        throw new Error(
            `${name} contract not deployed. Run: npx hardhat run scripts/deploy.ts --network opbnb`
        );
    }
    return addr;
}

/**
 * Resolve token decimals from symbol or address (BNB-specific).
 */
export function getTokenDecimals(tokenOrSymbol: string): number {
    const bySymbol = TOKENS[tokenOrSymbol.toUpperCase()];
    if (bySymbol) return bySymbol.decimals;

    const byAddr = Object.values(TOKENS).find(
        (t) => t.address.toLowerCase() === tokenOrSymbol.toLowerCase()
    );
    if (byAddr) return byAddr.decimals;

    throw new Error(`UnknownTokenError: Decimals unknown for ${tokenOrSymbol}. Add to config or provide explicitly.`);
}

/**
 * Resolve token address from symbol (BNB-specific).
 */
export function resolveTokenAddress(tokenOrSymbol: string): string {
    const bySymbol = TOKENS[tokenOrSymbol.toUpperCase()];
    if (bySymbol) return bySymbol.address;

    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenOrSymbol)) {
        throw new Error(`InvalidTokenError: "${tokenOrSymbol}" is neither a known symbol nor a valid address.`);
    }

    return tokenOrSymbol;
}

export const BATCH_EXECUTOR = CLAWKIT_CONTRACTS.BatchExecutor;
export const APPROVAL_REVOKER = CLAWKIT_CONTRACTS.ApprovalRevoker;

export type TokenSymbol = keyof typeof TOKENS;
