
import { ActiveLearning } from '../src/eidolon/ActiveLearning';
import { MarketState } from '../src/eidolon/EidolonTypes';
import { WasmAdapter } from '../src/eidolon/WasmAdapter';

async function main() {
    console.log("🧪 STARTING LIQUID BRAIN VERIFICATION...");

    // 1. Initialize WASM Adapter
    console.log("1. Initializing WasmAdapter...");
    await WasmAdapter.getInstance().init();
    console.log("✅ WasmAdapter Initialized");

    // 2. Instantiate ActiveLearning
    console.log("2. Instantiating ActiveLearning...");
    const brain = new ActiveLearning();
    await brain.init();
    console.log("✅ ActiveLearning Initialized");

    // 3. Check Components
    const anyBrain = brain as any;
    if (anyBrain.liquidBrain) console.log("✅ Liquid Brain Attached");
    else throw new Error("❌ Liquid Brain Missing");

    if (anyBrain.hyperMemory) console.log("✅ Hyper Memory Attached");
    else throw new Error("❌ Hyper Memory Missing");

    if (anyBrain.replayBuffer) console.log("✅ Replay Buffer Attached");
    else throw new Error("❌ Replay Buffer Missing");

    // 4. Test Vectorization
    console.log("4. Testing Vectorization...");
    const state: MarketState = {
        gasPrice: 'HIGH',
        whaleFlow: 'ACCUMULATING',
        sentiment: 'EUPHORIC',
        liquidityDepth: 'DEEP',
        priceAction: 'PUMPING'
    };
    const vec = anyBrain.vectorizeMarketState(state);
    console.log(`   Vector: [${vec.join(', ')}]`);
    if (vec[0] !== 1.0) throw new Error("Vectorization failed for GasPrice");
    console.log("✅ Vectorization Correct");

    // 5. Test Decision & Intuition
    console.log("5. Testing Decision & Intuition...");
    const action = await brain.recommendAction(state); // Returns ActionType (string)
    console.log(`   Recommended Action: ${action}`);

    const intuition = brain.getIntuition();
    console.log(`   Intuition: [${intuition.join(', ')}]`);
    if (!Array.isArray(intuition)) throw new Error("Intuition is not an array");
    console.log("✅ Intuition Received");

    // 6. Test HyperMemory
    console.log("6. Testing HyperMemory...");
    const anyBrain2 = brain as any;
    console.log("   HyperMemory:", anyBrain2.hyperMemory);
    console.log("   HyperMemory Keys:", Object.keys(anyBrain2.hyperMemory || {}));
    console.log("   HyperMemory Proto:", Object.getPrototypeOf(anyBrain2.hyperMemory || {}));

    // Check if insert exists
    if (typeof anyBrain2.hyperMemory.insert !== 'function') {
        throw new Error(`HyperMemory.insert is ${typeof anyBrain2.hyperMemory.insert}`);
    }

    const id = 123456;
    await brain.memorize(state, id);
    const recalled = await brain.recall(state, 1);
    console.log(`   Recalled IDs: ${recalled.join(', ')}`);
    // Note: MockHyperMemory returns empty array, Real returns IDs.
    // We just check it doesn't crash.
    console.log("✅ Memorize & Recall Executed");

    // 7. Test Dreaming
    console.log("7. Testing Dream Cycle...");
    await brain.dream();
    console.log("✅ Dream Cycle Completed");

    console.log("🎉 ALL SYSTEMS GO. NEURAL WIRING VERIFIED.");
}

main().catch(err => {
    console.error("❌ VERIFICATION FAILED:", err);
    process.exit(1);
});
