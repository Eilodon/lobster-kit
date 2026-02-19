import { formatUnits, parseUnits } from 'viem';
import type {
  DomainActionContext,
  DomainActionDescriptor,
  IDomainAdapter
} from '@clawkit/toolkit';
import type { ClawKit as DeFiClawKit } from '../index';

type AdapterParams = Record<string, unknown>;

interface QuoteResult {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  amountOutMinRaw: string;
  fee: number;
  slippage: number;
}

const ACTIONS: DomainActionDescriptor[] = [
  {
    name: 'quote',
    description: 'Quote token output on PancakeSwap V3 for a given token pair.'
  },
  {
    name: 'sense_oracle',
    description: 'Quote a symbol against a quote token (defaults to USDT) for oracle-like sensing.'
  },
  {
    name: 'swap',
    description: 'Execute a token swap on opBNB.'
  },
  {
    name: 'scan_contract',
    description: 'Run security scan for a token contract.'
  },
  {
    name: 'portfolio_health',
    description: 'Fetch portfolio health snapshot for an address.'
  },
  {
    name: 'dump_all_positions',
    description: 'Emergency action to unwind positions into safe assets.'
  }
];

const SUPPORTED_ACTIONS = new Set(ACTIONS.map((entry) => entry.name));

function readString(params: AdapterParams, keys: string[], fallback?: string): string {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required parameter: ${keys[0]}`);
}

function readNumber(params: AdapterParams, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

export class OpBnbDefiAdapter implements IDomainAdapter {
  public readonly metadata = {
    id: 'opbnb-defi',
    domain: 'defi',
    version: '1.0.0',
    description: 'Domain adapter for opBNB DeFi execution using @clawkit/defi-bnb.',
    priority: 100
  };

  constructor(private readonly kit: DeFiClawKit) { }

  public listActions(): DomainActionDescriptor[] {
    return ACTIONS;
  }

  public supports(action: string): boolean {
    return SUPPORTED_ACTIONS.has(action);
  }

  public async execute<T = unknown>(
    action: string,
    params: AdapterParams,
    _context?: DomainActionContext
  ): Promise<T> {
    switch (action) {
      case 'quote':
        return (await this.executeQuote(params)) as T;
      case 'sense_oracle':
        return (await this.executeOracleSense(params)) as T;
      case 'swap':
        return (await this.executeSwap(params)) as T;
      case 'scan_contract':
        return (await this.executeSecurityScan(params)) as T;
      case 'portfolio_health':
        return (await this.executePortfolioHealth(params)) as T;
      case 'dump_all_positions':
        return (await this.kit.defi.dumpAllPositions()) as T;
      default:
        throw new Error(`Unsupported DeFi adapter action: ${action}`);
    }
  }

  private async executeQuote(params: AdapterParams): Promise<QuoteResult> {
    const tokenIn = readString(params, ['tokenIn', 'from', 'symbol']);
    const tokenOut = readString(params, ['tokenOut', 'to', 'quoteToken'], 'USDT');
    const amountIn = readString(params, ['amount'], '1');
    const slippage = Math.max(0, readNumber(params, ['slippage'], 0.5));

    const inputDecimals = await this.kit.defi.getDynamicTokenDecimals(tokenIn);
    const outputDecimals = await this.kit.defi.getDynamicTokenDecimals(tokenOut);
    const amountInRaw = parseUnits(amountIn, inputDecimals);
    const quote = await this.kit.defi.getRealQuote(tokenIn, tokenOut, amountInRaw, slippage);

    return {
      tokenIn,
      tokenOut,
      amountIn,
      amountOutMin: formatUnits(quote.amountOutMin, outputDecimals),
      amountOutMinRaw: quote.amountOutMin.toString(),
      fee: quote.fee,
      slippage
    };
  }

  private async executeOracleSense(params: AdapterParams): Promise<QuoteResult> {
    const symbol = readString(params, ['symbol', 'tokenIn'], 'WBNB');
    const quoteToken = readString(params, ['quoteToken', 'tokenOut'], 'USDT');
    const amount = readString(params, ['amount'], '1');
    const slippage = Math.max(0, readNumber(params, ['slippage'], 1));

    return this.executeQuote({
      tokenIn: symbol,
      tokenOut: quoteToken,
      amount,
      slippage
    });
  }

  private async executeSwap(params: AdapterParams): Promise<{ hash: string; amountOut: string }> {
    const tokenIn = readString(params, ['tokenIn', 'from']);
    const tokenOut = readString(params, ['tokenOut', 'to']);
    const amount = readString(params, ['amount']);
    const slippage = Math.max(0, readNumber(params, ['slippage'], 0.5));

    const amountUSDValue = readNumber(params, ['amountUSD'], Number.NaN);
    const amountUSD = Number.isFinite(amountUSDValue) && amountUSDValue > 0
      ? amountUSDValue
      : undefined;

    return this.kit.defi.swap({
      from: tokenIn,
      to: tokenOut,
      amount,
      slippage,
      amountUSD
    });
  }

  private async executeSecurityScan(params: AdapterParams) {
    const address = readString(params, ['address', 'tokenAddress']);
    return this.kit.security.scanContract(address);
  }

  private async executePortfolioHealth(params: AdapterParams) {
    const address = typeof params.address === 'string' ? params.address : undefined;
    return this.kit.analytics.portfolioHealth(address);
  }
}
