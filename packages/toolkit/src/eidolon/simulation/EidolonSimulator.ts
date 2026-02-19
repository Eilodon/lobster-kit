import { PublicClient } from 'viem';
import { IClawKit } from '@clawkit/core';
import { withRetry, withTimeout } from '../../utils/Resilience';

export interface SimulationResult {
    success: boolean;
    gasUsed: bigint;
    revertReason?: string;
    logs: unknown[];
    returnValue?: unknown;
    simulatedValueUSD?: number; // Estimated value of output
    touchedAddresses?: string[]; // 🕵️ Footprint Analysis (Access List)
    estimatedGasLimit?: bigint;
}

export interface ShadowTransaction {
    to: string;
    data: string;
    value?: bigint;
    account: string;
    simulateAsWhale?: boolean;
    stateOverride?: StateOverrideMap; // 🛠️ GOD MODE: Alter reality (Users balance, Nonce, Code)
}

export interface RiskMatrixResult {
    base: SimulationResult;
    gasWorstCase: {
        estimatedGas: bigint;
        bufferPct: number;
    };
    footprint: {
        touchedCount: number;
        touchedAddresses: string[];
        maxTouchedAddresses: number;
        breached: boolean;
        error?: string;
    };
    allPassed: boolean;
}

type HexAddress = `0x${string}`;

type StateOverrideEntry = Record<string, unknown> & {
    balance?: string;
};

type StateOverrideMap = Record<string, StateOverrideEntry>;

type AccessListItem = { address?: string };

type AccessListResult = {
    accessList?: AccessListItem[];
};

/**
 * 🔮 EIDOLON SIMULATOR (Shadow Clones)
 * 
 * "Measure twice, cut once."
 * Simulates transactions on a local fork or via eth_call
 * to verify outcome before risking capital.
 */
export class EidolonSimulator {
    private static readonly WHALE_BALANCE = '0x21E19E0C9BAB2400000'; // 10,000 ETH
    private static readonly RPC_TIMEOUT_MS = 8000;
    private static readonly MAX_TOUCHED_ADDRESSES = 50;

    private client: PublicClient;
    private kit: IClawKit;

    constructor(kit: IClawKit) {
        this.kit = kit;
        this.client = kit.publicClient;
    }

    private extractTouchedAddresses(accessList: unknown): string[] {
        if (!accessList || typeof accessList !== 'object') return [];
        const list = (accessList as AccessListResult).accessList;
        if (!Array.isArray(list)) return [];
        return this.dedupeAddresses(
            list
                .map((item) => String(item?.address ?? ''))
                .filter((address) => address.length > 0)
        );
    }

    public async simulate(tx: ShadowTransaction): Promise<SimulationResult> {
        try {
            console.log(`🔮 SHADOW CLONE: Simulating tx to ${tx.to}...`);

            // Secure default: whale mode is explicit opt-in only.
            const stateOverride = this.buildStateOverride(tx);

            // 2. Footprint Analysis (Access List)
            // Detects what contracts this transaction touches (Blast Radius)
            let touched: string[] = [];
            try {
                const accessList = await withRetry(
                    () => withTimeout(
                        Promise.resolve(this.client.createAccessList({
                            account: tx.account as `0x${string}`,
                            to: tx.to as `0x${string}`,
                            data: tx.data as `0x${string}`,
                            value: tx.value || 0n,
                            stateOverride
                        } as Parameters<PublicClient['createAccessList']>[0])),
                        EidolonSimulator.RPC_TIMEOUT_MS,
                        'SIM_ACCESS_LIST_TIMEOUT'
                    ),
                    {
                        maxAttempts: 2,
                        baseDelay: 250,
                        maxDelay: 1000,
                        totalTimeoutMs: 10000
                    }
                );

                touched = this.extractTouchedAddresses(accessList);
                if (touched.length > 0) {
                    console.log(`   🕵️ Footprint: Touched ${touched.length} contracts.`);
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                console.warn(`   ⚠️ Failed to generate Access List: ${message}`);
                // Keep simulate() permissive for compatibility; simulateRiskMatrix() is fail-closed.
            }

            // 3. Dry Run via Call (eth_call) with State Overrides
            const callResult = await withRetry<Awaited<ReturnType<PublicClient['call']>>>(
                () => withTimeout(
                    Promise.resolve(this.client.call({
                        account: tx.account as `0x${string}`,
                        to: tx.to as `0x${string}`,
                        data: tx.data as `0x${string}`,
                        value: tx.value || 0n,
                        stateOverride
                    } as Parameters<PublicClient['call']>[0])),
                    EidolonSimulator.RPC_TIMEOUT_MS,
                    'SIM_CALL_TIMEOUT'
                ),
                {
                    maxAttempts: 3,
                    baseDelay: 250,
                    maxDelay: 1500,
                    totalTimeoutMs: 12000
                }
            );
            const returnData = callResult?.data;

            // 4. Estimate Gas
            const gasEstimate: bigint = await withRetry(
                () => withTimeout(
                    Promise.resolve(this.client.estimateGas({
                        account: tx.account as `0x${string}`,
                        to: tx.to as `0x${string}`,
                        data: tx.data as `0x${string}`,
                        value: tx.value || 0n,
                        stateOverride
                    } as Parameters<PublicClient['estimateGas']>[0])),
                    EidolonSimulator.RPC_TIMEOUT_MS,
                    'SIM_GAS_TIMEOUT'
                ),
                {
                    maxAttempts: 3,
                    baseDelay: 250,
                    maxDelay: 1500,
                    totalTimeoutMs: 12000
                }
            );

            console.log(`   ✅ Shadow Clone Survived. Gas: ${gasEstimate}`);

            return {
                success: true,
                gasUsed: gasEstimate,
                returnValue: returnData,
                logs: [],
                touchedAddresses: touched,
                estimatedGasLimit: (BigInt(gasEstimate) * 120n) / 100n
            };

        } catch (error: unknown) {
            const shortMessage = typeof error === 'object' && error !== null && 'shortMessage' in error
                ? String((error as { shortMessage?: unknown }).shortMessage ?? '')
                : '';
            const message = error instanceof Error ? error.message : String(error);
            const combinedMessage = shortMessage || message;
            console.warn(`   💀 Shadow Clone Died: ${combinedMessage}`);
            return {
                success: false,
                gasUsed: 0n,
                revertReason: combinedMessage,
                logs: []
            };
        }
    }

    /**
     * Runs a deterministic multi-check simulation matrix:
     * - Base success path (eth_call + gas estimation)
     * - Gas worst-case buffer projection
     * - Access-list footprint summary
     */
    public async simulateRiskMatrix(tx: ShadowTransaction): Promise<RiskMatrixResult> {
        let footprintError: string | undefined;
        let touched: string[] = [];
        try {
            touched = await this.scanFootprint(tx);
        } catch (error: unknown) {
            footprintError = error instanceof Error ? error.message : 'Unknown footprint error';
        }

        const base = await this.simulate(tx);
        if (touched.length === 0) {
            touched = this.dedupeAddresses(base.touchedAddresses || []);
        }
        const bufferPct = 30;
        const gasWorstCase = {
            estimatedGas: base.success ? (base.gasUsed * BigInt(100 + bufferPct)) / 100n : 0n,
            bufferPct
        };
        const breached = touched.length > EidolonSimulator.MAX_TOUCHED_ADDRESSES;

        return {
            base,
            gasWorstCase,
            footprint: {
                touchedCount: touched.length,
                touchedAddresses: touched,
                maxTouchedAddresses: EidolonSimulator.MAX_TOUCHED_ADDRESSES,
                breached,
                error: footprintError
            },
            allPassed: base.success && !footprintError && !breached
        };
    }

    /**
     * 🕵️ DETECTIVE MODE: Scan transaction footprint without executing.
     * Throws error if scan fails (Fail-Closed).
     */
    public async scanFootprint(tx: ShadowTransaction): Promise<string[]> {
        try {
            const stateOverride = this.buildStateOverride(tx);
            const accessList = await withRetry(
                () => withTimeout(
                    Promise.resolve(this.client.createAccessList({
                        account: tx.account as `0x${string}`,
                        to: tx.to as `0x${string}`,
                        data: tx.data as `0x${string}`,
                        value: tx.value || 0n,
                        stateOverride
                    } as Parameters<PublicClient['createAccessList']>[0])),
                    EidolonSimulator.RPC_TIMEOUT_MS,
                    'SCAN_FOOTPRINT_TIMEOUT'
                ),
                {
                    maxAttempts: 3,
                    baseDelay: 250,
                    maxDelay: 1200,
                    totalTimeoutMs: 12000
                }
            );

            return this.extractTouchedAddresses(accessList);
        } catch (e: unknown) {
            console.error('Footprint scan failed:', e);
            const message = e instanceof Error ? e.message : 'Unknown error';
            throw new Error(`Footprint Scan Failed: ${message}`);
        }
    }

    private buildStateOverride(tx: ShadowTransaction): StateOverrideMap | undefined {
        const baseOverrides = tx.stateOverride ? { ...tx.stateOverride } : {};
        if (tx.simulateAsWhale !== true) {
            return Object.keys(baseOverrides).length > 0 ? baseOverrides : undefined;
        }

        const accountAddress = tx.account as HexAddress;
        const accountOverride = { ...(baseOverrides[accountAddress] || {}) };
        if (accountOverride.balance === undefined) {
            accountOverride.balance = EidolonSimulator.WHALE_BALANCE;
        }

        return {
            ...baseOverrides,
            [accountAddress]: accountOverride
        };
    }

    private dedupeAddresses(addresses: string[]): string[] {
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const address of addresses) {
            const key = String(address).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(address);
        }
        return deduped;
    }
}
