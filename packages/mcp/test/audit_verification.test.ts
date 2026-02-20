
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecuteSwapTool, PanicTool, OracleSenseTool } from '../src/tools/tools';
import { EidolonGuard } from '@clawkit/soul';
import { WasmAdapter } from '@clawkit/soul';
import { Logger } from '@clawkit/core';

// Mock Logger to silence output
vi.mock('@clawkit/core', async () => {
    const actual = await vi.importActual('@clawkit/core');
    return {
        ...actual,
        Logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }
    };
});

describe('Atomic Audit Verification: MCP & Soul', () => {

    describe('ExecuteSwapTool: Safe Resolve', () => {
        const mockCallDefi = vi.fn();
        const mockGuard = {} as unknown as EidolonGuard; // Not needed for resolve check before Guard call

        const tool = new ExecuteSwapTool(mockCallDefi, mockGuard);

        it('should throw explicit error for invalid token symbols that do not resolve to 0x', async () => {
            // Mock resolveTokenAddress indirectly or rely on it returning input
            // Since we can't easily mock valid imports inside the module without more setup,
            // we'll rely on the fact that "INVALID_TOKEN_XYZ" likely returns itself.

            // Note: In a real integration test we'd mock @clawkit/toolkit.
            // Here we assume the tool uses resolveTokenAddress which mimics identity on failure.

            const args = {
                tokenIn: 'USDT',
                tokenOut: 'INVALID_TOKEN_XYZ', // Should fail regex
                amount: '1'
            };

            // We expect it to fail at safeResolve, arguably before calling DeFi for quote 
            // OR during the quote call if it gets that far. 
            // In the corrected code, safeResolve is called BEFORE guard validation context is built.
            // BUT, wait... 
            // Line 178: usdQuote await callDefi(...)
            // Line 187: context = { tokenAddress: safeResolve(tokenOut) ... }

            // So it calls quote FIRST. We need to mock quote to succeed so we reach safeResolve.
            mockCallDefi.mockResolvedValue({ amountOutMin: '100' });

            // The error might come from resolveTokenAddress directly (InvalidTokenError)
            // or from our safeResolve check (Unknown token symbol).
            // Both are acceptable rejections of invalid input.
            await expect(tool.execute(args)).rejects.toThrow(/InvalidTokenError|Unknown token symbol/);
        });
    });

    describe('PanicTool: Public API Usage', () => {
        it('should call guard.inducePanic directly', async () => {
            const mockCallDefi = vi.fn().mockResolvedValue(['Sold 1 ETH', 'Sold 5 BNB']);
            const mockGuard = {
                inducePanic: vi.fn(),
                soul: { inducePanic: vi.fn() } // Legacy, should NOT be called via casting if fix works
            } as unknown as EidolonGuard;

            const tool = new PanicTool(mockCallDefi, mockGuard);

            await tool.execute({ confirmation: 'CONFIRM_PANIC' });

            expect(mockGuard.inducePanic).toHaveBeenCalledWith('User Manual Trigger');
        });
    });

    describe('OracleSenseTool: Dynamic Params', () => {
        it('should accept quoteToken from args', async () => {
            const mockCallDefi = vi.fn().mockResolvedValue({ amountOutMin: '2000' });
            const tool = new OracleSenseTool(mockCallDefi);

            await tool.execute({ symbol: 'ETH', quoteToken: 'USDC' });

            expect(mockCallDefi).toHaveBeenCalledWith('sense_oracle', expect.objectContaining({
                symbol: 'ETH',
                quoteToken: 'USDC'
            }));
        });
    });

    describe('Soul: Security Fail-Safe', () => {
        it('should return Neutral/Unknown (score 50) instead of Danger (score 0) on default check', async () => {
            // Need to initialize Wasm without failure.
            // WasmAdapter singleton might need init.
            const adapter = WasmAdapter.getInstance();
            await adapter.init();

            const antiRug = adapter.createAntiRug();

            // check_token_security with a random address that is not in whitelist/blacklist
            // should invoke the Rust default return
            const result = antiRug.check_token_security('0x1234567890123456789012345678901234567890');

            // The fix changed score 0 -> 50, and status UNKNOWN
            expect(result.score).toBe(50);
            expect(result.status).toBe('UNKNOWN');
        });
    });

});
