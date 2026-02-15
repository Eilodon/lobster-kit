
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PythAdapter } from '../../src/eidolon/oracles/PythAdapter';
import axios from 'axios';

vi.mock('axios');

describe('PythAdapter', () => {
    let adapter: PythAdapter;

    beforeEach(() => {
        vi.resetAllMocks();
        adapter = new PythAdapter();
    });

    it('should fetch and parse BNB price correctly', async () => {
        const mockResponse = {
            data: {
                parsed: [{
                    price: {
                        price: "30550000000",
                        expo: -8
                    }
                }]
            }
        };

        vi.mocked(axios.get).mockResolvedValue(mockResponse);

        const price = await adapter.getPrice('BNB');
        expect(price).toBe(305.50);
        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/v2/updates/price/latest'), expect.any(Object));
    });

    it('should throw error on API failure', async () => {
        vi.mocked(axios.get).mockRejectedValue(new Error('Network Error'));

        await expect(adapter.getPrice('BNB')).rejects.toThrow('Network Error');
    });

    it('should throw error on invalid response format', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: {} });

        await expect(adapter.getPrice('BNB')).rejects.toThrow('Invalid Pyth response format');
    });
});
