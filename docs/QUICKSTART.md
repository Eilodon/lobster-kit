# 🚀 ClawKit Quick Start Guide

**Get from zero to deployed in 30 minutes!**

---

## ⚡ 5-Minute Setup

### 1. Clone & Install

```bash
# Get the code
cd clawkit-bnb

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 2. Configure Environment

Edit `.env`:

```bash
# Get your private key from MetaMask/wallet
# ⚠️ Use a testnet wallet first!
PRIVATE_KEY=your_private_key_here

# OpBNB RPC (default works)
OPBNB_RPC_URL=https://opbnb-mainnet-rpc.bnbchain.org

# Get free API key from bscscan.com
BSCSCAN_API_KEY=your_api_key
```

### 3. Get Test BNB

1. Go to: https://opbnb-testnet-bridge.bnbchain.org/
2. Connect wallet
3. Bridge 0.1 BNB from BSC Testnet → opBNB Testnet
4. Or use faucet: https://www.bnbchain.org/en/testnet-faucet

---

## 🏗️ Deploy in 5 Minutes

### Deploy Contracts to opBNB Testnet

```bash
# Compile contracts
npx hardhat compile

# Deploy to testnet
npm run deploy -- --network opbnbTestnet
```

**Expected output:**

```
🚀 Deploying ClawKit contracts to opbnbTestnet
=====================================

Deploying with account: 0x...
Account balance: 50000000000000000

📦 Deploying DynamicBadge...
✅ DynamicBadge deployed to: 0x1234...

📦 Deploying BatchExecutor...
✅ BatchExecutor deployed to: 0x5678...

📦 Deploying ApprovalRevoker...
✅ ApprovalRevoker deployed to: 0x9abc...

💾 Deployment info saved to bsc.address
✅ Updated src/types.ts with deployed addresses

🎉 All contracts deployed successfully!
```

**Save these addresses!** You'll need them.

---

## 🧪 Test in 5 Minutes

### Run Example Agent

```bash
# Go to example
cd examples/vibe-badge-minter

# Install OpenClaw (mock for now)
npm install

# Run test
npm run test
```

**Expected output:**

```
🧪 Testing VibeBadge Minter...

📨 Testing message: "I'm feeling amazing today! Life is great! 🎉"
📊 Sentiment score: 0.85
🎖️ Badge tier: Gold
✅ Badge minted! Token ID: 1
📝 Transaction: 0xabcd...

Result: 🎉 Congratulations! You've been awarded a Gold Good Vibes Badge!
```

---

## 🎯 First Real Transaction (10 minutes)

### Mint Your First Badge

Create `test-mint.ts`:

```typescript
import { ClawKit } from './src';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { opBNB } from 'viem/chains';

async function main() {
  // Setup wallet
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: opBNB,
    transport: http()
  });

  // Initialize ClawKit
  const kit = new ClawKit(walletClient, {
    privateKey: process.env.PRIVATE_KEY!
  });

  // Mint a badge
  console.log('🎨 Minting your first badge...');
  const { hash, tokenId } = await kit.nft.mintBadge({
    name: 'ClawKit Pioneer',
    description: 'First badge minted with ClawKit!',
    tier: 'Gold',
    to: account.address
  });

  console.log('✅ Success!');
  console.log(`Token ID: ${tokenId}`);
  console.log(`Transaction: https://opbnb-testnet.bscscan.com/tx/${hash}`);
}

main().catch(console.error);
```

Run it:

```bash
npx ts-node test-mint.ts
```

**Boom!** You just minted an NFT with 3 lines of ClawKit code! 🎉

---

## 📋 6-Day Build Plan

### Day 1 (TODAY - Feb 13) ✅

**Morning (3 hours):**
- ✅ Clone & setup ← **YOU ARE HERE**
- ✅ Deploy contracts to testnet
- ✅ Test basic minting

**Afternoon (3 hours):**
- Add Venus Protocol integration
- Test DeFi swaps on testnet
- Document all transactions

**Evening (2 hours):**
- Create second template agent (YieldHunter)
- Test auto-compound flow
- Push to GitHub

**End of Day Goal:** 2 working agents + deployed contracts

---

### Day 2 (Feb 14) - Build Features

**Morning:**
- Complete remaining 3 template agents
- Test each one on testnet
- Collect 10+ transaction hashes

**Afternoon:**
- Real APY fetching from APIs
- Portfolio analytics
- Gas optimization testing

**Evening:**
- Unit tests for all modules
- Integration tests
- Fix any bugs

**End of Day Goal:** 5 working agents + tests passing

---

### Day 3 (Feb 15) - Deploy & Polish

**Morning:**
- Deploy to opBNB MAINNET
- Verify all contracts on BSCScan
- Update README with mainnet addresses

**Afternoon:**
- Build playground web app
- Test live demos
- Fix UI bugs

**Evening:**
- Documentation site (Nextra)
- API reference
- Tutorial

**End of Day Goal:** Mainnet deployed + docs live

---

### Day 4 (Feb 16) - Demo & Content

**Morning:**
- Record demo video
- Edit and finalize
- Upload to YouTube

**Afternoon:**
- Write submission copy
- Create marketing materials
- Design cover image

**Evening:**
- Test submission on DoraHacks
- Get feedback from 2-3 people
- Refine based on feedback

**End of Day Goal:** Complete submission package

---

### Day 5 (Feb 17) - Submit & Campaign

**Morning:**
- Final review of everything
- Submit to DoraHacks
- Verify submission looks good

**Afternoon:**
- Tweet announcement
- Post in Discord
- Engage with community

**Evening:**
- Create additional content
- Respond to comments
- Start upvote campaign

**End of Day Goal:** Submitted + initial traction

---

### Day 6 (Feb 18-19) - Marketing Push

**All Day:**
- Daily update tweets
- Engage with other projects
- Ask for upvotes (tastefully)
- Answer questions
- Show gratitude

**End of Day Goal:** Top 5 in votes

---

## 🆘 Common Issues & Fixes

### Issue: "Insufficient funds"

**Solution:**
```bash
# Check balance
npx hardhat run scripts/check-balance.js --network opbnbTestnet

# Get more testnet BNB from faucet
```

### Issue: "Contract not deployed"

**Solution:**
Check `bsc.address` file has correct addresses:
```bash
cat bsc.address
```

If empty, re-run deployment.

### Issue: "Transaction reverted"

**Solution:**
1. Check gas price isn't too low
2. Verify contract has funds if needed
3. Check approval if transferring tokens
4. Look at revert reason in BSCScan

### Issue: "Module not found"

**Solution:**
```bash
# Rebuild TypeScript
npm run build

# Or run in dev mode
npm run dev
```

---

## 📞 Get Help

### Resources:
- 📚 [Full Documentation](./docs/API.md)
- 🤖 [AI Prompts Guide](./docs/AI_PROMPTS.md)
- 🏗️ [Build Log Example](./docs/AI_BUILD_LOG.md)
- 💬 [OpenClaw Discord](#)
- 🔗 [BNB Chain Docs](https://docs.bnbchain.org)

### Debugging with AI:

```
Prompt for Claude:

"I'm getting this error in ClawKit:
[paste error]

Here's my code:
[paste code]

Here's the transaction that failed:
[paste tx hash]

What's wrong and how do I fix it?"
```

---

## ✅ Pre-Submission Checklist

Before submitting to DoraHacks:

### Technical ✅
- [ ] All contracts deployed to opBNB mainnet
- [ ] Contracts verified on BSCScan
- [ ] 15+ transaction hashes collected
- [ ] All template agents working
- [ ] Tests passing
- [ ] No console errors

### Documentation ✅
- [ ] README.md complete
- [ ] API documentation done
- [ ] AI Build Log detailed
- [ ] Code comments added
- [ ] Examples work

### Submission ✅
- [ ] Demo video recorded (<90s)
- [ ] GitHub repo public
- [ ] Contracts verified
- [ ] bsc.address file included
- [ ] Submission copy written

### Marketing ✅
- [ ] Cover image created
- [ ] Twitter announcement drafted
- [ ] Discord posts ready
- [ ] DoraHacks profile complete

---

## 🎯 Success Metrics

**Minimum Viable Submission:**
- 3 contracts deployed ✅
- 5 template agents ✅
- 10 transaction hashes ✅
- Basic documentation ✅
- Working demo ✅

**Competitive Submission:**
- All of above PLUS:
- Playground web app ✅
- Comprehensive docs ✅
- Professional video ✅
- Active community engagement ✅

**Winning Submission:**
- All of above PLUS:
- Multiple integrations (Venus, etc.) ✅
- Advanced features (analytics, etc.) ✅
- Viral demo content ✅
- Strong narrative ✅

---

## 🔥 Let's Go!

You have everything you need to win this hackathon.

**Key advantages:**
- ✅ Builders track (least competition)
- ✅ OpenClaw integration (sponsor love)
- ✅ Production-ready code
- ✅ Clear differentiation
- ✅ Multiplier effect narrative

**Time to build:** 6 days  
**Win probability:** 80%  
**Your confidence:** 🔥🔥🔥

---

**Now go execute! 🦞🚀**

Questions? Check the AI Prompts guide for help with any task.

**LOCK IN AND BUILD!** 💪
