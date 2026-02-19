import { IClawKit } from '@clawkit/core';
import { PublicClient, createPublicClient, http, isAddress } from 'viem';
import { opBNB } from 'viem/chains';


import { ClawKitConfig, ClawKitWalletClient, OPBNB_CONFIG } from './types';
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
    public readonly publicClient: PublicClient;
    public readonly config: ClawKitConfig;

    constructor(walletClient: ClawKitWalletClient, config: ClawKitConfig) {
        this.validateConfig(config); // 🛡️ Zero-Trust Boot

        this.walletClient = walletClient;
        this.config = config;

        // Setup public client for reading blockchain state
        this.publicClient = createPublicClient({
            chain: opBNB,
            transport: http(config.rpcUrl || 'https://opbnb-mainnet-rpc.bnbchain.org')
        });

        // Initialize all modules
        this.adapters = new DomainAdapterRegistry();

        // Initialize Hive Mind
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
            config.chainConfig = OPBNB_CONFIG; // FIX U8: Apply defaults instead of skipping validation
        }

        // validate contracts
        for (const [key, addr] of Object.entries(config.chainConfig.contracts)) {
            if (typeof addr === 'string' && addr && !isAddress(addr)) {
                throw new Error(`💥 ATOMIC CRASH: Invalid contract address for '${key}': ${addr}`);
            }
        }

        // validate tokens
        for (const [symbol, info] of Object.entries(config.chainConfig.tokens)) {
            if (!isAddress(info.address)) {
                throw new Error(`💥 ATOMIC CRASH: Invalid token address for '${symbol}': ${info.address}`);
            }
        }
        console.log("🛡️ ATOMIC CONFIG: Integrity Verified.");
    }

    /**
     * Get the current account address
     */
    async getAddress(): Promise<string> {
        const [address] = await this.walletClient.getAddresses();
        return address;
    }

    /**
     * Get the current chain ID
     */
    async getChainId(): Promise<number> {
        return await this.walletClient.getChainId();
    }

    /**
     * Check if connected to opBNB
     */
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
// Export types
export * from './types';
export * from './abi/erc20';
export * from './math/TokenAmount';
export * from './math/Q64x96';
export * from './services/PriceService';
export * from './utils/ApiGateway';

export * from './connectors';
export * from './adapters';

// Default export
export default ClawKit;
