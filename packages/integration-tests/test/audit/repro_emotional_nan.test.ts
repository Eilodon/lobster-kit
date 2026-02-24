
import { expect } from "vitest";
import { EmotionalCore } from "@eidolon/soul";

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

        expect(Number.isNaN(nanState.arousal)).toBe(false);
        expect(Number.isNaN(nanState.valence)).toBe(false);
        expect(Number.isNaN(nanState.cortisol)).toBe(false);

        // 2. Force Infinity
        const infState = await core.tick(Infinity);
        expect(infState.arousal).to.not.equal(Infinity);
    });
});
