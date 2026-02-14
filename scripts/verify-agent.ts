
import { EidolonAgent } from '../src/eidolon/EidolonAgent';
import { createPublicClient, http } from 'viem';
import { opBNB } from 'viem/chains';

async function main() {
    console.log('🔍 Verifying EidolonAgent Fixes...');

    // Mock public client
    const publicClient = createPublicClient({
        chain: opBNB,
        transport: http()
    });

    // Mock wallet client
    const mockWallet = {
        account: { address: '0x0000000000000000000000000000000000000000' }
    };

    console.log('1. Initializing Agent without config (Expect NO Error)...');
    try {
        const agent = new EidolonAgent(publicClient as any, mockWallet as any); // Type cast if needed
        console.log('✅ Agent initialized successfully.');

        console.log('2. Starting Agent (Expect Defaults to kick in)...');
        // We execute one beat
        await agent.start();

        // Allow it to run for a brief moment then stop
        await new Promise(resolve => setTimeout(resolve, 2000));

        agent.stop();
        console.log('✅ Agent started and stopped without crashing.');

    } catch (error) {
        console.error('❌ Verification Failed:', error);
        process.exit(1);
    }
}

main();
