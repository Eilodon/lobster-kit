# 🤖 AI Prompts for ClawKit Development

This document contains pre-written prompts to help you quickly build remaining features using Claude Code, Cursor, or GPT-4.

---

## 📦 For Completing Missing Features

### 1. Venus Protocol Integration (DeFi Module)

```
Prompt for Claude Code:

"Add Venus Protocol integration to the DeFi module in src/defi.ts:

Requirements:
- lend() function to supply assets to Venus
- borrow() function to borrow against collateral
- repay() function to repay borrowed assets
- getHealthFactor() to check collateral health
- Use Venus Comptroller at: 0xD6e3E2A1d8d95caE8D0D6D3bCD34E3Cbf2dB8bf2 (opBNB)

Include:
- Error handling for insufficient collateral
- Health factor warnings (< 1.5 is risky)
- Gas estimation for each operation
- Support for USDT, USDC, BNB

Use viem for all interactions. Follow the existing code style in defi.ts."
```

### 2. Real APY Fetching (Analytics Module)

```
Prompt for Cursor:

"Update the Analytics module (src/analytics.ts) to fetch real APY data:

1. Add function fetchPancakeSwapAPY(poolId: string): Promise<number>
   - Call PancakeSwap API: https://farms-api.pancakeswap.com/opbnb
   - Parse JSON response and extract APY

2. Add function fetchVenusAPY(asset: string): Promise<number>
   - Call Venus API: https://api.venus.io/api/v1/governance/venus
   - Calculate supply APY and distribution APY

3. Update portfolioHealth() to use real APYs
4. Add caching (5 minute TTL) to avoid rate limits
5. Handle API errors gracefully

Use axios for HTTP requests. Add types for API responses."
```

### 3. Additional Template Agents

```
Prompt for GPT-4:

"Create 4 more OpenClaw template agents using ClawKit:

1. YieldHunter Agent (examples/yield-hunter/agent.ts):
   - Checks portfolio positions every 24h
   - Harvests rewards from Venus & PancakeSwap
   - Auto-compounds into highest APY pools
   - Sends summary to user via Telegram

2. SafeGuard Agent (examples/safe-guard/agent.ts):
   - Monitors wallet approvals in real-time
   - Scans contracts for risks using kit.security.scan()
   - Auto-revokes dangerous approvals (score > 70)
   - Alerts user with risk report

3. CommunityTipBot Agent (examples/tip-bot/agent.ts):
   - Listens for donation events onchain
   - Tips 0.001 BNB to donors from community fund
   - Mints 'Community Champion' badge
   - Posts thank you message

4. GameClaw Agent (examples/game-claw/agent.ts):
   - Defines onchain achievements (e.g., '10 transactions', 'First stake')
   - Tracks user progress
   - Mints achievement badges when goals reached
   - Gamification leaderboard

Each agent should:
- Follow the VibeBadge minter structure
- Use ClawKit modules appropriately
- Include error handling
- Have a test function
- Be fully documented with JSDoc comments"
```

---

## 🧪 For Testing

### 4. Unit Tests

```
Prompt for Cursor:

"Generate comprehensive unit tests for ClawKit modules:

Create test files:
1. test/defi.test.ts - Test swap, stake, harvest
2. test/nft.test.ts - Test badge minting, metadata generation
3. test/security.test.ts - Test risk scoring, approval revocation
4. test/wallet.test.ts - Test transfers, balance queries
5. test/gas.test.ts - Test batching, gas estimation

Use Vitest as testing framework. Mock blockchain calls with viem test utils.

For each module:
- Test happy paths
- Test error cases (insufficient balance, invalid addresses)
- Test edge cases (zero amounts, max values)
- Mock external API calls
- Achieve > 80% code coverage

Include setup and teardown for wallet initialization."
```

### 5. Integration Tests

```
Prompt for Claude:

"Create integration tests that deploy contracts to local Hardhat network:

File: test/integration.test.ts

Test scenarios:
1. Deploy all 3 contracts (DynamicBadge, BatchExecutor, ApprovalRevoker)
2. Initialize ClawKit with deployed addresses
3. Test full flow:
   - User approves BatchExecutor
   - Mint badge via ClawKit
   - Batch multiple operations
   - Verify onchain state

4. Test security flow:
   - Authorize ApprovalRevoker agent
   - Grant revoke permissions
   - Agent revokes approval
   - Verify approval is zero

Use Hardhat's local network. Clean state between tests. Include gas usage reports."
```

---

## 📚 For Documentation

### 6. API Reference

```
Prompt for GPT-4:

"Generate complete API reference documentation:

Create docs/API.md with:

## ClawKit Main Class
- Constructor parameters
- Properties
- Methods

## DeFi Module
For each function (swap, stake, harvest, etc.):
- Function signature
- Parameters (name, type, description, required/optional)
- Return values
- Example usage
- Error cases
- Gas estimates

## NFT Module
[Same structure as DeFi]

## Security Module
[Same structure]

## Wallet, Gas, Analytics Modules
[Same structure]

Include:
- Type definitions
- Common patterns
- Best practices
- Troubleshooting section

Format in markdown with code syntax highlighting."
```

### 7. Tutorial

```
Prompt for Claude Code:

"Write a comprehensive tutorial: docs/TUTORIAL.md

Title: 'Building Your First BNB Chain AI Agent with ClawKit'

Sections:
1. Prerequisites (Node.js, wallet with BNB, basic TypeScript)
2. Installation & Setup
3. Your First Agent (step-by-step code walkthrough)
   - Initialize ClawKit
   - Create OpenClaw skill
   - Add sentiment analysis
   - Mint NFT on positive vibes
4. Testing Your Agent
5. Deploying to Production
6. Advanced Topics:
   - Multi-agent coordination
   - Gas optimization
   - Security best practices
7. Common Issues & Solutions
8. Next Steps

Include:
- Complete code examples that can be copy-pasted
- Console output screenshots (describe what they show)
- Troubleshooting tips
- Links to further resources

Target audience: Developers new to AI agents but familiar with Web3."
```

---

## 🚀 For Deployment

### 8. CI/CD Setup

```
Prompt for Cursor:

"Create GitHub Actions CI/CD pipeline:

File: .github/workflows/ci.yml

Pipeline stages:
1. Install dependencies (npm ci)
2. Lint code (eslint)
3. Run unit tests (vitest)
4. Build TypeScript (tsc)
5. Deploy contracts to testnet (on push to main)
6. Publish npm package (on version tag)

Include:
- Caching for node_modules
- Parallel jobs where possible
- Slack/Discord notifications on failure
- Deployment approvals for mainnet
- Automatic versioning from package.json

Also create:
- .github/workflows/test.yml (runs on PRs)
- .github/workflows/deploy.yml (manual trigger for mainnet)

Use secrets for PRIVATE_KEY, NPM_TOKEN, etc."
```

---

## 🎨 For UI/UX

### 9. Playground Web App

```
Prompt for Claude:

"Create an interactive web playground for ClawKit:

Tech stack: Next.js 14, Tailwind CSS, RainbowKit

Pages:
1. Home (examples/playground/pages/index.tsx):
   - Feature overview
   - Live demo selector
   - Connect wallet button

2. Swap Demo (pages/swap.tsx):
   - Token selector dropdowns
   - Amount input
   - Real-time quote display
   - Execute swap button
   - Transaction status

3. NFT Minter (pages/mint.tsx):
   - Badge preview
   - Tier selector
   - Custom metadata inputs
   - Mint button
   - Gallery of minted badges

4. Security Scanner (pages/scan.tsx):
   - Contract address input
   - Scan button
   - Risk score visualization (gauge chart)
   - Threat list
   - Revoke approvals section

Features:
- Wallet connection with RainbowKit
- Real-time transaction tracking
- Error handling with toast notifications
- Mobile responsive
- Dark mode

Each demo should use ClawKit under the hood and show live results on opBNB testnet."
```

---

## 📊 For Analytics & Monitoring

### 10. Dashboard

```
Prompt for GPT-4:

"Design a monitoring dashboard for ClawKit usage:

Create: examples/dashboard/app.tsx

Dashboard sections:
1. Overview Cards:
   - Total transactions
   - Active agents
   - Gas saved via batching
   - Badges minted

2. Transaction Timeline:
   - Chart showing tx volume over time
   - Group by module (DeFi, NFT, Security)

3. Top Agents:
   - Leaderboard of most active agents
   - Actions performed
   - Gas efficiency

4. Recent Activity Feed:
   - Live stream of ClawKit operations
   - Filter by module/agent

5. Performance Metrics:
   - Average gas per operation
   - Success rate
   - Error types breakdown

Use:
- React + Recharts for visualizations
- TanStack Query for data fetching
- Tailwind for styling
- Real-time updates via WebSocket or polling

Data source: Query opBNB using ClawKit contracts as filters."
```

---

## 🎬 For Demo Video

### 11. Video Script Refinement

```
Prompt for Claude:

"Refine the demo video script (docs/VIDEO_SCRIPT.md):

Requirements:
- 60 seconds total
- Highly engaging opening (hook in 3 seconds)
- Clear before/after comparison
- Live code demo (15-20 seconds)
- Show real transactions on opBNB explorer
- Strong call-to-action

Sections:
0-5s: Hook ("Building DeFi agents is broken...")
5-15s: Problem (show traditional dev struggle)
15-30s: Solution (ClawKit 3-line API demo)
30-50s: Proof (show 5 agents + real tx hashes)
50-60s: CTA ("Vote for ClawKit on DoraHacks")

Include:
- Specific visuals to show
- Suggested transitions
- Text overlays
- Background music recommendations
- Voiceover script

Make it exciting and fast-paced for Twitter attention spans."
```

---

## 🏆 For Submission

### 12. DoraHacks Submission Copy

```
Prompt for GPT-4:

"Write compelling DoraHacks submission copy:

File: docs/SUBMISSION.md

Sections:
1. Title & Tagline (catchy, under 10 words)
2. Elevator Pitch (2-3 sentences, what it does)
3. Problem Statement (pain point we solve)
4. Solution Overview (how ClawKit works)
5. Key Features (bullet list, 5-7 items)
6. Technical Highlights:
   - OpenClaw integration approach
   - Smart contracts deployed
   - Modules implemented
   - Gas optimizations

7. Multiplier Effect:
   - How ClawKit enables other agents
   - Ecosystem impact

8. Why We'll Win:
   - Builders track advantage (less competition)
   - Technical excellence
   - Clear differentiation
   - Production-ready

9. Demo & Resources:
   - Links to live playground
   - GitHub repo
   - Documentation site
   - Video demo

10. Team & AI Build Log:
    - How AI was used (link to AI_BUILD_LOG.md)
    - Development timeline

Keep total under 500 words but make every word count.
Use strong action verbs. Include emojis strategically."
```

---

## 💡 Pro Tips for Using These Prompts

### Best Practices:

1. **Start with Context:**
   ```
   "I'm building ClawKit, a BNB Chain toolkit for OpenClaw agents.
   Here's the current file structure: [paste tree]
   Here's the existing code: [paste relevant file]
   Now, [your specific request]"
   ```

2. **Iterate on Output:**
   - First pass: Get working code
   - Second pass: "Optimize for gas"
   - Third pass: "Add error handling"
   - Fourth pass: "Improve documentation"

3. **Request Explanations:**
   ```
   "Explain why you chose this approach over alternatives"
   "What are the tradeoffs of this implementation?"
   ```

4. **Ask for Tests:**
   ```
   "Now generate tests for this code covering edge cases"
   ```

5. **Request Improvements:**
   ```
   "Review this code for:
   - Security vulnerabilities
   - Gas optimizations
   - TypeScript best practices
   - Code readability"
   ```

### Tools for Each Task:

- **Architecture & Design:** Claude Code (best reasoning)
- **Implementation:** Cursor (best IDE integration)
- **Documentation:** GPT-4 (best writing)
- **Debugging:** Claude Code (best error analysis)
- **Refactoring:** Cursor (best code navigation)

---

## 📝 Tracking AI Usage

For the AI Build Log, after each AI-assisted task, document:

```markdown
### [Date] - [Task Name]

**Prompt:**
```
[Copy exact prompt used]
```

**AI Tool:** [Claude/Cursor/GPT-4]

**Result:** [What was generated]

**Human Modifications:** [What you changed and why]

**Time Saved:** [Estimate: X hours]
```

This helps demonstrate AI usage for hackathon requirements!

---

## 🎯 Next Steps

Use these prompts in order:

1. ✅ Complete missing features (Venus, real APY)
2. ✅ Write comprehensive tests
3. ✅ Deploy to opBNB testnet
4. ✅ Build playground for demos
5. ✅ Create documentation site
6. ✅ Record demo video
7. ✅ Write submission copy
8. ✅ Submit to DoraHacks

**Remember:** AI is your co-pilot, not autopilot. Always review and test the generated code!

---

Good luck with ClawKit! 🦞🚀
