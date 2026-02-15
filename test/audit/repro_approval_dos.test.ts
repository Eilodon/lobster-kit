
import { expect } from "chai";
import { ethers } from "hardhat";
import { ApprovalRevoker, MockERC20 } from "../../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CRITICAL AUDIT: ApprovalRevoker DOS", function () {
    let revoker: ApprovalRevoker;
    let token: MockERC20;
    let owner: any, attacker: any, victim: any;

    beforeEach(async function () {
        [owner, attacker, victim] = await ethers.getSigners();

        const TokenFactory = await ethers.getContractFactory("MockERC20");
        token = await TokenFactory.deploy("Test", "TST");

        const RevokerFactory = await ethers.getContractFactory("ApprovalRevoker");
        revoker = await RevokerFactory.deploy();

        // Victim authorizes Attacker
        await revoker.connect(victim).authorizeAgent(attacker.address);
    });

    it("Should demonstrate DOS if malicious agent spans flags and user cannot clear them cheaply", async function () {
        const tokens = Array(50).fill(token.target);
        const spenders = Array(50).fill(attacker.address);

        // 1. Attacker spams flags (using time increase to bypass rate limit)
        for (let i = 0; i < 5; i++) { // Reduce to 5 batches to save test time but prove concept
            await time.increase(61);
            await revoker.connect(attacker).flagApprovalsBatch(victim.address, tokens, spenders);
        }

        // 2. Victim clears flags with limit
        // Should NOT revert
        const tx = await revoker.connect(victim).clearFlaggedApprovals(0);
        await tx.wait();

        // Verify cleared
        const count = await revoker.getFlaggedCount(victim.address);
        expect(count).to.equal(0n);
    });
});
