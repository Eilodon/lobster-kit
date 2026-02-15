/**
 * 🛡️ EXAMPLE: VibeMinter with Eidolon Guard
 * 
 * This example shows the "Divine Hand" architecture:
 * 1. BRAIN (Simulated Loop): Decides what to do
 * 2. GUARD (Eidolon): Validates the decision for risk/safety
 * 3. HAND (ClawKit): Executes the validated action
 */

import { ClawKit } from '../../src';
import { EidolonGuard, MarketState, ActionType, TradeOutcome, ClawOracle } from '../../src/eidolon';
import { createPublicClient, createWalletClient, http } from 'viem';
import { opBNB } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Setup
import * as dotenv from 'dotenv';
dotenv.config();

import { generatePrivateKey } from 'viem/accounts';

const privateKey = process.env.PRIVATE_KEY as `0x${string}` || generatePrivateKey();
if (!process.env.PRIVATE_KEY) {
  console.warn('⚠️ No PRIVATE_KEY found in .env, using random generated key for demo.');
}

const account = privateKeyToAccount(privateKey);

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

// --- 1. THE BRAIN (Simulated Logic) ---
// In a real app, this would be OpenClaw or an LLM

/**
 * BRAIN LOGIC
 * Determines Action based on Market State
 */
async function brainDecideAction(state: MarketState): Promise<{ action: ActionType, confidence: number }> {
  // Simple heuristic brain
  if (state.priceAction === 'PUMPING') return { action: 'BUY', confidence: 85 };
  if (state.priceAction === 'DUMPING') return { action: 'SELL', confidence: 75 };
  return { action: 'HOLD', confidence: 50 };
}

// --- 2. THE EYE (Real Oracle) ---
const oracle = new ClawOracle(kit);

async function senseMarket(): Promise<MarketState> {
  console.log('👁️  Sensing REAL market data via ClawOracle...');
  const state = await oracle.sense();
  // Override some static fields for demo if oracle returns stubs
  return {
    ...state,
    whaleFlow: 'NEUTRAL', // Stubbed in V2
    sentiment: 'NEUTRAL'  // Stubbed in V2
  };
}

// --- 2. THE HAND (Execution) ---
async function executeAction(action: ActionType, confidence: number): Promise<TradeOutcome> {
  // Simulate execution
  console.log(`__HAND: Executing ${action}...`);
  return {
    decisionId: Date.now(),
    profitLoss: action === 'BUY' ? 10 : -5, // Fake result
    slippage: 0.1,
    gasUsed: 0.0001,
    success: true
  };
}


// --- MAIN LOOP ---
async function main() {
  console.log('🛡️ Starting Eidolon-Guarded Agent\n');

  // Initialize Guard
  const guard = new EidolonGuard(publicClient, walletClient, {
    maxRiskScore: 50, // Strict risk
    minConfidence: 70,
    riskParameters: {
      maxPositionSize: 10,
      maxDrawdown: 10,
      minConfidence: 70,
      cooldownPeriod: 5000
    },
    marketStateSensor: senseMarket // Inject sensor
  });

  await guard.init();

  // Run 3 simulation ticks
  for (let i = 0; i < 3; i++) {
    console.log(`\n--- TICK ${i + 1} ---`);

    // 1. Brain: Sense and Decide
    const marketState = await senseMarket();
    console.log(`BRAIN: Sensed ${marketState.whaleFlow} / ${marketState.priceAction}`);

    const decision = await brainDecideAction(marketState);
    console.log(`BRAIN: Proposed ${decision.action} with ${decision.confidence}% confidence`);

    // 2. Guard: Validate
    const validation = await guard.validateAction(decision.action, { marketState });

    if (validation.approved) {
      console.log(`🛡️ GUARD: APPROVED (Risk: ${validation.riskScore})`);
      console.log(`   Reason: ${validation.reason}`);

      // 3. Hand: Execute
      const outcome = await executeAction(decision.action, decision.confidence);

      // 4. Feedback
      await guard.learn(decision.action, outcome);
      console.log(`🛡️ GUARD: Learned from outcome`);

    } else {
      console.log(`🛡️ GUARD: DENIED (Risk: ${validation.riskScore})`);
      console.log(`   Reason: ${validation.reason}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }
}

main().catch(console.error);
