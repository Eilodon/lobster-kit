/**
 * ✍️ PERMIT2 HELPER
 *
 * Enables gasless token approvals using EIP-712 typed signatures.
 * Instead of sending an `approve()` transaction on-chain, the user signs
 * a PermitSingle message off-chain and the spender submits it with the swap.
 *
 * Permit2 Contract: 0x000000000022D473030F116dDEE9F6B43aC78BA3 (universal)
 *
 * Usage:
 *   const { signature, permit } = await signPermit2(walletClient, token, spender, amount, deadline);
 *   // Pass signature + permit to router/aggregator that supports Permit2
 */

import { parseAbi } from 'viem';
import { ClawKitWalletClient, toAddress } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

const PERMIT2_DOMAIN_NAME = 'Permit2';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PermitSingle {
    details: {
        token: `0x${string}`;
        amount: bigint;
        expiration: number;
        nonce: number;
    };
    spender: `0x${string}`;
    sigDeadline: bigint;
}

export interface Permit2Signature {
    permit: PermitSingle;
    signature: `0x${string}`;
}

// ─── EIP-712 Types ────────────────────────────────────────────────────────────

const PERMIT_SINGLE_TYPES = {
    PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
    ],
    PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
    ],
} as const;

// ─── Permit2 Nonce Fetcher ────────────────────────────────────────────────────

const PERMIT2_ABI = parseAbi([
    'function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

// ─── Main helper ─────────────────────────────────────────────────────────────

/**
 * Sign a Permit2 PermitSingle message for a token.
 *
 * @param walletClient - The viem WalletClient (must have account + signTypedData)
 * @param publicClient - To fetch current nonce from Permit2 contract
 * @param token        - Token address to permit
 * @param spender      - Spender address (e.g. PancakeSwap router)
 * @param amount       - Amount to permit (in raw units, bigint)
 * @param expirySec    - How many seconds until the permit expires (default 30min)
 * @param chainId      - Chain ID for EIP-712 domain
 */
export async function signPermit2(
    walletClient: ClawKitWalletClient,
    publicClient: { readContract: (args: unknown) => Promise<unknown> },
    token: string,
    spender: string,
    amount: bigint,
    chainId: number,
    expirySec: number = 1800
): Promise<Permit2Signature> {
    const [owner] = await walletClient.getAddresses();

    // Fetch current nonce from Permit2 contract
    const [, , nonce] = await publicClient.readContract({
        address: toAddress(PERMIT2_ADDRESS),
        abi: PERMIT2_ABI,
        functionName: 'allowance',
        args: [owner, toAddress(token), toAddress(spender)],
    }) as [bigint, number, number];

    const expiration = Math.floor(Date.now() / 1000) + expirySec;
    const sigDeadline = BigInt(expiration);

    const permit: PermitSingle = {
        details: {
            token: toAddress(token),
            amount,
            expiration,
            nonce,
        },
        spender: toAddress(spender),
        sigDeadline,
    };

    // signTypedData is available on WalletClient
    const signature = await walletClient.signTypedData({
        account: owner,
        domain: {
            name: PERMIT2_DOMAIN_NAME,
            chainId,
            verifyingContract: toAddress(PERMIT2_ADDRESS),
        },
        types: PERMIT_SINGLE_TYPES,
        primaryType: 'PermitSingle',
        message: {
            details: {
                token: permit.details.token,
                amount: permit.details.amount,
                expiration: permit.details.expiration,
                nonce: permit.details.nonce,
            },
            spender: permit.spender,
            sigDeadline: permit.sigDeadline,
        },
    });

    return { permit, signature };
}

/**
 * Encode a Permit2 permit + signature into calldata for routers
 * that accept permit data alongside swap parameters.
 */
export function encodePermit2Data(sig: Permit2Signature): `0x${string}` {
    // Simplified: return raw signature bytes
    // In practice, routers accept the PermitSingle struct + signature packed
    return sig.signature;
}
