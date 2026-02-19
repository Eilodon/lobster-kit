
import { WasmAdapter } from '../src/eidolon/WasmAdapter';

async function main() {
    console.log('🧪 VERIFYING WASM EXPORTS...');

    const adapter = WasmAdapter.getInstance();
    await adapter.init();

    if (!adapter.isReady()) {
        console.error('❌ WASM not loaded (fallback mode)');
        return;
    }

    console.log('✅ WASM Loaded');

    // 1. Check AntiRug
    console.log('\n--- AntiRug ---');
    try {
        const antiRug = adapter.createAntiRug();
        const proto = Object.getPrototypeOf(antiRug);
        console.log('Methods:', Object.getOwnPropertyNames(proto));

        if (typeof (antiRug as any).compute_score === 'function') {
            console.log('✅ compute_score exists');
        } else {
            console.error('❌ compute_score MISSING');
        }
    } catch (e) {
        console.error('Error creating AntiRug:', e);
    }

    // 2. Check CausalGraph
    console.log('\n--- CausalGraph ---');
    try {
        const graph = adapter.createCausalGraph();
        if (graph) {
            const proto = Object.getPrototypeOf(graph);
            console.log('Methods:', Object.getOwnPropertyNames(proto));
            if (typeof (graph as any).learn === 'function') {
                console.log('✅ learn exists');
            } else {
                console.error('❌ learn MISSING');
            }
        } else {
            console.log('Mock CausalGraph used (WASM Ctor missing)');
        }
    } catch (e) {
        console.error('Error creating CausalGraph:', e);
    }

    // 3. Check TraumaRegistry
    console.log('\n--- TraumaRegistry ---');
    try {
        const registry = adapter.createTraumaRegistry();
        if (registry) {
            const proto = Object.getPrototypeOf(registry);
            console.log('Methods:', Object.getOwnPropertyNames(proto));
            if (typeof (registry as any).record_trauma === 'function') {
                console.log('✅ record_trauma exists');
            } else {
                console.error('❌ record_trauma MISSING');
            }
        } else {
            console.log('Mock TraumaRegistry used (WASM Ctor missing)');
        }
    } catch (e) {
        console.error('Error creating TraumaRegistry:', e);
    }

}

main().catch(console.error);
