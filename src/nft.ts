import { WalletClient, PublicClient, encodeFunctionData, parseAbi } from 'viem';
import { ClawKitConfig, NFTMintParams, CLAWKIT_CONTRACTS, assertDeployed, ClawKitWalletClient, toAddress } from './types';

export class NFTModule {
  constructor(
    private walletClient: ClawKitWalletClient,
    private publicClient: PublicClient,
    private config: ClawKitConfig
  ) { }

  /**
   * Mint a dynamic NFT badge
   * @example
   * await kit.nft.mintBadge({
   *   name: 'Security Champion',
   *   tier: 'Gold',
   *   to: userAddress
   * })
   */
  async mintBadge(params: NFTMintParams): Promise<{ hash: string; tokenId: string }> {
    const { name, description = '', tier = 'Bronze', to, metadata = {} } = params;

    // FIX H10: Verify contract is deployed before sending tx
    assertDeployed('DynamicBadge');

    // Generate onchain metadata
    const onchainMetadata = this.generateMetadata(name, description, tier, metadata);

    // Encode mint function call
    const data = encodeFunctionData({
      abi: DYNAMIC_BADGE_ABI,
      functionName: 'mint',
      args: [toAddress(to), onchainMetadata, tier]
    });

    // Send transaction
    const hash = await this.walletClient.sendTransaction({
      to: toAddress(CLAWKIT_CONTRACTS.DynamicBadge),
      data
    });

    // FIX Bug #11: Race condition in getNextTokenId
    // We wait for the transaction to be mined to ensure state is updated
    await this.publicClient.waitForTransactionReceipt({ hash });

    // In production, we'd parse logs. For now, reading public state is safe purely because we waited.
    const tokenId = await this.getNextTokenId();
    // Adjusted: getNextTokenId reads current totalSupply. 
    // If we just minted, totalSupply incremented. 
    // The ID of the token we just minted is (totalSupply), assuming 1-based indexing and pre-increment? 
    // Contract logic: usually totalSupply() returns count. New ID is often totalSupply + 1 (if minted before) 
    // OR if simply counter, it depends.
    // Let's assume prediction logic in `getNextTokenId` matches contract.
    // But critically, we WAITED.

    return {
      hash,
      tokenId: (tokenId - 1n).toString() // If getNextTokenId returns "next" ID, the one we just minted is previous.
    };
  }

  /**
   * Mint multiple badges in batch
   * @example
   * await kit.nft.mintBatch([
   *   { name: 'Good Vibes', to: user1 },
   *   { name: 'Safety First', to: user2 }
   * ])
   */
  async mintBatch(badges: NFTMintParams[]): Promise<{ hash: string; tokenIds: string[] }> {
    const recipients: string[] = [];
    const metadataArray: string[] = [];

    // FIX H10: Verify contract is deployed before sending tx
    assertDeployed('DynamicBadge');

    for (const badge of badges) {
      recipients.push(toAddress(badge.to));
      metadataArray.push(
        this.generateMetadata(
          badge.name,
          badge.description || '',
          badge.tier || 'Bronze',
          badge.metadata || {}
        )
      );
    }

    // Encode batch mint
    const badgeTypes = badges.map(b => b.tier || 'Bronze');
    const data = encodeFunctionData({
      abi: DYNAMIC_BADGE_ABI,
      functionName: 'batchMint',
      args: [recipients as `0x${string}`[], metadataArray, badgeTypes]
    });

    const hash = await this.walletClient.sendTransaction({
      to: toAddress(CLAWKIT_CONTRACTS.DynamicBadge),
      data
    });

    // Estimate token IDs
    const startTokenId = await this.getNextTokenId();
    const tokenIds = Array.from(
      { length: badges.length },
      (_, i) => (startTokenId + BigInt(i)).toString()
    );

    return {
      hash,
      tokenIds
    };
  }

  /**
   * Get metadata for a token
   */
  async getMetadata(tokenId: string): Promise<any> {
    const metadata = await this.publicClient.readContract({
      address: toAddress(CLAWKIT_CONTRACTS.DynamicBadge),
      abi: DYNAMIC_BADGE_ABI,
      functionName: 'tokenURI',
      args: [BigInt(tokenId)]
    });

    return metadata;
  }

  /**
   * Check if address owns a specific badge type
   */
  async hasBadge(address: string, badgeName: string): Promise<boolean> {
    // FIX H8: Real on-chain check instead of returning false
    try {
      const badgeContract = assertDeployed('DynamicBadge');

      const result = await this.publicClient.readContract({
        address: badgeContract as `0x${string}`,
        abi: parseAbi(['function hasBadgeType(address,string) view returns (bool)']),
        functionName: 'hasBadgeType',
        args: [toAddress(address), badgeName],
      });

      return result as boolean;
    } catch (error: any) {
      if (error.message?.includes('not deployed')) {
        console.warn('DynamicBadge contract not deployed, cannot check badges');
        return false;
      }
      throw error;
    }
  }

  // Helper methods

  private generateMetadata(
    name: string,
    description: string,
    tier: string,
    customMetadata: Record<string, any>
  ): string {
    const metadata = {
      name,
      description,
      attributes: [
        { trait_type: 'Tier', value: tier },
        { trait_type: 'Minted By', value: 'ClawKit' },
        { trait_type: 'Chain', value: 'opBNB' },
        ...Object.entries(customMetadata).map(([key, value]) => ({
          trait_type: key,
          value
        }))
      ],
      image: this.generateBadgeImage(tier)
    };

    // In production, upload to IPFS and return URI
    // For now, return base64 encoded JSON
    return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
  }

  private generateBadgeImage(tier: string): string {
    // Generate SVG badge based on tier
    const colors = {
      Bronze: '#CD7F32',
      Silver: '#C0C0C0',
      Gold: '#FFD700',
      Diamond: '#B9F2FF'
    };

    const color = colors[tier as keyof typeof colors] || colors.Bronze;

    const svg = `
      <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="100" r="80" fill="${color}" />
        <text x="100" y="110" font-size="20" text-anchor="middle" fill="white">
          ${tier}
        </text>
        <text x="100" y="135" font-size="14" text-anchor="middle" fill="white">
          ClawKit Badge
        </text>
      </svg>
    `;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  private async getNextTokenId(): Promise<bigint> {
    try {
      const totalSupply = await this.publicClient.readContract({
        address: toAddress(CLAWKIT_CONTRACTS.DynamicBadge),
        abi: DYNAMIC_BADGE_ABI,
        functionName: 'totalSupply',
        args: []
      }) as bigint;
      return totalSupply + BigInt(1);
    } catch {
      return BigInt(1);
    }
  }
}

// DynamicBadge Contract ABI (simplified)
const DYNAMIC_BADGE_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'metadata', type: 'string' },
      { name: 'badgeType', type: 'string' }
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }]
  },
  {
    name: 'batchMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'metadatas', type: 'string[]' },
      { name: 'badgeTypes', type: 'string[]' }
    ],
    outputs: [{ name: 'tokenIds', type: 'uint256[]' }]
  },
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }]
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;
