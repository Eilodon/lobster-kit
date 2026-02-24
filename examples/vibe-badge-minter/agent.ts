/**
 * VibeBadge Minter - Example OpenClaw Agent using Eidolon
 * 
 * This agent analyzes user mood from chat messages and mints
 * NFT badges when positive vibes are detected.
 */

import { Eidolon } from '@eidolon/bnb';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { opBNB } from 'viem/chains';

// Initialize Eidolon
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({
  account,
  chain: opBNB,
  transport: http()
});

const kit = new Eidolon(walletClient, {
  privateKey: process.env.PRIVATE_KEY!
});

/**
 * Analyze sentiment from user message
 * In production, this would use a real sentiment analysis API
 */
function analyzeSentiment(message: string): number {
  const positiveWords = [
    'good', 'great', 'awesome', 'happy', 'excited', 
    'love', 'amazing', 'wonderful', 'fantastic', 'vibes'
  ];
  
  const negativeWords = [
    'bad', 'sad', 'angry', 'hate', 'terrible',
    'awful', 'horrible', 'depressed', 'stressed'
  ];

  const lowerMessage = message.toLowerCase();
  let score = 0.5; // neutral

  positiveWords.forEach(word => {
    if (lowerMessage.includes(word)) score += 0.1;
  });

  negativeWords.forEach(word => {
    if (lowerMessage.includes(word)) score -= 0.1;
  });

  return Math.max(0, Math.min(1, score)); // Clamp between 0-1
}

/**
 * Determine badge tier based on sentiment score
 */
function getBadgeTier(sentiment: number): 'Bronze' | 'Silver' | 'Gold' | 'Diamond' {
  if (sentiment >= 0.9) return 'Diamond';
  if (sentiment >= 0.7) return 'Gold';
  if (sentiment >= 0.5) return 'Silver';
  return 'Bronze';
}

/**
 * OpenClaw Skill Definition
 */
export const vibeBadgeSkill = {
  name: 'mint_vibe_badge',
  description: 'Mint an NFT badge based on detected positive vibes',
  parameters: {
    message: {
      type: 'string',
      description: 'User message to analyze'
    },
    userWallet: {
      type: 'string',
      description: 'User wallet address to receive the badge'
    }
  },
  
  execute: async ({ message, userWallet }: { message: string; userWallet: string }) => {
    try {
      // Analyze sentiment
      const sentiment = analyzeSentiment(message);
      console.log(`📊 Sentiment score: ${sentiment.toFixed(2)}`);

      // Only mint if positive vibes detected
      if (sentiment < 0.6) {
        return {
          success: false,
          message: '😔 No strong positive vibes detected. Keep spreading good vibes!'
        };
      }

      // Determine badge tier
      const tier = getBadgeTier(sentiment);
      console.log(`🎖️ Badge tier: ${tier}`);

      // Mint the badge using Eidolon
      const { hash, tokenId } = await kit.nft.mintBadge({
        name: 'Good Vibes Champion',
        description: `Awarded for spreading positive energy! Sentiment: ${(sentiment * 100).toFixed(0)}%`,
        tier,
        to: userWallet,
        metadata: {
          sentiment: sentiment.toFixed(2),
          message: message.substring(0, 100), // First 100 chars
          timestamp: Date.now()
        }
      });

      console.log(`✅ Badge minted! Token ID: ${tokenId}`);
      console.log(`📝 Transaction: ${hash}`);

      return {
        success: true,
        message: `🎉 Congratulations! You've been awarded a ${tier} Good Vibes Badge!\n\nToken ID: ${tokenId}\nTransaction: https://opbnb.bscscan.com/tx/${hash}`,
        data: {
          tokenId,
          tier,
          sentiment,
          transactionHash: hash
        }
      };

    } catch (error) {
      console.error('❌ Error minting badge:', error);
      return {
        success: false,
        message: '😥 Failed to mint badge. Please try again later.',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
};

/**
 * Example usage in OpenClaw agent
 */
export async function setupVibeBadgeAgent() {
  // In OpenClaw, you would register this skill with the agent
  console.log('🦞 VibeBadge Minter Agent initialized');
  console.log('📝 Available commands:');
  console.log('  - "I\'m feeling great today!" -> Analyzes sentiment and mints badge if positive');
  console.log('  - "Just helped someone!" -> Mints badge for good actions');
  console.log('  - "Spreading good vibes!" -> Mints badge for positivity');
  
  return {
    skill: vibeBadgeSkill,
    description: 'Autonomous NFT badge minter for good vibes detection'
  };
}

/**
 * Test function (for development)
 */
async function test() {
  console.log('🧪 Testing VibeBadge Minter...\n');

  const testWallet = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'; // Replace with test wallet

  const testMessages = [
    "I'm feeling amazing today! Life is great! 🎉",
    "Just had a good day helping people",
    "This is okay",
    "Not feeling great today"
  ];

  for (const message of testMessages) {
    console.log(`\n📨 Testing message: "${message}"`);
    const result = await vibeBadgeSkill.execute({
      message,
      userWallet: testWallet
    });
    console.log('Result:', result.message);
    console.log('---');
  }
}

// Run test if executed directly
if (require.main === module) {
  test().catch(console.error);
}
