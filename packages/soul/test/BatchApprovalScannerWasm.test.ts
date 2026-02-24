import { describe, expect, it, beforeAll } from 'vitest';
import { WasmAdapter } from '../src/WasmAdapter';

describe('BatchApprovalScanner WASM Bridge', () => {
    let scanner: any;

    beforeAll(async () => {
        const adapter = WasmAdapter.getInstance();
        console.log("Before init:", adapter.isReady());
        await adapter.init();
        console.log("After init:", adapter.isReady());
        console.log("WASM Exports:", Object.keys((adapter as any).coreModule || {}));

        if (typeof (adapter as any).createBatchApprovalScanner === 'function') {
            scanner = (adapter as any).createBatchApprovalScanner();
        }
    });

    it('should initialize successfully', () => {
        expect(scanner).toBeDefined();
        expect(scanner).not.toBeNull();
    });

    it('should correctly flag malicious spenders from a CSV list', () => {
        const safeSpenders = [
            '0xsaferouter0000000000000000000000000000',
            '0xsafevault00000000000000000000000000000'
        ];

        scanner.add_safe_spenders(safeSpenders);

        const incomingSpenders = [
            '0xsaferouter0000000000000000000000000000',
            '0xsafevault00000000000000000000000000000',
            '0xmalicious00000000000000000000000000000', // index 2
            '0XSAFEROUTER0000000000000000000000000000', // index 3
            '0xscammer0000000000000000000000000000000' // index 4
        ];

        const csv = incomingSpenders.join(',');
        const threatsCSV = scanner.scan_approvals_csv(csv);

        expect(threatsCSV).toBe('2,4');
    });

    it('should return empty string if no threats found', () => {
        const safeSpenders = [
            '0xsaferouter0000000000000000000000000000',
            '0xsafevault00000000000000000000000000000'
        ];
        scanner.add_safe_spenders(safeSpenders);

        const incomingSpenders = [
            '0XSAFEROUTER0000000000000000000000000000',
            '0xsafevault00000000000000000000000000000'
        ];
        const threatsCSV = scanner.scan_approvals_csv(incomingSpenders.join(','));
        expect(threatsCSV).toBe('');
    });
});
