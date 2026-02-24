/**
 * 🛡️ EXAMPLE: SafeGuard Agent
 * 
 * This agent demonstrates Eidolon's security modules.
 * It monitors your wallet for dangerous approvals and auto-revokes them.
 */

import { Eidolon } from '../../src';
import { createPublicClient, createWalletClient, http } from 'viem';
import { opBNB } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { TOKENS } from '../../src/types';

// Setup
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const publicClient = createPublicClient({
    chain: opBNB,
    transport: http()
});

const walletClient = createWalletClient({
    account,
    chain: opBNB,
    transport: http()
});

const kit = new Eidolon(walletClient, {
    privateKey: process.env.PRIVATE_KEY!
});

// Configuration
const CONFIG = {
    checkInterval: 60000, // Check every 1 minute
    riskThreshold: 70,    // Revoke if risk score > 70
    tokensMonitored: [
        TOKENS.USDT.address,
        TOKENS.USDC.address,
        TOKENS.WBNB.address,
        TOKENS.CAKE.address
    ]
};

async function runSafeGuard() {
    console.log('🛡️ SafeGuard Agent Starting...');
    console.log(`   Account: ${account.address}`);
    console.log(`   Monitoring ${CONFIG.tokensMonitored.length} tokens for high-risk approvals (> ${CONFIG.riskThreshold})`);
    console.log('---------------------------------------------------\n');

    // Main loop
    setInterval(async () => {
        try {
            console.log(`\n🔍 Scanning approvals at ${new Date().toLocaleTimeString()}...`);

            // 1. Check current approvals
            // Note: In a real scenario, you'd check against a list of known spenders or all events
            // For this demo, we assume we are checking specific tokens against known spenders defined in SecurityModule
            // + any specific high-risk contracts you might want to add.
            // The current kit.security.checkApprovals checks against PANCAKE_ROUTER, BatchExecutor, etc.

            const approvals = await kit.security.checkApprovals(CONFIG.tokensMonitored);

            if (approvals.length === 0) {
                console.log('✅ No active approvals found for monitored tokens.');
                return;
            }

            console.log(`⚠️ Found ${approvals.length} active approvals:`);

            for (const approval of approvals) {
                console.log(`   - Token: ${approval.token} -> Spender: ${approval.spender} (Amt: ${approval.allowance})`);

                // 2. Scan the spender contract
                console.log(`     Running security scan on spender: ${approval.spender}...`);
                const scanResult = await kit.security.scanContract(approval.spender);

                console.log(`     Risk Score: ${scanResult.riskScore}/100 | Honeypot: ${scanResult.isHoneypot}`);

                // 3. Auto-Revoke if risky
                if (scanResult.riskScore > CONFIG.riskThreshold || scanResult.isHoneypot) {
                    console.log('     🚨 HIGH RISK DETECTED! Initiating auto-revoke...');

                    const tx = await kit.security.revokeApproval(approval.spender, approval.token);
                    console.log(`     ✅ REVOKED. Tx: ${tx.hash}`);
                } else {
                    console.log('     ✅ Spender appears safe (below threshold).');
                }
            }

        } catch (error) {
            console.error('❌ Error in SafeGuard loop:', error);
        }
    }, CONFIG.checkInterval);
}

// Start
runSafeGuard().catch(console.error);
