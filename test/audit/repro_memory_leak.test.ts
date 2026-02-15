
import { expect } from "chai";
import { ActiveLearning, TradeOutcome } from "../../src/eidolon/ActiveLearning";

describe("CRITICAL AUDIT: ActiveLearning Memory Leak", function () {
    let learner: ActiveLearning;

    beforeEach(function () {
        // Mock dependencies if needed, or rely on defaults with mocked storage
        learner = new ActiveLearning({} as any);
        // We need to bypass storage loading/saving issues if any.
        // ActiveLearning constructor loads state. 
        // We can inspect the instance directly.
    });

    it("Should cap trade history size to prevent memory leak", async function () {
        // 1. Push 2500 items (limit is 1000 or 2000 in code)
        // Code says: if > 2000, slice to 1000.

        for (let i = 0; i < 2500; i++) {
            await learner.learnFromOutcome({
                decisionId: i.toString(),
                marketState: {
                    price: 100,
                    volume: 1000,
                    volatility: 0.1,
                    trend: 0.1,
                    rsi: 50,
                    gasPrice: "5",
                    liquidity: 100000,
                    whaleFlow: "0"
                },
                causalFactors: [] // Empty factors to skip weight updates recursion
            } as any, {
                decisionId: i,
                profitLoss: 10,
                slippage: 0,
                gasUsed: 0,
                success: true
            });
        }

        // 2. Check size
        const historySize = (learner as any).tradeHistory.length;
        console.log(`History size after 2500 pushes: ${historySize}`);

        expect(historySize).to.be.lessThanOrEqual(2000);
        expect(historySize).to.be.greaterThanOrEqual(1000);
    });
});
