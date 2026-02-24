
import { WalletModule } from '../src/wallet';
import { SecurityModule } from '../src/security';
import { EIDOLON_CONTRACTS, OPBNB_CONFIG } from '../src/types';
import { createPublicClient, createWalletClient, http, parseEther, encodeFunctionData, parseAbi, Log } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { opBNB } from 'viem/chains';

// Mock Config & Clients
const mockConfig = {
    ...OPBNB_CONFIG,
    rpcUrl: 'https://opbnb-mainnet-rpc.bnbchain.org',
    chainConfig: {
        ...OPBNB_CONFIG,
        tokens: {
            USDT: { address: '0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3', decimals: 6, symbol: 'USDT' }
        }
    }
};

const account = privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000000001');
const client = createWalletClient({ account, chain: opBNB, transport: http() });
const publicClient = createPublicClient({ chain: opBNB, transport: http() });

// Mock sends
let pendingTransaction: any = null;
client.sendTransaction = async (args) => {
    pendingTransaction = args;
    return '0xHASH';
};

// Mock event watcher
let eventCallback: any = null;
(publicClient as any).watchContractEvent = (args: any) => {
    eventCallback = args.onLogs;
    return () => { };
};
(publicClient as any).watchBlockNumber = () => () => { };

async function verifyWalletBatching() {
    console.log('\n--- Verifying Wallet Batching ---');

    // Set mock address
    EIDOLON_CONTRACTS.BatchExecutor = '0x1234567890123456789012345678901234567890';

    const wallet = new WalletModule(client as any, publicClient, mockConfig as any);

    const transfers = [
        { to: '0x1000000000000000000000000000000000000001', amount: '1.0' }, // BNB 1.0
        { token: 'USDT', to: '0x1000000000000000000000000000000000000002', amount: '10' } // USDT 10
    ];

    try {
        await wallet.sendBatch(transfers);

        if (!pendingTransaction) {
            console.error('❌ No transaction sent');
            return;
        }

        if (pendingTransaction.to.toLowerCase() !== EIDOLON_CONTRACTS.BatchExecutor.toLowerCase()) {
            console.error('❌ Transaction sent to wrong address:', pendingTransaction.to);
            return;
        }

        // Decode data to verify batch args
        // Can't easily decode entire data without ABI decoder libr, but can check value
        if (pendingTransaction.value !== parseEther('1.0')) {
            console.error('❌ Wrong ETH value sent. Expected 1.0 BNB, got', pendingTransaction.value);
            return;
        }

        console.log('✅ BatchExecutor Transaction constructed correctly (Target & Value)');
    } catch (e) {
        console.error('❌ Wallet Batching failed:', e);
    }
}

async function verifySecurityMonitor() {
    console.log('\n--- Verifying Security Monitor ---');

    const security = new SecurityModule(client as any, publicClient, mockConfig as any);

    let alertReceived = null;
    await security.monitorSuspiciousActivity((alert) => {
        alertReceived = alert;
    });

    if (!eventCallback) {
        console.error('❌ Failed to register event watcher');
        return;
    }

    // Simulate Suspicious Approval
    // Spender = Some Random Address
    const suspiciousLog = {
        address: mockConfig.chainConfig.tokens.USDT.address,
        args: {
            spender: '0xSuspiciousSpender',
            value: 1000000n
        }
    };

    eventCallback([suspiciousLog]);

    if (alertReceived && (alertReceived as any).type === 'SUSPICIOUS_APPROVAL') {
        console.log('✅ Suspicious Approval Detected');
    } else {
        console.error('❌ Failed to detect Suspicious Approval');
    }

    // Simulate Safe Approval (Router)
    alertReceived = null;
    const safeLog = {
        address: mockConfig.chainConfig.tokens.USDT.address,
        args: {
            spender: mockConfig.chainConfig.contracts.pancakeRouter, // Safe
            value: 1000000n
        }
    };

    eventCallback([safeLog]);

    if (alertReceived === null) {
        console.log('✅ Safe Approval Ignored');
    } else {
        console.error('❌ False Positive on Safe Approval');
    }
}

async function run() {
    await verifyWalletBatching();
    await verifySecurityMonitor();
}

run().catch(console.error);
