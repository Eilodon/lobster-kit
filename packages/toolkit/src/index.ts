import { IClawKit } from '@clawkit/core';
import type { IReadClient, IWriteClient } from '@clawkit/core';
import { PublicClient, createPublicClient, http, isAddress } from 'viem';
import { opBNB } from 'viem/chains';

import { ClawKitConfig, ClawKitWalletClient, toAddress } from './types';
import { OPBNB_CONFIG } from './chains/opbnb';
import { verifyConfigIntegrity } from './utils/ConfigIntegrity';
import {
    DomainAdapterRegistry,
    DomainAdapterRegistrationOptions,
    DomainExecutionRequest,
    DomainExecutionResult,
    IDomainAdapter,
} from './adapters';

export class ClawKit implements IClawKit {
    public readonly adapters: DomainAdapterRegistry;

    public readonly walletClient: ClawKitWalletClient;
    /** @deprecated Use `readClient` instead */
    public readonly publicClient: PublicClient;
    /** Generic read client (domain-agnostic) */
    public readonly readClient: IReadClient;
    /** Generic write client (domain-agnostic) */
    public readonly writeClient: IWriteClient;
    public readonly config: ClawKitConfig;

    /**
     * Create a ClawKit instance.
     * @param walletClient - viem WalletClient for signing transactions
     * @param config - ClawKit configuration
     * @param readClient - Optional: inject a custom read client. Defaults to opBNB PublicClient.
     */
    constructor(
        walletClient: ClawKitWalletClient,
        config: ClawKitConfig,
        readClient?: IReadClient
    ) {
        this.validateConfig(config); // 🛡️ Zero-Trust Boot

        this.walletClient = walletClient;
        this.writeClient = walletClient as unknown as IWriteClient;
        this.config = config;

        // Setup read client — injected or default opBNB
        if (readClient) {
            this.readClient = readClient;
            this.publicClient = readClient as unknown as PublicClient; // backward compat
        } else {
            // Default: create opBNB PublicClient (backward-compatible behavior)
            this.publicClient = createPublicClient({
                chain: opBNB,
                transport: http(config.rpcUrl || 'https://opbnb-mainnet-rpc.bnbchain.org')
            });
            this.readClient = this.publicClient as unknown as IReadClient;
        }

        // Initialize adapter registry
        this.adapters = new DomainAdapterRegistry();
        this.registerBuiltInAdapters();
    }

    private registerBuiltInAdapters() {
        // Intentional no-op:
        // domain adapters are registered by runtime hosts (MCP/app/worker),
        // keeping toolkit domain-agnostic.
    }

    /**
     * 🛡️ ATOMIC CONFIG VALIDATION
     * Prevents runtime failures by ensuring rigorous config integrity at boot.
     */
    private validateConfig(config: ClawKitConfig) {
        verifyConfigIntegrity(config, 'ClawKit');

        if (!config.chainConfig) {
            console.warn("⚠️ ChainConfig missing - Defaulting to opBNB (Standard Mode)");
            config.chainConfig = OPBNB_CONFIG;
        }

        // validate contracts
        if (config.chainConfig.contracts) {
            for (const [key, addr] of Object.entries(config.chainConfig.contracts)) {
                if (typeof addr === 'string' && addr && !isAddress(addr)) {
                    throw new Error(`💥 ATOMIC CRASH: Invalid contract address for '${key}': ${addr}`);
                }
            }
        }

        // validate tokens
        if (config.chainConfig.tokens) {
            for (const [symbol, info] of Object.entries(config.chainConfig.tokens)) {
                if (typeof info === 'object' && info && 'address' in info && !isAddress((info as { address: string }).address)) {
                    throw new Error(`💥 ATOMIC CRASH: Invalid token address for '${symbol}': ${(info as { address: string }).address}`);
                }
            }
        }
        console.log("🛡️ ATOMIC CONFIG: Integrity Verified.");
    }

    async getAddress(): Promise<string> {
        const [address] = await this.walletClient.getAddresses();
        return address;
    }

    async getChainId(): Promise<number> {
        return await this.walletClient.getChainId();
    }

    async isOpBNB(): Promise<boolean> {
        const chainId = await this.getChainId();
        return chainId === opBNB.id;
    }

    public registerAdapter(adapter: IDomainAdapter, options?: DomainAdapterRegistrationOptions): void {
        this.adapters.register(adapter, options);
    }

    public async executeAdapterAction<T = unknown>(request: DomainExecutionRequest): Promise<DomainExecutionResult<T>> {
        return this.adapters.execute<T>(request);
    }
}

// Export all modules for direct use
export * from './types';
export * from './abi/erc20';
export * from './math/TokenAmount';
export * from './math/Q64x96';
export * from './services/PriceService';
export * from './utils/ApiGateway';

export * from './connectors';
export * from './adapters';
export * from './utils/ConfigIntegrity';
export * from './utils/Permit2';
export * from './utils/Resilience';
export * from './utils/Logger';

// Chain configs (domain-specific — import explicitly when needed)
export * from './chains/opbnb';

// Default export
export default ClawKit;
