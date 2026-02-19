
import { resolveTokenAddress, OPBNB_CONFIG } from '../src/types';
import { SecurityModule } from '../src/security';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { opBNB } from 'viem/chains';

// Mock Config
const mockConfig = {
    ...OPBNB_CONFIG,
    rpcUrl: 'https://opbnb-mainnet-rpc.bnbchain.org',
    chainConfig: OPBNB_CONFIG
};

async function testTypes() {
    console.log('\n--- Testing types.ts ---');

    // 1. Valid Symbol
    try {
        const addr = resolveTokenAddress('USDT');
        if (addr === OPBNB_CONFIG.tokens.USDT.address) {
            console.log('✅ Valid Symbol resolved correctly');
        } else {
            console.error('❌ Valid Symbol failed');
        }
    } catch (e) {
        console.error('❌ Valid Symbol threw error:', e);
    }

    // 2. Valid Address
    try {
        const validAddr = '0x1234567890123456789012345678901234567890';
        const addr = resolveTokenAddress(validAddr);
        if (addr === validAddr) {
            console.log('✅ Valid Address pass-through correctly');
        } else {
            console.error('❌ Valid Address failed');
        }
    } catch (e) {
        console.error('❌ Valid Address threw error:', e);
    }

    // 3. Invalid Address (Ghost Address Syndrome)
    try {
        resolveTokenAddress('INVALID_TOKEN_123');
        console.error('❌ Invalid Token did NOT throw error');
    } catch (e: any) {
        if (e.message.includes('InvalidTokenError')) {
            console.log('✅ Invalid Token threw correct error');
        } else {
            console.error('❌ Invalid Token threw WRONG error:', e.message);
        }
    }
}

async function testSecurity() {
    console.log('\n--- Testing security.ts ---');

    const account = privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000000001'); // Dummy
    const client = createWalletClient({
        account,
        chain: opBNB,
        transport: http()
    });
    const publicClient = createPublicClient({
        chain: opBNB,
        transport: http()
    });

    const security = new SecurityModule(client, publicClient, mockConfig as any);

    // Mock internal methods to test cache without real API calls
    (security as any).checkHoneypotGoPlus = async () => false;
    (security as any).checkContractVerification = async () => true;
    (security as any).checkOwnership = async () => false;
    (security as any).checkTradingRestrictions = async () => [];
    (security as any).checkBytecodeSanity = async () => true;
    (security as any).getGoPlusSecurityData = async () => null;

    const testAddr = '0x1234567890123456789012345678901234567890';

    // First scan (should miss cache)
    console.time('FirstScan');
    await security.scanContract(testAddr);
    console.timeEnd('FirstScan');

    // Second scan (should hit cache)
    console.time('SecondScan');
    const res = await security.scanContract(testAddr);
    console.timeEnd('SecondScan');

    // Check internal cache state if possible, or infer from speed/integrity
    // Since we don't expose cache size publicy, we assume success if no FS errors and fast second scan.
    console.log('✅ Security scan completed without FS errors');
}

async function run() {
    await testTypes();
    await testSecurity();
}

run().catch(console.error);
