/**
 * 🦞 EXAMPLE: VibeMinter with Eidolon Consciousness
 * 
 * This example shows how to integrate Eidolon Sentinel with ClawKit
 * to create a self-aware, learning NFT minting agent
 */

import { ClawKit } from '../../src';
import { EidolonAgent, MarketState, ActionType, TradeOutcome } from '../../src/eidolon';
import { createPublicClient, createWalletClient, http } from 'viem';
import { opBNB } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Setup
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const publicClient = createPublicClient({
  chain: opBNB,
  transport: http()
});

const walletClient = createWalletClient({
  account,
  chain: opBNB,
  transport: http()
});

const kit = new ClawKit(walletClient, {
  privateKey: process.env.PRIVATE_KEY!
});

// Custom market sensing using ClawKit analytics
// Custom market sensing using Deterministic Scenario Generator (for Demos)
let tick = 0;
// Scenario: Calm -> Accumulation -> Pump -> Euphoria -> Dump -> Panic
const SCENARIO_SEQUENCE: MarketState[] = [
  { gasPrice: 'LOW', whaleFlow: 'NEUTRAL', sentiment: 'NEUTRAL', liquidityDepth: 'DEEP', priceAction: 'RANGING' },
  { gasPrice: 'LOW', whaleFlow: 'ACCUMULATING', sentiment: 'NEUTRAL', liquidityDepth: 'DEEP', priceAction: 'RANGING' },
  { gasPrice: 'MEDIUM', whaleFlow: 'ACCUMULATING', sentiment: 'NEUTRAL', liquidityDepth: 'DEEP', priceAction: 'PUMPING' },
  { gasPrice: 'HIGH', whaleFlow: 'NEUTRAL', sentiment: 'EUPHORIC', liquidityDepth: 'DEEP', priceAction: 'PUMPING' },
  { gasPrice: 'HIGH', whaleFlow: 'DUMPING', sentiment: 'FEAR', liquidityDepth: 'THIN', priceAction: 'DUMPING' },
  { gasPrice: 'LOW', whaleFlow: 'NEUTRAL', sentiment: 'FEAR', liquidityDepth: 'DEEP', priceAction: 'RANGING' },
];

async function senseMarket(): Promise<MarketState> {
  // Get real market data from ClawKit (for gas validation)
  const gasEstimate = await kit.gas.getOptimalExecutionTime();
  const gasPriceGwei = parseFloat(gasEstimate.currentGasPrice);

  // Pick scenario based on tick
  const scenarioIndex = tick % SCENARIO_SEQUENCE.length;
  const scenario = SCENARIO_SEQUENCE[scenarioIndex];

  console.log(`\n🎭 DEMO SCENARIO [${scenarioIndex + 1}/${SCENARIO_SEQUENCE.length}]:`);
  console.log(`   Whales: ${scenario.whaleFlow} | Sentiment: ${scenario.sentiment} | Price: ${scenario.priceAction}`);

  // Override gas price with real data if it's extreme, otherwise use scenario
  const gasPrice = gasPriceGwei > 10 ? 'HIGH' : scenario.gasPrice;

  tick++;
  return {
    ...scenario,
    gasPrice
  };
}

// Custom execution using ClawKit NFT module
async function executeAction(action: ActionType, confidence: number): Promise<TradeOutcome> {
  const timestamp = Date.now();

  try {
    if (action === 'BUY') {
      // In this context, "buying" means minting a vibe badge
      console.log(`\n🎨 Minting Vibe Badge with ${confidence}% confidence...`);

      const tier = confidence > 90 ? 'Diamond' :
        confidence > 75 ? 'Gold' :
          confidence > 60 ? 'Silver' : 'Bronze';

      const userAddress = await walletClient.getAddresses().then(a => a[0]);

      const result = await kit.nft.mintBadge({
        name: `Good Vibes ${tier}`,
        description: `Minted by Eidolon Agent with ${confidence}% confidence`,
        tier,
        to: userAddress,
        metadata: {
          Confidence: confidence.toString(),
          'Minted At': new Date().toISOString(),
          'Agent State': 'CONSCIOUS'
        }
      });

      console.log(`✅ Badge minted! Token ID: ${result.tokenId}`);
      console.log(`   Transaction: ${result.hash}`);

      // Estimate profit (gas saved by optimal timing)
      const profitEstimate = confidence > 80 ? 5 : confidence > 60 ? 2 : -1;

      return {
        decisionId: timestamp,
        profitLoss: profitEstimate,
        slippage: 0,
        gasUsed: 3,
        success: true
      };

    } else if (action === 'HOLD') {
      console.log('⏸️  Holding. Waiting for better conditions...');

      return {
        decisionId: timestamp,
        profitLoss: 0,
        slippage: 0,
        gasUsed: 0,
        success: true
      };

    } else {
      // SELL or EMERGENCY_EXIT not applicable for NFT minting
      return {
        decisionId: timestamp,
        profitLoss: 0,
        slippage: 0,
        gasUsed: 0,
        success: true
      };
    }

  } catch (error) {
    console.error('❌ Execution failed:', error);

    return {
      decisionId: timestamp,
      profitLoss: -5, // Gas wasted
      slippage: 0,
      gasUsed: 2,
      success: false
    };
  }
}

// Main execution
async function main() {
  console.log('🦞 Starting Eidolon-Powered VibeMinter Agent\n');

  // Create Eidolon Agent with custom configuration
  const agent = new EidolonAgent(
    publicClient,
    walletClient,
    {
      minConfidenceToTrade: 70,
      basePositionSize: 5,
      maxDrawdown: 10,
      riskParameters: {
        maxPositionSize: 10,
        maxDrawdown: 15,
        minConfidence: 70,
        cooldownPeriod: 60000
      },

      // Inject custom market sensing
      marketStateSensor: senseMarket,

      // Inject custom execution
      executeAction: executeAction,

      // Inject demo price oracle for Heartbeat
      priceOracle: async () => {
        // Simple sine wave volatility simulation for demo
        const time = Date.now();
        const basePrice = 600;
        const volatility = Math.sin(time / 5000) * 15; // ±15 volatility
        return basePrice + volatility;
      }
    }
  );

  // Start the agent
  await agent.start();

  // Let it run for a while
  console.log('\n⏱️  Agent running... Press Ctrl+C to stop\n');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    agent.stop();
    process.exit(0);
  });
}

// Error handling
main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

/**
 * Example output:
 * 
 * 🦞 Starting Eidolon-Powered VibeMinter Agent
 * 
 * 🦞 EIDOLON AGENT INITIALIZED
 *    Consciousness Modules:
 *    🔮 Divine Transparency: ONLINE
 *    🧠 Active Learning: ONLINE
 *    💫 Emotional Core: ONLINE
 * 
 * 🫀 EIDOLON SENTINEL HEART: STARTED
 *    Mode: ZEN | Interval: 3000ms
 * 
 * 🧘 Market calm. Entering Zen Mode.
 * 
 * ╔════════════════════════════════════════════════════════════╗
 * ║   🔮 DIVINE TRANSPARENCY - DECISION ANALYSIS               ║
 * ╠════════════════════════════════════════════════════════════╣
 * ║ ACTION:      BUY                                           ║
 * ║ CONFIDENCE:  87%                                           ║
 * ╠════════════════════════════════════════════════════════════╣
 * ║ REASONING:                                                 ║
 * ║ EXECUTING BUY (87% confident). ✓ Smart money is buying    ║
 * ║ aggressively | ✓ Network cost optimal for trading         ║
 * ╚════════════════════════════════════════════════════════════╝
 * 
 * 🎨 Minting Vibe Badge with 87% confidence...
 * ✅ Badge minted! Token ID: 42
 *    Transaction: 0x1234...5678
 * 
 * ╔════════════════════════════════════════════════════════════╗
 * ║   🧠 ACTIVE LEARNING - PROCESSING OUTCOME                  ║
 * ╠════════════════════════════════════════════════════════════╣
 * ║ ✅ Outcome: PROFIT | P&L: $5.00                            ║
 * ║    Reward Signal: 0.0995                                   ║
 * ║    🔄 Updating neural pathways...                          ║
 * ╚════════════════════════════════════════════════════════════╝
 */
