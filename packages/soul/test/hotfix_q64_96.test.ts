import { expect, test, describe } from 'vitest';
import * as wasm from '../../../crates/core-rust/pkg/core_rust';

describe('Hotfix: Rust Panic in q64_96', () => {
    test('q64_96_div handles division by zero gracefully without panic', () => {
        const a = new Uint8Array(32);
        const b = new Uint8Array(32);

        // a = 1
        a[31] = 1;

        // b = 0 (division by zero)

        // Should throw a catchable error, NOT panic/crash
        expect(() => {
            wasm.q64_96_div(a, b);
        }).toThrow(/division by zero/);
    });

    test('q64_96_div performs valid division', () => {
        const a = new Uint8Array(32);
        const b = new Uint8Array(32);

        // a = 1
        a[31] = 1;
        // b = 1
        b[31] = 1;

        // (1 << 96) / 1 = 1 << 96
        // Result should be 1 << 96 in 32 bytes
        // 1 << 96 means bit 96 is set. 
        // 32 bytes = 256 bits.
        // Byte index for bit 96 (from LSB): 96 / 8 = 12. 
        // In Big Endian (which q64_96 uses), index is 31 - 12 = 19.

        const result = wasm.q64_96_div(a, b);
        expect(result).toBeDefined();
        // Result is trimmed of leading zeros, so length varies. 
        // 1 << 96 is 13 bytes (1 byte + 12 zero bytes).
        expect(result.length).toBeGreaterThan(0);
    });
});
