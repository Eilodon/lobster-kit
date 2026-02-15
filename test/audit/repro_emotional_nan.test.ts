
import { expect } from "chai";
import { EmotionalCore } from "../../src/eidolon/EmotionalCore";
import { Vector } from "../../src/eidolon/ai/LinearAlgebra";

// Mock MarketState
const mockMarket = {
    price: 300,
    volume: 1000,
    volatility: 0.5,
    trend: 0.1,
    rsi: 50,
    gasPrice: 5,
    liquidity: 100000,
    whaleFlow: 0
};

describe("CRITICAL AUDIT: EmotionalCore Stability", function () {
    let core: EmotionalCore;

    beforeEach(function () {
        core = new EmotionalCore();
    });

    it("Should handle NaN inputs gracefully and prevent state corruption", async function () {
        // 1. Force NaN into the system via volatility
        // Volatility is multiplied in the system.
        const nanState = await core.tick(NaN);

        console.log("State after NaN tick:", nanState);

        expect(nanState.arousal).to.not.be.NaN;
        expect(nanState.valence).to.not.be.NaN;
        expect(nanState.cortisol).to.not.be.NaN;

        // 2. Force Infinity
        const infState = await core.tick(Infinity);
        expect(infState.arousal).to.not.equal(Infinity);
    });
});
