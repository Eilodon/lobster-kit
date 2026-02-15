
import { expect } from "chai";
import { ethers } from "hardhat";
import { BatchExecutor } from "../../typechain-types";

describe("CRITICAL AUDIT: BatchExecutor Refund Brick", function () {
    let executor: BatchExecutor;
    let owner: any;
    let maliciousUser: any;

    beforeEach(async function () {
        [owner, maliciousUser] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("BatchExecutor");
        executor = await Factory.deploy();
        await executor.authorizeExecutor(owner.address);
    });

    it("Should NOT revert if refund fails (Anti-Brick)", async function () {
        // 1. Send ETH to executor (excess)
        await owner.sendTransaction({ to: executor.target, value: ethers.parseEther("1.0") });

        // 2. We need a way to make the refund fail.
        // Deploy malicious rejector
        const RejectorFactory = await ethers.getContractFactory("RejectEther");
        const rejector = await RejectorFactory.deploy();

        // Authorize the rejector to call batch (so it can be msg.sender)
        await executor.authorizeExecutor(rejector.target);

        // 3. Rejector calls batch/single.
        // Uses the 'attack' method in RejectEther mock which triggers executeSingle and refund.
        await (rejector as any).attack(executor.target);

        // If we are here, it didn't revert! 
    });
});
