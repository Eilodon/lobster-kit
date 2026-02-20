import { WalletClient, Transport, Chain, Account } from 'viem';

// ═══════════════════════════════════════════════════════
//  GENERIC DOMAIN TYPES (Universal — no chain dependency)
// ═══════════════════════════════════════════════════════

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
  metadata?: Record<string, unknown>;
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
  estimatedCost: string;
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
  token?: string; // Token address, undefined for native currency
  to: string;
  amount: string;
}

// ═══════════════════════════════════════════════════════
//  CONFIG TYPES (Generic)
// ═══════════════════════════════════════════════════════

export interface PythConfig {
  endpoint: string;
  priceFeedIds: Record<string, string>;
}

export interface ClawKitConfig {
  privateKey?: string; // Optional if WalletClient provided with account
  chainId?: number;
  rpcUrl?: string;
  proxyUrl?: string;
  gasMultiplier?: number;
  privacyMode?: 'strict' | 'balanced';
  thermodynamicFailPolicy?: 'OPEN' | 'CLOSED';
  approvalMode?: 'EXACT' | 'BUFFERED' | 'MAX';
  approvalBufferBps?: number;
  usePermit2?: boolean;
  contracts?: Record<string, string>;
  chainConfig?: ChainConfig;
  fallbackBNBPrice?: number;
  pythConfig?: PythConfig;
  configIntegrity?: {
    expectedHash: string;
    algorithm?: 'sha256';
    strict?: boolean;
  };
  deepSeekConfig?: {
    apiKey: string;
    model?: string;
  };
  [key: string]: unknown;
}

// Strict WalletClient type enforcing Account presence (viem-specific)
export type ClawKitWalletClient = WalletClient<Transport, Chain, Account>;

// ═══════════════════════════════════════════════════════
//  CHAIN CONFIGURATION (Generic)
// ═══════════════════════════════════════════════════════

export interface ChainConfig {
  name: string;
  chainId: number;
  tokens: Record<string, TokenInfo>;
  contracts: Record<string, string | undefined | Record<string, string>>;
}

export interface TokenInfo {
  address: string;
  decimals: number;
  symbol: string;
}

/**
 * Cast a string to viem's Address type.
 * Single validation point.
 */
export function toAddress(addr: string): `0x${string}` {
  if (!addr.startsWith('0x')) {
    throw new Error(`Invalid address: ${addr} — must start with 0x`);
  }
  return addr as `0x${string}`;
}

// ═══════════════════════════════════════════════════════
//  BNB-SPECIFIC RE-EXPORTS (Backward Compatibility)
// ═══════════════════════════════════════════════════════

export {
  OPBNB_CONFIG,
  TOKENS,
  PANCAKE_ROUTER,
  PANCAKE_QUOTER,
  CLAWKIT_CONTRACTS,
  BATCH_EXECUTOR,
  APPROVAL_REVOKER,
  assertDeployed,
  getTokenDecimals,
  resolveTokenAddress,
  type TokenSymbol,
} from './chains/opbnb';
