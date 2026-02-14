import { WalletClient, Transport, Chain, Account } from 'viem';
export interface SwapParams {
  from: string; // Token symbol or address
  to: string;   // Token symbol or address
  amount: string; // Amount in human units (e.g., '1.5')
  slippage?: number; // Slippage tolerance (0-100), default 0.5%
  deadline?: number; // Transaction deadline in minutes, default 20
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
export interface ClawKitConfig {
  privateKey?: string; // Optional if WalletClient provided with account
  chainId?: number; // default: 204 (opBNB)
  rpcUrl?: string;
  gasMultiplier?: number;
  contracts?: Partial<typeof CLAWKIT_CONTRACTS>;
}

// Strict WalletClient type enforcing Account presence
export type ClawKitWalletClient = WalletClient<Transport, Chain, Account>;

// ═══════════════════════════════════════════════════════
//  TOKEN REGISTRY (FIX F4 + H4)
// ═══════════════════════════════════════════════════════

export interface TokenInfo {
  address: string;
  decimals: number;
  symbol: string;
}

/**
 * Token addresses for opBNB Layer 2 (Chain ID: 204)
 * ⚠️ VERIFY addresses against official opBNB documentation before production use
 */
export const TOKENS: Record<string, TokenInfo> = {
  BNB: {
    address: '0x0000000000000000000000000000000000000000', // Native
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
    decimals: 6, // ← FIX H4: USDT = 6 decimals
    symbol: 'USDT',
  },
  USDC: {
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 6, // ← FIX H4: USDC = 6 decimals
    symbol: 'USDC',
  },
  CAKE: {
    address: '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898',
    decimals: 18,
    symbol: 'CAKE',
  },
} as const;

// PancakeSwap Router V3 on opBNB
export const PANCAKE_ROUTER = '0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb';

// PancakeSwap V3 Quoter on opBNB
export const PANCAKE_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';

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

  // Default to 18 for unknown tokens (standard ERC20)
  return 18;
}

/**
 * Resolve token address from symbol
 */
export function resolveTokenAddress(tokenOrSymbol: string): string {
  const bySymbol = TOKENS[tokenOrSymbol.toUpperCase()];
  if (bySymbol) return bySymbol.address;
  // Assume it's already an address
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
