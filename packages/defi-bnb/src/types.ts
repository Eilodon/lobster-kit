import { WalletClient, Transport, Chain, Account } from 'viem';
export interface SwapParams {
  from: string; // Token symbol or address
  to: string;   // Token symbol or address
  amount: string; // Amount in human units (e.g., '1.5')
  slippage?: number; // Slippage tolerance (0-100), default 0.5%
  deadline?: number; // Transaction deadline in minutes, default 20
  emergencyMode?: boolean; // Bypass thermodynamic checks (Gas/Slippage)
  amountUSD?: number; // Estimated USD value of trade for safety checks
}

export interface StakeParams {
  token: string; // Token to stake
  amount: string;
  pool?: string; // Pool ID or 'auto' for auto-compound
}

export interface LendParams {
  asset: string; // Token to supply (e.g., 'USDT', 'BNB')
  amount: string;
}

export interface BorrowParams {
  asset: string; // Token to borrow
  amount: string;
}

export interface RepayParams {
  asset: string; // Token to repay
  amount: string;
}

export interface NFTMintParams {
  name: string;
  description?: string;
  image?: string; // URL or base64
  tier?: 'Bronze' | 'Silver' | 'Gold' | 'Diamond';
  to: string; // Recipient address
  metadata?: Record<string, any>;
}

export interface SecurityScanResult {
  address: string;
  score: number; // 0-100, higher = more risky
  threats: string[];
  recommendations: string[];
  isHoneypot: boolean;
  hasOpenSource: boolean;
  timestamp: number;
}

export interface ApprovalInfo {
  token: string;
  spender: string;
  amount: string;
  lastUpdated: number;
}

export interface GasEstimate {
  estimatedGas: bigint;
  estimatedCost: string; // in BNB
  estimatedCostUSD: string;
  suggestedGasPrice: bigint;
}

export interface BatchTransaction {
  to: string;
  data: string;
  value?: bigint;
}

export interface PortfolioHealth {
  totalValueUSD: number;
  totalDebtUSD: number;
  healthFactor: number; // > 1 is healthy
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  positions: Position[];
}

export interface Position {
  protocol: string;
  type: 'Lend' | 'Borrow' | 'LP' | 'Stake' | 'Hold';
  asset: string;
  amount: string;
  valueUSD: number;
  apy: number;
}

export interface TransferParams {
  token?: string; // Token address, undefined for BNB
  to: string;
  amount: string;
}

// ClawKit config — no plaintext private key (FIX M8 partial)
// ClawKit config — consolidated definition

export interface PythConfig {
  endpoint: string;
  priceFeedIds: {
    BNB: string;
    USDT: string;
  };
}

export interface ClawKitConfig {
  privateKey?: string; // Optional if WalletClient provided with account
  chainId?: number; // default: 204 (opBNB)
  rpcUrl?: string;
  proxyUrl?: string; // [NEW] Ghost Protocol Proxy URL
  gasMultiplier?: number;
  privacyMode?: 'strict' | 'balanced'; // strict => no direct external price feeds
  thermodynamicFailPolicy?: 'OPEN' | 'CLOSED'; // OPEN = warn only, CLOSED = throw error (default)
  approvalMode?: 'EXACT' | 'BUFFERED' | 'MAX';
  approvalBufferBps?: number; // Used when approvalMode=BUFFERED (default 12000 = 1.2x)
  usePermit2?: boolean;       // [P3] Use Permit2 gasless approvals instead of on-chain approve()
  contracts?: Partial<typeof CLAWKIT_CONTRACTS>;
  chainConfig?: ChainConfig; // Inject chain specific config
  fallbackBNBPrice?: number; // [NEW] User-defined fallback price (default: 600)
  pythConfig?: PythConfig; // [NEW] Pyth Network Configuration
  configIntegrity?: {
    expectedHash: string;
    algorithm?: 'sha256';
    strict?: boolean; // default true
  };
  deepSeekConfig?: {
    apiKey: string;
    model?: string;
    timeout?: number;
  };
  [key: string]: unknown;
}


// Strict WalletClient type enforcing Account presence
export type ClawKitWalletClient = WalletClient<Transport, Chain, Account>;

// ═══════════════════════════════════════════════════════
//  CHAIN CONFIGURATION (FIX F4 + F5)
// ═══════════════════════════════════════════════════════

export interface ChainConfig {
  name: string;
  chainId: number;
  tokens: Record<string, TokenInfo>;
  contracts: {
    pancakeRouter: string;
    pancakeQuoter: string;
    pancakeMasterChef: string; // V3
    venusComptroller?: string; // Optional (not yet on opBNB?)
    venusMarkets?: Record<string, string>;
    batchExecutor?: string; // [NEW] For optimized txs
  };
}

export interface TokenInfo {
  address: string;
  decimals: number;
  symbol: string;
}

/**
 * OPBNB CONFIGURATION (Verified 2026)
 * Sources: pancakeswap.finance, binance.org
 */
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
    // PancakeSwap V3 Smart Router
    pancakeRouter: '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86',
    // PancakeSwap V3 Quoter
    pancakeQuoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
    // PancakeSwap V3 MasterChef
    pancakeMasterChef: '0x556B9306565093C855AEA9AE92A594704c2Cd59e',
    // Venus not yet fully verified on opBNB, leaving undefined to prevent loss
    venusComptroller: undefined,
    venusMarkets: {}
  }
};

// Deprecated global exports kept for checking, but logic should use config
export const TOKENS = OPBNB_CONFIG.tokens;
export const PANCAKE_ROUTER = OPBNB_CONFIG.contracts.pancakeRouter;
export const PANCAKE_QUOTER = OPBNB_CONFIG.contracts.pancakeQuoter;

// ═══════════════════════════════════════════════════════
//  CONTRACT ADDRESSES (FIX F4)
// ═══════════════════════════════════════════════════════

/**
 * ClawKit helper contracts — MUST be deployed before use.
 * Run `npx hardhat run scripts/deploy.ts --network opbnb` to deploy.
 * Addresses are auto-populated by the deploy script.
 */
export const CLAWKIT_CONTRACTS = {
  DynamicBadge: '0x0000000000000000000000000000000000000000' as string,
  BatchExecutor: '0x0000000000000000000000000000000000000000' as string,
  ApprovalRevoker: '0x0000000000000000000000000000000000000000' as string,
};

/**
 * FIX F4: Validate that a contract address has been deployed.
 * Throws if the address is zero (not deployed yet).
 */
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
 * FIX H4: Resolve token decimals from symbol or address.
 */
export function getTokenDecimals(tokenOrSymbol: string): number {
  // Check by symbol
  const bySymbol = TOKENS[tokenOrSymbol.toUpperCase()];
  if (bySymbol) return bySymbol.decimals;

  // Check by address
  const byAddr = Object.values(TOKENS).find(
    (t) => t.address.toLowerCase() === tokenOrSymbol.toLowerCase()
  );
  if (byAddr) return byAddr.decimals;

  // 🛑 SECURITY FIX: Do not default to 18 for unknown tokens.
  // This prevents order-of-magnitude errors (e.g. USDC is 6 decimals, defaulting to 18 is 10^12 error).
  throw new Error(`UnknownTokenError: Decimals unknown for ${tokenOrSymbol}. Add to config or provide explicitly.`);
}

/**
 * Resolve token address from symbol
 */
export function resolveTokenAddress(tokenOrSymbol: string): string {
  const bySymbol = TOKENS[tokenOrSymbol.toUpperCase()];
  if (bySymbol) return bySymbol.address;

  // FIX: Validate format. Don't just return garbage.
  // 0x + 40 hex chars
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenOrSymbol)) {
    throw new Error(`InvalidTokenError: "${tokenOrSymbol}" is neither a known symbol nor a valid address.`);
  }

  return tokenOrSymbol;
}

// Aliases for backward compatibility
export const BATCH_EXECUTOR = CLAWKIT_CONTRACTS.BatchExecutor;
export const APPROVAL_REVOKER = CLAWKIT_CONTRACTS.ApprovalRevoker;

export type TokenSymbol = keyof typeof TOKENS;

/**
 * Cast a string to viem's Address type.
 * Single validation point — use this instead of scattering `as \`0x...\`` everywhere.
 */
export function toAddress(addr: string): `0x${string}` {
  if (!addr.startsWith('0x')) {
    throw new Error(`Invalid address: ${addr} — must start with 0x`);
  }
  return addr as `0x${string}`;
}
