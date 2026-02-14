# 🚀 ClawKit Deployment Guide

Complete step-by-step guide to deploy ClawKit and submit to the hackathon.

## ⚡ Quick Deploy (30 minutes)

### Step 1: Setup Environment (5 min)

```bash
cd clawkit-bnb
npm install

# Create .env file
cat > .env << 'ENVFILE'
PRIVATE_KEY=your_private_key_here
RPC_URL=https://opbnb-mainnet-rpc.bnbchain.org
BSCSCAN_API_KEY=your_bscscan_api_key_optional
ENVFILE
```

### Step 2: Get Test BNB (2 min)

You need ~0.01 BNB on opBNB mainnet for:
- Contract deployment (~0.003 BNB)
- Testing transactions (~0.005 BNB)
- Buffer (~0.002 BNB)

**Get opBNB:**
1. Bridge from BSC to opBNB: https://opbnb-bridge.bnbchain.org/
2. Or buy directly on exchanges that support opBNB

### Step 3: Deploy Contracts (10 min)

```bash
# Deploy all 3 contracts
npm run deploy

# This will:
# 1. Deploy DynamicBadge.sol
# 2. Deploy BatchExecutor.sol  
# 3. Deploy ApprovalRevoker.sol
# 4. Save addresses to deployment/addresses.json
# 5. Verify contracts on opBNBScan
```

**Expected output:**
```
✅ DynamicBadge deployed at: 0x...
✅ BatchExecutor deployed at: 0x...
✅ ApprovalRevoker deployed at: 0x...
📝 Addresses saved to deployment/addresses.json
```

### Step 4: Update Contract Addresses (2 min)

```bash
# Automatically update src/types.ts with deployed addresses
node scripts/update-addresses.js
```

### Step 5: Generate Test Transactions (10 min)

```bash
# Run test script to generate 15+ transactions
node scripts/generate-test-transactions.js

# This will:
# - Mint 5 NFT badges
# - Execute 3 token swaps (if you have tokens)
# - Test batch operations
# - Test security features
# - Save all transaction hashes
```

### Step 6: Collect Transaction Hashes (1 min)

```bash
# Transaction hashes are saved to:
cat deployment/transactions.json

# Copy all hashes for submission
```

---

## 📝 Detailed Deployment Instructions

### Prerequisites

1. **Node.js 18+** installed
2. **Wallet with BNB** on opBNB mainnet (~0.01 BNB)
3. **Git** for version control

### Environment Setup

#### 1. Install Dependencies

```bash
npm install
```

#### 2. Configure Environment

Create `.env` file:

```env
# REQUIRED: Your wallet private key (NEVER commit this!)
PRIVATE_KEY=0x...

# REQUIRED: opBNB RPC URL
RPC_URL=https://opbnb-mainnet-rpc.bnbchain.org

# OPTIONAL: For contract verification
BSCSCAN_API_KEY=YOUR_API_KEY

# OPTIONAL: Gas price multiplier (default: 1.2)
GAS_MULTIPLIER=1.2
```

**🔒 Security Notes:**
- Never commit `.env` to git
- Keep private key secure
- Use a separate wallet for testing

### Contract Deployment

#### Deploy to opBNB Mainnet

```bash
npx hardhat run scripts/deploy.ts --network opbnb
```

**What happens:**
1. Connects to opBNB mainnet
2. Deploys DynamicBadge contract
3. Deploys BatchExecutor contract
4. Deploys ApprovalRevoker contract
5. Saves addresses to `deployment/addresses.json`
6. Optionally verifies on opBNBScan

**Deployment costs:**
- DynamicBadge: ~0.001 BNB
- BatchExecutor: ~0.001 BNB
- ApprovalRevoker: ~0.001 BNB
- **Total: ~0.003 BNB**

#### Verify Contracts (Recommended)

If auto-verification failed:

```bash
npx hardhat verify --network opbnb DEPLOYED_ADDRESS
```

For each contract address from `deployment/addresses.json`.

### Testing & Transaction Generation

#### Manual Testing

```bash
# Test NFT minting
npm run test:nft

# Test DeFi swap
npm run test:defi

# Test security scan
npm run test:security

# Test batch operations
npm run test:batch
```

#### Automated Test Suite

```bash
# Run complete test suite (generates 15+ transactions)
npm run test:full

# This will:
# 1. Mint various badge tiers
# 2. Test swaps (BNB -> Token, Token -> Token)
# 3. Test staking
# 4. Test batch operations
# 5. Test security scanning
# 6. Save all transaction hashes
```

**Output:**
```
✅ Test 1: Minted Bronze badge - TX: 0x...
✅ Test 2: Minted Silver badge - TX: 0x...
✅ Test 3: Swapped 0.001 BNB for USDT - TX: 0x...
...
📝 Total transactions: 15
💾 Saved to deployment/transactions.json
```

### Collecting Submission Data

#### 1. Contract Addresses

```bash
cat deployment/addresses.json
```

Copy for submission:
```
DynamicBadge: 0x...
BatchExecutor: 0x...
ApprovalRevoker: 0x...
```

#### 2. Transaction Hashes

```bash
cat deployment/transactions.json | grep hash
```

You need **15+ successful transactions** showing:
- NFT minting (3-5 tx)
- Token operations (3-5 tx)
- Batch operations (2-3 tx)
- Security operations (2-3 tx)
- Other features (3-5 tx)

#### 3. Verification Links

All contracts should be verified on opBNBScan:
- `https://opbnbscan.com/address/YOUR_CONTRACT_ADDRESS#code`

---

## 🐛 Troubleshooting

### Issue: "Insufficient funds"

**Solution:**
- Check BNB balance: `npm run check-balance`
- Bridge more BNB from BSC
- Reduce gas price multiplier in `.env`

### Issue: "Nonce too low"

**Solution:**
```bash
# Reset nonce
npm run reset-nonce
```

### Issue: "Contract deployment failed"

**Solution:**
- Check RPC URL is correct
- Try different RPC: `https://opbnb.publicnode.com`
- Increase gas limit in `hardhat.config.js`

### Issue: "Transaction reverted"

**Solution:**
- Check transaction parameters
- Ensure token approvals
- Verify contract addresses in `src/types.ts`

### Issue: "API rate limited"

**Solution:**
- GoPlus API: Wait 60 seconds between calls
- CoinGecko API: Free tier has 50 calls/minute
- PancakeSwap API: No rate limits

---

## ✅ Pre-Submission Checklist

### Contracts
- [ ] All 3 contracts deployed to opBNB mainnet
- [ ] All contracts verified on opBNBScan
- [ ] Contract addresses saved and documented
- [ ] Contracts work correctly (tested)

### Transactions
- [ ] 15+ successful transactions generated
- [ ] Transaction hashes collected
- [ ] Transactions demonstrate all features:
  - [ ] NFT minting (3+ tx)
  - [ ] DeFi operations (3+ tx)
  - [ ] Batch operations (2+ tx)
  - [ ] Security features (2+ tx)
  - [ ] Other features (5+ tx)
- [ ] All transactions visible on opBNBScan

### Code Quality
- [ ] All modules implemented (no TODOs)
- [ ] Real API integrations (no mock data)
- [ ] Error handling complete
- [ ] TypeScript compiles without errors
- [ ] Tests pass

### Documentation
- [ ] README.md complete
- [ ] AI_BUILD_LOG.md detailed
- [ ] Code comments added
- [ ] Examples work
- [ ] Deployment guide tested

### Submission Package
- [ ] GitHub repo public
- [ ] All files pushed
- [ ] .env excluded from git
- [ ] Contract addresses in README
- [ ] Transaction hashes listed
- [ ] Screenshots captured

---

## 🎯 Final Steps Before Submission

### 1. Final Code Check

```bash
# Ensure everything compiles
npm run build

# Run linter
npm run lint

# Format code
npm run format
```

### 2. Update README

Update `README.md` with:
- Your deployed contract addresses
- Your transaction hashes
- Your wallet address (for testing)

### 3. Create Submission Package

```bash
# Generate submission report
npm run generate-submission

# This creates submission_report.md with:
# - All contract addresses
# - All transaction hashes
# - Feature checklist
# - Links to verified contracts
```

### 4. Take Screenshots

Capture:
- opBNBScan showing contracts
- opBNBScan showing transactions
- Terminal showing successful deploys
- Working demo (if applicable)

### 5. Push to GitHub

```bash
git add .
git commit -m "Ready for hackathon submission"
git push origin main
```

### 6. Submit to DoraHacks

1. Go to: https://dorahacks.io/hackathon/goodvibes/detail
2. Click "Submit Project"
3. Fill in all fields:
   - Project name: ClawKit
   - Track: Builders
   - Description: (use from README)
   - GitHub URL: Your repo
   - Contract addresses: From deployment/addresses.json
   - Transaction hashes: From deployment/transactions.json
4. Upload screenshots
5. Submit before deadline: **Feb 19, 2026 3:00 PM UTC**

---

## 📱 Post-Submission

### Share on Social Media

```
🦞 Just submitted ClawKit to #GoodVibesOnly hackathon!

A complete BNB Chain toolkit for OpenClaw AI agents:
✅ 3 lines of code to build powerful agents
✅ DeFi, NFT, Security modules
✅ 100% production-ready

Check it out: [GitHub link]
Vote on DoraHacks: [Submission link]

#BNBChain #OpenClaw #Web3 #AI
```

### Monitor Votes

- Check DoraHacks daily
- Respond to comments
- Thank supporters
- Engage with community

---

## 🎉 You're Ready!

Follow this guide and you'll have ClawKit deployed and submitted in ~30 minutes.

**Need help?**
- Check troubleshooting section
- Review error messages carefully
- Join Discord for support
- DM maintainers

**Good luck! 🍀**
