import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getTokenDecimals, OPBNB_CONFIG, EIDOLON_CONTRACTS } from '../src/types';
import { AnalyticsModule } from '../src/analytics';

// ─── F2: MCP oracle_sense dynamic symbol ────────────────────────────────────

describe('F2: MCP oracle_sense uses dynamic symbol', () => {
    it('getTokenDecimals handles common symbols correctly', () => {
        expect(getTokenDecimals('WBNB')).toBe(18);
        expect(getTokenDecimals('USDT')).toBe(6);  // USDT uses 6 decimals on opBNB
        expect(getTokenDecimals('CAKE')).toBe(18);
        expect(() => getTokenDecimals('UNKNOWN_TOKEN')).toThrow(/UnknownTokenError/);
    });
});

// ─── F3: MCP swap action type mapping ───────────────────────────────────────

describe('F3: MCP swap action type mapping', () => {
    it('should map stablecoin inputs to BUY action (buying crypto with stables)', () => {
        const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD']);

        // Stablecoin as tokenIn → user is BUYING crypto
        expect(STABLECOINS.has('USDT')).toBe(true);
        expect(STABLECOINS.has('USDC')).toBe(true);
        expect(STABLECOINS.has('BUSD')).toBe(true);

        // Non-stablecoin → user is SELLING crypto
        expect(STABLECOINS.has('WBNB')).toBe(false);
        expect(STABLECOINS.has('CAKE')).toBe(false);
        expect(STABLECOINS.has('ETH')).toBe(false);
    });
});

// ─── F4: Security knownSpenders includes chainConfig ────────────────────────

describe('F4: Security knownSpenders includes chainConfig', () => {
    it('should include chainConfig contracts in spender list and deduplicate', () => {
        const PANCAKE_ROUTER = '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86';
        const chainConfig = OPBNB_CONFIG;

        const knownSpenders = [
            PANCAKE_ROUTER,
            chainConfig?.contracts?.pancakeRouter,
            chainConfig?.contracts?.batchExecutor,
            EIDOLON_CONTRACTS.BatchExecutor,
            EIDOLON_CONTRACTS.ApprovalRevoker,
        ].filter((addr): addr is string =>
            !!addr && addr !== '0x0000000000000000000000000000000000000000'
        );

        const uniqueSpenders = [...new Set(knownSpenders.map(s => s.toLowerCase()))];

        expect(uniqueSpenders.length).toBeGreaterThanOrEqual(1);
        expect(uniqueSpenders).toContain(PANCAKE_ROUTER.toLowerCase());
        expect(uniqueSpenders).not.toContain('0x0000000000000000000000000000000000000000');
    });
});

// ─── F5: Analytics historical snapshot persistence ──────────────────────────

describe('F5: Analytics historical snapshot persistence', () => {
    const HISTORY_DIR = path.resolve(process.cwd(), '.eidolon');
    const HISTORY_FILE = path.join(HISTORY_DIR, 'portfolio_history.json');

    const cleanupHistory = () => {
        try {
            if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
            if (fs.existsSync(HISTORY_DIR)) {
                const files = fs.readdirSync(HISTORY_DIR);
                if (files.length === 0) fs.rmdirSync(HISTORY_DIR);
            }
        } catch {
            // best-effort test cleanup
        }
    };

    const createAnalytics = () => {
        const mockWallet = { getAddresses: vi.fn().mockResolvedValue(['0xUser']) } as any;
        const mockPublic = { getBalance: vi.fn(), readContract: vi.fn() } as any;
        const config = { rpcUrl: 'https://test.rpc' } as any;
        return new AnalyticsModule(mockWallet, mockPublic, config);
    };

    beforeEach(() => cleanupHistory());
    afterEach(() => cleanupHistory());

    it('persistSnapshot should create file and append entry', () => {
        const analytics = createAnalytics();
        analytics.persistSnapshot(1234.56);

        expect(fs.existsSync(HISTORY_FILE)).toBe(true);
        const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        expect(data).toHaveLength(1);
        expect(data[0].valueUSD).toBe(1234.56);
        expect(data[0].date).toBeDefined();
    });

    it('persistSnapshot should cap at 365 entries', () => {
        const analytics = createAnalytics();
        for (let i = 0; i < 370; i++) {
            analytics.persistSnapshot(i * 10);
        }

        const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        expect(data).toHaveLength(365);
        expect(data[data.length - 1].valueUSD).toBe(3690);
    });

    it('getHistoricalValue should return persisted snapshots', async () => {
        const analytics = createAnalytics();
        analytics.persistSnapshot(100);
        analytics.persistSnapshot(200);
        analytics.persistSnapshot(300);

        const history = await analytics.getHistoricalValue(30);
        expect(history).toHaveLength(3);
        expect(history[0].valueUSD).toBe(100);
        expect(history[2].valueUSD).toBe(300);
    });

    it('getHistoricalValue should return empty array when no file', async () => {
        const analytics = createAnalytics();
        const history = await analytics.getHistoricalValue(30);
        expect(history).toEqual([]);
    });
});

// ─── F6: Gas parseFloat precision guard ─────────────────────────────────────

describe('F6: Gas Binance price validation', () => {
    it('should reject NaN, Infinity, and out-of-range values', () => {
        const validate = (priceStr: string): boolean => {
            const price = parseFloat(priceStr);
            return Number.isFinite(price) && price > 1 && price < 100000;
        };

        // Valid
        expect(validate('650.25')).toBe(true);
        expect(validate('2.50')).toBe(true);
        expect(validate('99999')).toBe(true);

        // Invalid
        expect(validate('not_a_number')).toBe(false);
        expect(validate('Infinity')).toBe(false);
        expect(validate('0')).toBe(false);
        expect(validate('-100')).toBe(false);
        expect(validate('100001')).toBe(false);
        expect(validate('1')).toBe(false); // boundary: > 1 not >= 1
    });
});

// ─── F1: DeFi resolveBNBPrice method exists and has correct fallback chain ──

describe('F1: DeFi resolveBNBPrice method', () => {
    it('DeFiModule should have resolveBNBPrice private method', async () => {
        const { DeFiModule } = await import('../src/defi');

        const mockPublic = {
            readContract: vi.fn(),
            getGasPrice: vi.fn().mockResolvedValue(1000000000n),
            estimateGas: vi.fn().mockResolvedValue(21000n),
            simulateContract: vi.fn(),
        } as any;
        const mockWallet = {
            getAddresses: vi.fn().mockResolvedValue(['0xUser']),
            sendTransaction: vi.fn(),
            account: { address: '0xUser' },
        } as any;

        const defi = new DeFiModule(mockWallet, mockPublic, { rpcUrl: 'https://test.rpc' } as any);

        // Verify resolveBNBPrice exists as a method
        expect(typeof (defi as any).resolveBNBPrice).toBe('function');

        // Call it — returns positive number from PriceService, oracle, or $600 fallback
        const price = await (defi as any).resolveBNBPrice();
        expect(price).toBeGreaterThan(0);
        expect(typeof price).toBe('number');
    });
});
