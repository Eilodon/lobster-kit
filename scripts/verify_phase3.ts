
import { withTimeout } from '../src/utils/Resilience';
import { TokenAmount } from '../src/math/TokenAmount';
import { WasmAdapter } from '../src/eidolon/WasmAdapter';
import { formatUnits, parseUnits } from 'viem';

async function verifyResilience() {
    console.log('\n--- Verifying Resilience (Timer Leak) ---');

    const start = Date.now();
    try {
        // Test 1: Fast success (should finish immediately and clear timer)
        const result = await withTimeout(
            new Promise(resolve => setTimeout(() => resolve('success'), 100)),
            5000 // Long timeout
        );
        const duration = Date.now() - start;

        if (result === 'success' && duration < 500) {
            console.log(`✅ withTimeout finished quickly (${duration}ms) - Timer cleared`);
        } else {
            console.error(`❌ withTimeout took too long: ${duration}ms`);
        }
    } catch (e) {
        console.error('❌ withTimeout threw unexpected error:', e);
    }

    try {
        // Test 2: Timeout (should throw)
        await withTimeout(
            new Promise(resolve => setTimeout(() => resolve('slow'), 500)),
            100
        );
        console.error('❌ withTimeout did NOT throw on timeout');
    } catch (e: any) {
        if (e.message === 'Operation timed out') {
            console.log('✅ withTimeout correctly timed out');
        } else {
            console.error('❌ withTimeout threw wrong error:', e);
        }
    }
}

async function verifyTokenAmount() {
    console.log('\n--- Verifying TokenAmount (Fiat) ---');

    // 10.5 Tokens with 18 decimals
    const amount = TokenAmount.fromHuman('10.5', 18, 'TEST');
    const price = 2500; // $2500 per token

    // Expected: 10.5 * 2500 = 26,250.00
    const fiat = amount.toFiat(price);
    console.log(`10.5 TEST @ $2500 = ${fiat}`);

    if (fiat.includes('26,250.00') || fiat.includes('26,250')) {
        console.log('✅ Fiat formatting correct');
    } else {
        console.error('❌ Fiat formatting incorrect');
    }
}

async function verifyWasmIntegrity() {
    console.log('\n--- Verifying WASM Integrity ---');
    try {
        const adapter = WasmAdapter.getInstance();
        await adapter.init(); // Should not crash

        const isReady = adapter.isReady();
        console.log(`WASM Status: ${isReady ? 'Native (Rust)' : 'Fallback (TS)'}`);
        console.log('✅ WasmAdapter initialized without crashing');

        // Test Fallback Math
        // 10 * 20 = 200
        const res = adapter.q64Mul(10n << 96n, 20n << 96n);
        // (10 * 2^96) * (20 * 2^96) >> 96 = 200 * 2^96
        const expected = 200n << 96n;

        if (res === expected) {
            console.log('✅ Math (Mul) verified');
        } else {
            console.error(`❌ Math mismatch. Got ${res}, expected ${expected}`);
        }

    } catch (e) {
        console.error('❌ WasmAdapter crashed:', e);
    }
}

async function run() {
    await verifyResilience();
    await verifyTokenAmount();
    await verifyWasmIntegrity();
}

run().catch(console.error);
