import { PublicClient, encodeFunctionData, parseAbi } from 'viem';
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
    // We parse the receipt logs to find the Transfer event (from 0x0 to user)
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    // Default to prediction if parsing fails, but parsing is robust
    let tokenId = '';

    // Transfer event signature: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
    // Topic0: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    for (const log of receipt.logs) {
      if (log.topics[0] === transferTopic && log.topics[1] &&
        BigInt(log.topics[1]) === 0n) { // From 0x0
        if (log.topics[3]) {
          tokenId = BigInt(log.topics[3]).toString();
          break;
        }
      }
    }

    if (!tokenId) {
      // Fallback to old hazardous method if log not found (unlikely)
      const nextId = await this.getNextTokenId();
      tokenId = (nextId - 1n).toString();
    }

    return {
      hash,
      tokenId
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

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    // FIX Bug #11: Extract all tokenIds from logs
    const tokenIds: string[] = [];
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    for (const log of receipt.logs) {
      if (log.topics[0] === transferTopic && log.topics[1] &&
        BigInt(log.topics[1]) === 0n) { // From 0x0
        if (log.topics[3]) {
          tokenIds.push(BigInt(log.topics[3]).toString());
        }
      }
    }

    // Fallback if logs missing (shouldn't happen)
    if (tokenIds.length === 0) {
      const startTokenId = await this.getNextTokenId();
      // This fallback is still racy but better than nothing
      const approximated = Array.from(
        { length: badges.length },
        (_, i) => (startTokenId - BigInt(badges.length) + BigInt(i)).toString()
      );
      tokenIds.push(...approximated);
    }

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
    customMetadata: Record<string, unknown>
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
