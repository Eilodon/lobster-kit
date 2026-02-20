
import { vi } from 'vitest';
import { WasmAdapter } from '../src/WasmAdapter';

export function mockWasmAdapter() {
    // Mock the singleton behavior
    const mockInstance = {
        init: vi.fn().mockResolvedValue(undefined),
        createTraumaRegistry: vi.fn().mockReturnValue(null), // Force fallback to TS
        createCausalGraph: vi.fn().mockReturnValue(null),
        ValueInvariant: vi.fn(),
        AntiRug: vi.fn(),
        isReady: vi.fn().mockReturnValue(true),
    };

    // Spy on getInstance to return our mock
    vi.spyOn(WasmAdapter, 'getInstance').mockReturnValue(mockInstance as any);

    return mockInstance;
}
