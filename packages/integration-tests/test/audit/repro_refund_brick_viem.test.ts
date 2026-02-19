
import { describe, it, expect, beforeAll } from 'vitest';
import { createWalletClient, createPublicClient, http, parseEther, getContractAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

const CHAIN = hardhat;
const TRANSPORT = http('http://127.0.0.1:8545');

type Artifact = { abi: unknown; bytecode: `0x${string}` };

async function loadArtifact(paths: string[]): Promise<Artifact | null> {
    for (const p of paths) {
        try {
            const mod = await import(p);
            const artifact = (mod as { default?: Artifact }).default ?? (mod as unknown as Artifact);
            if (artifact?.abi && artifact?.bytecode) return artifact;
        } catch {
            // try next path
        }
    }
    return null;
}

describe('CRITICAL AUDIT: BatchExecutor Refund Brick (Viem)', () => {
    const ownerAccount = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

    const client = createWalletClient({
        account: ownerAccount,
        chain: CHAIN,
        transport: TRANSPORT
    });

    const publicClient = createPublicClient({
        chain: CHAIN,
        transport: TRANSPORT
    });

    let executorAddress: `0x${string}`;
    let rejectorAddress: `0x${string}`;
    let batchExecutorArtifact: Artifact | null = null;
    let rejectEtherArtifact: Artifact | null = null;
    let isReady = false;

    beforeAll(async () => {
        try {
            await publicClient.getBlockNumber();
        } catch (e) {
            console.warn("Skipping test: No local node found");
            return;
        }

        batchExecutorArtifact = await loadArtifact([
            '../../artifacts/contracts/BatchExecutor.sol/BatchExecutor.json',
            '../../../../artifacts/contracts/BatchExecutor.sol/BatchExecutor.json'
        ]);
        rejectEtherArtifact = await loadArtifact([
            '../../artifacts/contracts/mocks/RejectEther.sol/RejectEther.json',
            '../../../../artifacts/contracts/mocks/RejectEther.sol/RejectEther.json'
        ]);
        if (!batchExecutorArtifact || !rejectEtherArtifact) {
            console.warn('Skipping test: required contract artifacts not found');
            return;
        }

        // Deploy Executor
        const execHash = await client.deployContract({
            abi: batchExecutorArtifact.abi as any,
            bytecode: batchExecutorArtifact.bytecode
        });
        const execReceipt = await publicClient.waitForTransactionReceipt({ hash: execHash });
        if (!execReceipt.contractAddress) throw new Error("Executor deploy failed");
        executorAddress = execReceipt.contractAddress;

        // Authorize owner
        const authHash = await client.writeContract({
            address: executorAddress,
            abi: batchExecutorArtifact.abi as any,
            functionName: 'authorizeExecutor',
            args: [ownerAccount.address]
        });
        await publicClient.waitForTransactionReceipt({ hash: authHash });

        // Fund executor
        await client.sendTransaction({
            to: executorAddress,
            value: parseEther("1.0")
        });
        isReady = true;
    });

    it("Should NOT revert if refund fails (Anti-Brick)", async () => {
        if (!isReady || !batchExecutorArtifact || !rejectEtherArtifact) return;
        try {
            await publicClient.getBlockNumber();
        } catch (e) { return; }

        // Deploy malicious rejector
        const rejectHash = await client.deployContract({
            abi: rejectEtherArtifact.abi as any,
            bytecode: rejectEtherArtifact.bytecode
        });
        const rejectReceipt = await publicClient.waitForTransactionReceipt({ hash: rejectHash });
        if (!rejectReceipt.contractAddress) throw new Error("Rejector deploy failed");
        rejectorAddress = rejectReceipt.contractAddress;

        // Authorize rejector
        const authHash = await client.writeContract({
            address: executorAddress,
            abi: batchExecutorArtifact.abi as any,
            functionName: 'authorizeExecutor',
            args: [rejectorAddress]
        });
        await publicClient.waitForTransactionReceipt({ hash: authHash });

        // Call attack() on RejectEther which calls executor
        // Since we can't easily call "attack" via wallet (it's a contract calling contract), 
        // we simulate interaction or use the wallet to call attack if the account controls it? 
        // No, RejectEther has no owner check in `attack`. Anyone can call it.

        const attackHash = await client.writeContract({
            address: rejectorAddress,
            abi: rejectEtherArtifact.abi as any,
            functionName: 'attack',
            args: [executorAddress]
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: attackHash });
        expect(receipt.status).toBe('success');
    });
});
