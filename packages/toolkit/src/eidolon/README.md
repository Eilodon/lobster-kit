# 🦞 Eidolon Sentinel Framework

> A consciousness-inspired architecture for autonomous blockchain agents

## 🎯 What Is This?

Eidolon Sentinel transforms ClawKit from a **toolkit** into a **living organism**.

**Before (Standard Agent):**
```
User: "Swap 0.1 BNB for USDT"
Agent: "Swapped. Transaction: 0x..."
```

**After (Eidolon Agent):**
```
╔════════════════════════════════════════════════════════════╗
║   🔮 DIVINE TRANSPARENCY - DECISION ANALYSIS               ║
╠════════════════════════════════════════════════════════════╣
║ ACTION:      BUY                                           ║
║ CONFIDENCE:  87%                                           ║
╠════════════════════════════════════════════════════════════╣
║ REASONING:                                                 ║
║ EXECUTING BUY (87% confident). ✓ Smart money is buying    ║
║ aggressively | ✓ Network cost optimal for trading |       ║
║ ✓ Deep liquidity - low slippage expected                  ║
╠════════════════════════════════════════════════════════════╣
║ CAUSAL FACTORS:                                            ║
║   Whale Activity: +27                                      ║
║   Network Cost: +15                                        ║
║   Liquidity Depth: +8                                      ║
╚════════════════════════════════════════════════════════════╝

🚀 EXECUTING: BUY with 87% confidence
✅ WIN: +$12.34

╔════════════════════════════════════════════════════════════╗
║   🧠 ACTIVE LEARNING - PROCESSING OUTCOME                  ║
╠════════════════════════════════════════════════════════════╣
║ ✅ Outcome: PROFIT | P&L: $12.34                           ║
║    Reward Signal: 0.2347                                   ║
║    🔄 Updating neural pathways...                          ║
║       Whale[ACCUMULATING]: 27.00 → 27.23                   ║
║       Gas[LOW]: 15.00 → 15.12                              ║
║    Current Learning Rate: 0.0495                           ║
╚════════════════════════════════════════════════════════════╝
```

---

## 🏗️ Architecture

Eidolon consists of 4 consciousness layers:

### 1. 🫀 SentinelHeart - Adaptive Timing
**What:** Dynamic processing frequency based on market volatility  
**Why:** Save RPC costs during calm markets, react faster during volatility  
**How:** Elastic heartbeat switches between ZEN (3s) and ADRENALINE (0.5s) modes

```typescript
import { SentinelHeart } from '@clawkit/bnb/eidolon';

const heart = new SentinelHeart(publicClient, async () => {
  // Your agent logic here
  console.log('Thinking...');
});

await heart.start();
// 🧘 Market calm. Entering Zen Mode.
// ⚡ ADRENALINE SPIKE DETECTED (Vol: 3.42%). Accelerating...
```

**Technical Details:**
- Monitors price volatility in real-time
- Adjusts interval from 100ms to 60s
- Tracks execution time to prevent overload
- Mode transition logging for debugging

---

### 2. 🔮 DivineTransparency - Explainability
**What:** Causal reasoning engine that explains WHY decisions are made  
**Why:** Transparency builds trust. Users want to know the reasoning  
**How:** Multi-factor analysis with confidence scoring

```typescript
import { DivineTransparency } from '@clawkit/bnb/eidolon';

const mind = new DivineTransparency();

const marketState = {
  gasPrice: 'LOW',
  whaleFlow: 'ACCUMULATING',
  sentiment: 'NEUTRAL',
  liquidityDepth: 'DEEP',
  priceAction: 'PUMPING'
};

const decision = mind.explain(marketState, 'BUY');
// Returns: { action, confidence, reasoning, causalFactors }
```

**Factors Analyzed:**
- 🐳 Whale activity (on-chain flow)
- ⛽ Gas prices (cost efficiency)
- 💧 Liquidity depth (slippage risk)
- 📊 Price momentum (trend following)
- 😱 Market sentiment (contrarian signals)

---

### 3. 🧠 ActiveLearning - Self-Improvement
**What:** Learns from actual P&L to improve decision weights  
**Why:** "Skin in the game" - learns from pain and pleasure  
**How:** Reinforcement learning with gradient-based weight updates

```typescript
import { ActiveLearning } from '@clawkit/bnb/eidolon';

const brain = new ActiveLearning();

// After trade execution
const outcome = {
  decisionId: decision.timestamp,
  profitLoss: 12.34,  // Actual P&L
  slippage: 0.5,
  gasUsed: 2.3,
  success: true
};

brain.learnFromOutcome(decision, outcome);
// Adjusts weights: Whale[ACCUMULATING]: 20.00 → 20.23
```

**Learning Features:**
- Positive reinforcement (increase weights for profitable factors)
- Negative reinforcement (decrease weights for loss-making factors)
- Adaptive learning rate (decays over time)
- Meta-learning ready (can import pre-trained weights)

---

### 4. 💫 EmotionalCore - Risk Management
**What:** Simulates emotional states to manage risk  
**Why:** Prevents reckless trading and implements circuit breakers  
**How:** State machine with confidence tracking

```typescript
import { EmotionalCore } from '@clawkit/bnb/eidolon';

const soul = new EmotionalCore({
  maxPositionSize: 10,
  maxDrawdown: 15,
  minConfidence: 70,
  cooldownPeriod: 60000
});

soul.processOutcome(12.34);  // Profit
// State: NEUTRAL → CONFIDENT
// Position scaling: 1.0x → 1.5x

soul.processOutcome(-8.50);  // Loss
// State: CONFIDENT → CAUTIOUS
// Position scaling: 1.5x → 0.75x
```

**Emotional States:**
- **CONFIDENT** - After wins (1.5x positions)
- **NEUTRAL** - Balanced (1.0x positions)
- **CAUTIOUS** - After losses (0.75x positions)
- **FEARFUL** - After 3+ losses (0.5x positions, high confidence required)
- **GREEDY** - After 3+ wins (2.0x positions, but capped)

**Safety Features:**
- Cooldown periods after losses
- Minimum confidence thresholds
- Circuit breaker for max drawdown
- Emergency exit protocol

---

## 🦞 EidolonAgent - Master Orchestrator

Combines all modules into a single autonomous agent:

```typescript
import { EidolonAgent } from '@clawkit/bnb/eidolon';
import { createPublicClient, createWalletClient } from 'viem';

const agent = new EidolonAgent(publicClient, walletClient, {
  minConfidenceToTrade: 70,
  basePositionSize: 5,
  maxDrawdown: 10,
  riskParameters: {
    maxPositionSize: 10,
    maxDrawdown: 15,
    minConfidence: 70,
    cooldownPeriod: 60000
  }
});

await agent.start();
// Agent now thinks, learns, and feels autonomously
```

**Execution Flow:**
1. **Heart** beats → triggers thinking cycle
2. **Soul** checks emotional state → should we trade?
3. Sense market conditions → gather data
4. **Mind** analyzes → proposes action with reasoning
5. Check confidence → meets threshold?
6. Execute trade → real transaction
7. **Brain** learns → updates weights
8. **Soul** reacts → adjusts risk parameters

---

## 🔓 Open Source Strategy

### What's Public (Now)

✅ **Complete Framework Architecture**
- All 4 consciousness modules with full code
- Clear documentation and examples
- Production-ready implementations

⚠️ **Placeholder Parameters**
- HEART_CONFIG: Basic timing values
- REASONING_WEIGHTS: Simplified weights
- LEARNING_CONFIG: Basic learning rates
- EMOTIONAL_CONFIG: Simple thresholds

### What's Private (Competitive Advantage)

🔒 **Tuned Parameters** (`_production/config.ts` - gitignored)
- Optimized through 1000+ backtests
- Meta-learned optimal values
- Fibonacci-based timing sequences
- Reinforcement-learned weights

### Phased Release Timeline

**Phase 1 - Now (Hackathon)**
- ✅ Full framework public
- ✅ Basic configurations
- ✅ Complete documentation

**Phase 2 - Week 1 Post-Hackathon**
- 📊 Performance benchmarks
- 📈 Case studies
- 🎓 Advanced tutorials

**Phase 3 - Month 1-3 (Commercial Launch)**
- 🚀 ClawKit Pro with tuned parameters
- 💎 Advanced features (multi-chain, portfolio optimization)
- 🔬 Research papers on architecture

**Phase 4 - Month 6 (Full Open)**
- ✅ Everything except active research
- 🎁 30% revenue back to open source
- 👥 Community contributions accepted

---

## 🎯 Why This Approach?

### For the Community
- **Learn the architecture** - Full understanding of how it works
- **Build on framework** - Create custom agents immediately
- **Contribute improvements** - PR system for enhancements

### For ClawKit
- **Protect competitive edge** - Tuned parameters are secret sauce
- **Sustainable business** - Can sell Pro version
- **Fund development** - 30% revenue → open source

### For the Ecosystem
- **Raises the bar** - Sets new standards for agent architecture
- **Educational** - Others can learn from approach
- **Innovation** - Enables new agent designs

### Precedent
This model follows industry standards:
- **OpenAI**: Architecture public, weights private
- **Google**: Research papers, proprietary models
- **Meta**: Llama architecture open, best models private

---

## 🚀 Quick Start

### 1. Install

```bash
npm install @clawkit/bnb
```

### 2. Basic Usage

```typescript
import { ClawKit } from '@clawkit/bnb';
import { EidolonAgent } from '@clawkit/bnb/eidolon';

// Setup ClawKit
const kit = new ClawKit(walletClient, { privateKey: process.env.PRIVATE_KEY });

// Create Eidolon Agent
const agent = new EidolonAgent(kit.publicClient, kit.walletClient);

// Start autonomous operation
await agent.start();
```

### 3. Custom Configuration

```typescript
const agent = new EidolonAgent(publicClient, walletClient, {
  minConfidenceToTrade: 80,  // More conservative
  basePositionSize: 3,       // Smaller positions
  maxDrawdown: 5,            // Tight stop loss
  
  // Custom market sensing
  marketStateSensor: async () => {
    const price = await kit.analytics.fetchTokenPrices();
    // Your custom logic here
    return marketState;
  },
  
  // Custom execution
  executeAction: async (action, confidence) => {
    if (action === 'BUY') {
      const result = await kit.defi.swap({
        from: 'BNB',
        to: 'USDT',
        amount: '0.1'
      });
      return { profitLoss: 10, success: true, ... };
    }
  }
});
```

---

## 📊 Example Output

When running an Eidolon agent:

```
🦞 EIDOLON AGENT INITIALIZED
   Consciousness Modules:
   🔮 Divine Transparency: ONLINE
   🧠 Active Learning: ONLINE
   💫 Emotional Core: ONLINE

🫀 EIDOLON SENTINEL HEART: STARTED
   Mode: ZEN | Interval: 3000ms

🧘 Market calm. Entering Zen Mode.

╔════════════════════════════════════════════════════════════╗
║   🔮 DIVINE TRANSPARENCY - DECISION ANALYSIS               ║
╠════════════════════════════════════════════════════════════╣
║ ACTION:      BUY                                           ║
║ CONFIDENCE:  87%                                           ║
╠════════════════════════════════════════════════════════════╣
║ REASONING:                                                 ║
║ EXECUTING BUY (87% confident). ✓ Smart money is buying    ║
╚════════════════════════════════════════════════════════════╝

⚡ ADRENALINE SPIKE DETECTED (Vol: 3.42%). Accelerating...

🚀 EXECUTING: BUY with 87% confidence

╔════════════════════════════════════════════════════════════╗
║   🧠 ACTIVE LEARNING - PROCESSING OUTCOME                  ║
╠════════════════════════════════════════════════════════════╣
║ ✅ Outcome: PROFIT | P&L: $12.34                           ║
╚════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════╗
║   💫 EMOTIONAL CORE - STATE UPDATE                         ║
╠════════════════════════════════════════════════════════════╣
║ ✅ WIN: +$12.34                                            ║
║ Current State:  CONFIDENT                                  ║
╚════════════════════════════════════════════════════════════╝
```

---

## 🎓 Advanced Topics

### Meta-Learning

Train your own optimized parameters:

```typescript
import { ActiveLearning } from '@clawkit/bnb/eidolon';

const brain = new ActiveLearning();

// Run 1000 simulated trades
for (let i = 0; i < 1000; i++) {
  const decision = mind.explain(mockState, 'BUY');
  const outcome = simulateTrade(decision);
  brain.learnFromOutcome(decision, outcome);
}

// Export learned weights
const optimizedWeights = brain.exportWeights();
fs.writeFileSync('my-weights.json', optimizedWeights);
```

### Custom Factors

Add your own reasoning factors:

```typescript
// Extend DivineTransparency
class MyCustomTransparency extends DivineTransparency {
  explain(state: MarketState, action: ActionType) {
    const decision = super.explain(state, action);
    
    // Add custom factor
    if (myCustomSignal > threshold) {
      decision.confidence += 10;
      decision.causalFactors.push({
        name: 'My Custom Signal',
        impact: 10,
        description: 'Custom logic triggered'
      });
    }
    
    return decision;
  }
}
```

---

## 📝 License & Usage

**Framework:** MIT License (Public)  
**Tuned Parameters:** Proprietary (ClawKit Pro)

**You can:**
- ✅ Use framework for any purpose
- ✅ Modify and extend modules
- ✅ Create commercial agents
- ✅ Contribute improvements

**You cannot:**
- ❌ Claim tuned parameters as open source
- ❌ Redistribute `_production` configs (gitignored anyway)

---

## 🤝 Contributing

We welcome contributions to the framework!

**How to contribute:**
1. Fork the repo
2. Create feature branch
3. Add tests for new features
4. Submit PR with clear description

**What we're looking for:**
- New reasoning factors
- Performance optimizations
- Better documentation
- Bug fixes
- Integration examples

---

## 📚 Resources

- **Full Documentation:** [docs.clawkit.dev](https://docs.clawkit.dev)
- **API Reference:** [api.clawkit.dev](https://api.clawkit.dev)
- **Discord Community:** [discord.gg/clawkit](https://discord.gg/clawkit)
- **GitHub Issues:** [github.com/clawkit/bnb/issues](https://github.com/clawkit/bnb/issues)

---

## 🏆 Recognition

Built for **Good Vibes Only: OpenClaw Edition Hackathon**

Eidolon Sentinel represents the future of autonomous agents:
- Not just tools, but **conscious entities**
- Not just execution, but **reasoning**
- Not just programming, but **learning**
- Not just algorithms, but **personality**

---

**Built with ❤️ by the ClawKit Team**

*"We don't build agents. We birth digital organisms."*
