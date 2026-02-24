import type { ValidationResult, EidolonGuard } from '@clawkit/soul';

export interface OpenClawSkill {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface OpenClawExecuteInput {
  action: string;
  params?: Record<string, unknown>;
}

export interface OpenClawExecuteResult {
  status: 'approved' | 'denied' | 'error';
  result?: unknown;
  error?: string;
  validation?: ValidationResult;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class OpenClawAdapter {
  private readonly skills = new Map<string, OpenClawSkill>();

  constructor(private readonly guard: EidolonGuard) { }

  registerSkill(skill: OpenClawSkill): void {
    this.skills.set(skill.name, skill);
  }

  async execute(input: OpenClawExecuteInput): Promise<OpenClawExecuteResult> {
    const skill = this.skills.get(input.action);
    if (!skill) {
      return {
        status: 'error',
        error: `Unknown skill: ${input.action}`
      };
    }

    const params = input.params ?? {};
    const tokenAddress = this.resolveTokenAddress(params);
    const amountUSD = this.resolveAmountUsd(params);
    const actionType = this.resolveActionType(input.action, params);

    const validation = await this.guard.validateAction(actionType, {
      amountUSD,
      tokenAddress
    });

    if (!validation.approved) {
      return {
        status: 'denied',
        error: validation.reason,
        validation
      };
    }

    const result = await skill.handler(params);
    return {
      status: 'approved',
      result,
      validation
    };
  }

  private resolveAmountUsd(params: Record<string, unknown>): number | undefined {
    const direct = params.amountUSD;
    if (typeof direct === 'number' && Number.isFinite(direct)) {
      return direct;
    }
    if (typeof direct === 'string' && direct.trim().length > 0) {
      const parsed = Number(direct);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private resolveTokenAddress(params: Record<string, unknown>): string {
    const byAddress = params.tokenAddress;
    if (typeof byAddress === 'string' && byAddress.trim().length > 0) {
      return byAddress;
    }

    const byToken = params.token;
    if (typeof byToken === 'string' && byToken.trim().length > 0) {
      return byToken.startsWith('0x') ? byToken : ZERO_ADDRESS;
    }

    return ZERO_ADDRESS;
  }

  private resolveActionType(
    action: string,
    params: Record<string, unknown>
  ): 'BUY' | 'SELL' {
    const explicit = params.actionType;
    if (explicit === 'BUY' || explicit === 'SELL') {
      return explicit;
    }

    const normalized = action.toLowerCase();
    if (normalized.includes('sell') || normalized.includes('dump') || normalized.includes('exit')) {
      return 'SELL';
    }

    return 'BUY';
  }
}
