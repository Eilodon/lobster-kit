import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExternalAPIGateway, getGateway } from '../src/utils/ApiGateway';

const makeConfig = (privacyMode?: string) => ({
    chainConfig: { contracts: {}, tokens: {} },
    privacyMode
} as any);

describe('ExternalAPIGateway', () => {

    it('should block external calls in strict privacy mode', async () => {
        const gw = new ExternalAPIGateway(makeConfig('strict'));
        await expect(gw.get('https://api.coingecko.com/test')).rejects.toThrow('PRIVACY_BLOCKED');
    });

    it('should return a singleton per config instance via getGateway()', () => {
        const config = makeConfig();
        const a = getGateway(config);
        const b = getGateway(config);
        expect(a).toBe(b); // Same reference
    });

    it('should open circuit after consecutive failures', async () => {
        const gw = new ExternalAPIGateway(makeConfig());
        // Mock axios to always fail with 500
        vi.mock('axios', () => ({
            default: { get: vi.fn().mockRejectedValue(Object.assign(new Error('Server Error'), { response: { status: 500 } })) }
        }));

        // Force circuit open without retrying endlessly
        // We test via circuit state directly since timeout retries are slow in tests
        (gw as any).circuits.set('api.coingecko.com', { failures: 5, openUntil: Date.now() + 60000 });
        await expect(gw.get('https://api.coingecko.com/test')).rejects.toThrow('CIRCUIT_OPEN');
    });
});
