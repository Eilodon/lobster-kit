
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EidolonSimulator, ShadowTransaction } from '@clawkit/soul';
import { GoPlusSecurity } from '@clawkit/soul';
import { PythAdapter } from '@clawkit/soul';
import axios from 'axios';

// Mock dependencies
import axios from 'axios';
vi.mock('axios', () => {
    return {
        default: {
            get: vi.fn()
        }
    };
});

class MockWebSocket {
    onopen: () => void = () => { };
    onmessage: (event: any) => void = () => { };
    onerror: (err: any) => void = () => { };
    onclose: () => void = () => { };
    send: (data: any) => void = () => { };
    close: () => void = () => { };
    readyState = 1; // OPEN
    constructor(public url: string) {
        setTimeout(() => this.onopen(), 10);
    }
}
global.WebSocket = MockWebSocket as any;

describe('Atomic Audit Phase 3 Verification', () => {

    describe('EidolonSimulator: Infinite Money & Footprint', () => {
        let simulator: EidolonSimulator;
        let mockClient: any;

        beforeEach(() => {
            mockClient = {
                createAccessList: vi.fn(),
                call: vi.fn().mockResolvedValue({ data: '0x' }),
                estimateGas: vi.fn().mockResolvedValue(21000n)
            };
            simulator = new EidolonSimulator({ publicClient: mockClient } as any);
        });

        it('should NOT inject Infinite Money Glitch by default (secure default)', async () => {
            const tx: ShadowTransaction = {
                to: '0xTarget',
                data: '0x',
                account: '0xUser'
            };

            await simulator.simulate(tx);

            expect(mockClient.call).toHaveBeenCalledWith(expect.objectContaining({
                stateOverride: undefined
            }));
        });

        it('should inject Infinite Money Glitch only when simulateAsWhale=true', async () => {
            const tx: ShadowTransaction = {
                to: '0xTarget',
                data: '0x',
                account: '0xUser',
                simulateAsWhale: true
            };

            await simulator.simulate(tx);

            expect(mockClient.call).toHaveBeenCalledWith(expect.objectContaining({
                stateOverride: expect.objectContaining({
                    '0xUser': { balance: '0x21E19E0C9BAB2400000' }
                })
            }));
        });

        it('should NOT inject Infinite Money Glitch if simulateAsWhale is false', async () => {
            const tx: ShadowTransaction = {
                to: '0xTarget',
                data: '0x',
                account: '0xUser',
            };
            (tx as any).simulateAsWhale = false;

            await simulator.simulate(tx);

            expect(mockClient.call).not.toHaveBeenCalledWith(expect.objectContaining({
                stateOverride: expect.objectContaining({
                    '0xUser': { balance: '0x21E19E0C9BAB2400000' }
                })
            }));
        });

        it('should THROW on footprint scan failure', async () => {
            mockClient.createAccessList.mockRejectedValue(new Error('RPC Error'));

            const tx: ShadowTransaction = { to: '0xTarget', data: '0x', account: '0xUser' };
            await expect(simulator.scanFootprint(tx)).rejects.toThrow('Footprint Scan Failed');
        });
    });

    describe('GoPlusSecurity: Fail Closed', () => {
        let security: GoPlusSecurity;

        beforeEach(() => {
            security = new GoPlusSecurity();
            vi.resetAllMocks();
        });

        it('should THROW on API error instead of returning null', async () => {
            vi.mocked(axios.get).mockRejectedValue(new Error('Network Error'));

            await expect(security.checkToken('0xToken')).rejects.toThrow('Security Oracle Offline');
        });
    });

    describe('PythAdapter: WebSocket & Hybrid Fallback', () => {
        let adapter: PythAdapter;

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should use WebSocket cache for zero-latency lookup', async () => {
            adapter = new PythAdapter();
            // Simulate WS receiving message
            // Wait for constructor timeout
            await new Promise(r => setTimeout(r, 20));

            // Manually inject into cache since mocking the exact WS message flow is complex 
            // given valid hermes format requirements. We test onPriceUpdate directly as proxy to WS handler.
            const feedId = (adapter as any).getDefaultFeedId('BNB');
            adapter.onPriceUpdate(feedId, 500.0);

            const price = await adapter.getPrice('BNB');
            expect(price).toBe(500.0);
            expect(axios.get).not.toHaveBeenCalled();
        });

        it('should fallback to HTTP on cache miss (Warm-up)', async () => {
            adapter = new PythAdapter();
            vi.mocked(axios.get).mockResolvedValue({
                data: {
                    parsed: [{
                        price: { price: '30000000000', expo: -8 } // 300.0
                    }]
                }
            });

            // Cache is empty
            const price = await adapter.getPrice('BNB');
            expect(price).toBe(300.0);
            expect(axios.get).toHaveBeenCalled();

            // Subsequent call should be cached (if logic sets cache on http fallback)
            // Current logic sets cache on http fallback: this.priceCache.set(feedId, price);
            vi.mocked(axios.get).mockClear();
            const price2 = await adapter.getPrice('BNB');
            expect(price2).toBe(300.0);
            expect(axios.get).not.toHaveBeenCalled();
        });
    });

});
