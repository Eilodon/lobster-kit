/**
 * WasmAdapter Stub for @clawkit/core
 *
 * Core package uses TypeScript-only fallback.
 * For real WASM acceleration, use @clawkit/soul.
 */
export class WasmAdapter {
    private static instance: WasmAdapter;

    static getInstance(): WasmAdapter {
        if (!WasmAdapter.instance) {
            WasmAdapter.instance = new WasmAdapter();
        }
        return WasmAdapter.instance;
    }

    /** Stub: always returns null (no WASM in core) */
    createCausalGraph(): null {
        return null;
    }
}
