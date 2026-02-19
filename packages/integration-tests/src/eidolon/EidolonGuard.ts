import type { IClawKit } from '@clawkit/core';
import {
  EidolonGuard as SoulEidolonGuard,
  type GuardConfig,
  type RiskParameters,
  type ValidationResult
} from '@clawkit/soul';
import { WasmAdapter } from './WasmAdapter';
import { GoPlusSecurity } from './oracles/GoPlusSecurity';
import { AppendOnlyAdapter } from './memory/AppendOnlyAdapter';

export type { GuardConfig, RiskParameters, ValidationResult };

/**
 * Legacy test wrapper: keeps the current soul implementation but swaps
 * core dependencies through local module paths so vi.mock('../src/eidolon/...')
 * remains effective.
 */
export class EidolonGuard extends SoulEidolonGuard {
  constructor(kit: IClawKit, config?: GuardConfig) {
    super(kit, config);

    const self = this as unknown as {
      config?: GuardConfig;
      wasmAdapter?: {
        createValueInvariant: (maxDrawdownPerBlock: number, maxPositionSize: number, threshold: number) => unknown;
        createAntiRug: () => unknown;
      };
      valueInvariant?: unknown;
      antiRug?: unknown;
      securityOracle?: unknown;
      traumaStorage?: unknown;
    };

    const wasm = WasmAdapter.getInstance() as unknown as {
      createValueInvariant: (maxDrawdownPerBlock: number, maxPositionSize: number, threshold: number) => unknown;
      createAntiRug: () => unknown;
    };

    const maxPositionSize = config?.riskParameters?.maxPositionSize
      ?? self.config?.riskParameters?.maxPositionSize
      ?? 1000;

    self.wasmAdapter = wasm;
    self.valueInvariant = wasm.createValueInvariant(5.0, maxPositionSize, 15.0);
    self.antiRug = wasm.createAntiRug();
    self.securityOracle = new GoPlusSecurity();
    self.traumaStorage = new AppendOnlyAdapter();
  }
}
