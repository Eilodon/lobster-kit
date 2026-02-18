import { WalletClient, PublicClient, parseAbi, encodeFunctionData } from 'viem';
import { ClawKitConfig, APPROVAL_REVOKER, PANCAKE_ROUTER, CLAWKIT_CONTRACTS, ClawKitWalletClient, toAddress } from './types';
import axios from 'axios';
import { withRetry } from './utils/Resilience';
import { verifyConfigIntegrity } from './utils/ConfigIntegrity';
import * as fs from 'fs';
import * as path from 'path';

interface SecurityScanResult {
  address: string;
  isHoneypot: boolean;
  riskScore: number;
  risks: string[];
  recommendations: string[];
  degradedMode?: boolean;
  maxAllowedTradeUSD?: number;
}

export class SecurityModule {
  // GoPlus Security API (FREE tier available)
  private readonly GOPLUS_API = 'https://api.gopluslabs.io/api/v1';
  // Alternative: RugDoc API
  private readonly RUGDOC_API = 'https://api.rugdoc.io/v1';
  private readonly SCAN_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private static readonly SCAN_CACHE_FILE = path.resolve(process.cwd(), '.eidolon', 'security_scan_cache.json');
  private scanCache: Map<string, { result: SecurityScanResult; timestamp: number }> = new Map();

  constructor(
    private walletClient: ClawKitWalletClient,
    private publicClient: PublicClient,
    private config: ClawKitConfig
  ) {
    this.validateConfig();
    this.loadScanCache();
  }

  /**
   * 🛡️ IMMUNE SYSTEM: Validate Configuration on Boot
   * "Bio-Check": Refuse to start if environment is hostile (missing critical config)
   */
  private validateConfig() {
    if (!this.config.rpcUrl) throw new Error("CRITICAL: Missing RPC URL. Agent cannot see.");
    if (!this.config.chainConfig) throw new Error("CRITICAL: Missing Chain Config. Agent is lost.");
    verifyConfigIntegrity(this.config, 'SecurityModule');
  }

  /**
   * Scan a contract for security risks using REAL APIs
   * @example
   * const result = await kit.security.scanContract('0x...')
   */
  async scanContract(address: string): Promise<SecurityScanResult> {
    const cached = this.getCachedScan(address);
    if (cached) return cached;

    const risks: string[] = [];
    let riskScore = 0;
    let degradedMode = false;
    let maxAllowedTradeUSD: number | undefined;

    try {
      // 1. Check if it's a honeypot
      // 1. Check if it's a honeypot
      let isHoneypot = false;
      try {
        isHoneypot = await this.checkHoneypotGoPlus(address);
        if (isHoneypot) {
          risks.push('🚨 HONEYPOT DETECTED - Cannot sell tokens');
          riskScore += 100;
        }
      } catch (e: any) {
        if (e.message === 'SECURITY_SCAN_FAILED') {
          degradedMode = true;
          maxAllowedTradeUSD = 100;
          risks.push('⚠️ Security API unavailable - Degraded mode enabled (probe-only).');
          riskScore += 40;
        } else {
          throw e;
        }
      }

      // 2. Check contract verification
      const isVerified = await this.checkContractVerification(address);
      if (!isVerified) {
        risks.push('⚠️ Contract source code not verified');
        riskScore += 30;
      }

      // 3. Check ownership
      const hasOwner = await this.checkOwnership(address);
      if (hasOwner) {
        risks.push('⚠️ Contract has owner with special privileges');
        riskScore += 20;
      }

      // 4. Check trading restrictions
      const tradingRestrictions = await this.checkTradingRestrictions(address);
      if (tradingRestrictions.length > 0) {
        risks.push(...tradingRestrictions);
        riskScore += tradingRestrictions.length * 15;
      }

      // 4.5 Bytecode sanity fallback (independent of external APIs)
      const hasHealthyBytecode = await this.checkBytecodeSanity(address);
      if (!hasHealthyBytecode) {
        risks.push('⚠️ Bytecode anomaly detected (empty or suspiciously small contract code)');
        riskScore += 35;
      }

      // 5. Get additional security data from GoPlus
      const goplusData = await this.getGoPlusSecurityData(address);
      if (goplusData) {
        if (goplusData.is_high_tax) {
          risks.push('⚠️ High tax detected (buy/sell fees > 10%)');
          riskScore += 25;
        }
        if (goplusData.is_blacklisted) {
          risks.push('🚨 Contract is blacklisted');
          riskScore += 50;
        }
        if (!goplusData.is_open_source) {
          risks.push('⚠️ Contract is not open source');
          riskScore += 30;
        }
        if (goplusData.liquidity_locked === false) {
          risks.push('⚠️ Liquidity appears unlocked');
          riskScore += 20;
        }
      } else if (degradedMode) {
        riskScore += 10;
      }

      // Generate recommendations
      const recommendations = this.generateRecommendations(riskScore, risks);
      if (degradedMode) {
        recommendations.unshift('⚠️ Degraded Security Mode: only allow small liquidity probe before any larger position.');
      }

      const result: SecurityScanResult = {
        address,
        isHoneypot,
        riskScore: Math.min(100, riskScore),
        risks,
        recommendations,
        degradedMode,
        maxAllowedTradeUSD
      };
      this.setCachedScan(address, result);
      return result;

    } catch (error) {
      console.error('Error scanning contract:', error);

      // Failsafe degradation: do not assume honeypot blindly, force small probes.
      const result: SecurityScanResult = {
        address,
        isHoneypot: false,
        riskScore: 85,
        risks: ['🚨 CRITICAL SYSTEM FAILURE: Security scan could not complete. Degraded mode active.'],
        recommendations: [
          'Execute probe-only mode ($100 max) until security sensors recover.',
          'Require shadow simulation success before any action.'
        ],
        degradedMode: true,
        maxAllowedTradeUSD: 100
      };
      this.setCachedScan(address, result);
      return result;
    }
  }

  private getCachedScan(address: string): SecurityScanResult | null {
    const key = address.toLowerCase();
    const cached = this.scanCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.SCAN_CACHE_TTL_MS) {
      this.scanCache.delete(key);
      return null;
    }
    return cached.result;
  }

  private setCachedScan(address: string, result: SecurityScanResult) {
    const key = address.toLowerCase();
    this.scanCache.set(key, { result, timestamp: Date.now() });
    this.persistScanCache();
  }

  private loadScanCache() {
    try {
      if (!fs.existsSync(SecurityModule.SCAN_CACHE_FILE)) return;
      const raw = fs.readFileSync(SecurityModule.SCAN_CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, { result: SecurityScanResult; timestamp: number }>;
      for (const [address, entry] of Object.entries(parsed || {})) {
        if (entry?.result && Number.isFinite(entry?.timestamp)) {
          this.scanCache.set(address, entry);
        }
      }
    } catch (e) {
      console.warn('Failed to load security cache, starting fresh.', e);
    }
  }

  private persistScanCache() {
    try {
      const dir = path.dirname(SecurityModule.SCAN_CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = Object.fromEntries(this.scanCache.entries());
      fs.writeFileSync(SecurityModule.SCAN_CACHE_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
      console.warn('Failed to persist security cache:', e);
    }
  }

  /**
   * Check if token is a honeypot using GoPlus Security API (REAL)
   * FAIL SAFE MODE: Returns TRUE (Unsafe) if API fails
   */
  private async checkHoneypotGoPlus(address: string): Promise<boolean> {
    try {
      const chainId = this.config.chainId || 204; // FIX C4: opBNB = 204, not BSC 56
      const response = await withRetry(() => axios.get(
        `${this.GOPLUS_API}/token_security/${chainId}`,
        {
          params: { contract_addresses: address },
          timeout: 5000
        }
      ), { maxAttempts: 2, baseDelay: 500 });

      if (response.data?.result?.[address.toLowerCase()]) {
        const data = response.data.result[address.toLowerCase()];

        if (data.is_honeypot === '1' ||
          data.honeypot_with_same_creator === '1' ||
          data.buy_tax > 50 ||
          data.sell_tax > 50) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('GoPlus API error:', error);
      throw new Error('SECURITY_SCAN_FAILED');
    }
  }

  /**
   * Get comprehensive security data from GoPlus
   */
  private async getGoPlusSecurityData(address: string): Promise<any> {
    try {
      const chainId = this.config.chainId || 204;
      const response = await withRetry(() => axios.get(
        `${this.GOPLUS_API}/token_security/${chainId}`,
        {
          params: { contract_addresses: address },
          timeout: 10000
        }
      ));

      const data = response.data?.result?.[address.toLowerCase()];
      if (!data) return null;

      return {
        is_honeypot: data.is_honeypot === '1',
        is_high_tax: (parseFloat(data.buy_tax) > 10 || parseFloat(data.sell_tax) > 10),
        is_blacklisted: data.is_blacklisted === '1',
        is_open_source: data.is_open_source === '1',
        liquidity_locked: data.is_locked === '1' || data.is_locked === 1 || data.is_locked === true,
        buy_tax: parseFloat(data.buy_tax || 0),
        sell_tax: parseFloat(data.sell_tax || 0),
        holder_count: parseInt(data.holder_count || 0),
        creator_balance: data.creator_balance,
        owner_address: data.owner_address,
        can_take_back_ownership: data.can_take_back_ownership === '1'
      };
    } catch (error) {
      console.error('Unable to fetch GoPlus data:', error);
      return null;
    }
  }

  /**
   * Check if contract is verified on BSCScan
   */
  private async checkContractVerification(address: string): Promise<boolean> {
    try {
      // FIX C4: Dynamic explorer API based on chainId
      const EXPLORER_APIS: Record<number, string> = {
        56: 'https://api.bscscan.com/api',
        204: 'https://api-opbnb.bscscan.com/api',
        97: 'https://api-testnet.bscscan.com/api',
        5611: 'https://api-testnet.opbnb.bscscan.com/api'
      };

      const explorerApi = EXPLORER_APIS[this.config.chainId || 204] || 'https://api-opbnb.bscscan.com/api';

      const response = await withRetry(() => axios.get(explorerApi, {
        params: {
          module: 'contract',
          action: 'getsourcecode',
          address: address
        },
        timeout: 5000
      }));

      if (response.data.status === '1' && response.data.result?.[0]) {
        const sourceCode = response.data.result[0].SourceCode;
        return sourceCode && sourceCode.length > 0;
      }

      return false;
    } catch (error) {
      console.error('Unable to check contract verification');
      return false;
    }
  }

  /**
   * Check if contract has an owner
   */
  private async checkOwnership(address: string): Promise<boolean> {
    try {
      // Try common ownership functions
      const ownerFunctions = [
        'owner()',
        'getOwner()',
        '_owner()'
      ];

      const ownerAbi = parseAbi([
        'function owner() view returns (address)',
        'function getOwner() view returns (address)',
        'function _owner() view returns (address)'
      ]);

      for (const func of ownerFunctions) {
        try {
          const result = await this.publicClient.readContract({
            address: toAddress(address),
            abi: ownerAbi,
            functionName: func.replace('()', '') as 'owner' | 'getOwner' | '_owner'
          });

          if (result && result !== '0x0000000000000000000000000000000000000000') {
            return true;
          }
        } catch {
          continue;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check for trading restrictions
   */
  private async checkTradingRestrictions(address: string): Promise<string[]> {
    const restrictions: string[] = [];

    try {
      // Check if trading is enabled
      try {
        const tradingEnabled = await this.publicClient.readContract({
          address: address as `0x${string}`,
          abi: parseAbi(['function tradingEnabled() view returns (bool)']),
          functionName: 'tradingEnabled'
        });

        if (!tradingEnabled) {
          restrictions.push('⚠️ Trading is currently disabled');
        }
      } catch {
        // Function doesn't exist, skip
      }

      // Check for pausable functionality
      try {
        const paused = await this.publicClient.readContract({
          address: address as `0x${string}`,
          abi: parseAbi(['function paused() view returns (bool)']),
          functionName: 'paused'
        });

        if (paused) {
          restrictions.push('⚠️ Contract is paused');
        }
      } catch {
        // Function doesn't exist, skip
      }

    } catch (error) {
      console.error('Unable to check trading restrictions');
    }

    return restrictions;
  }

  private async checkBytecodeSanity(address: string): Promise<boolean> {
    try {
      const getBytecode = (this.publicClient as any).getBytecode;
      if (typeof getBytecode !== 'function') return true;
      const code = await getBytecode({ address: toAddress(address) });
      if (!code || code === '0x') return false;
      return code.length > 200;
    } catch {
      // If bytecode probing itself fails, don't hard-fail scan.
      return true;
    }
  }

  /**
   * Generate recommendations based on scan results
   */
  private generateRecommendations(riskScore: number, risks: string[]): string[] {
    const recommendations: string[] = [];

    if (riskScore >= 80) {
      recommendations.push('🚨 DO NOT INTERACT - Extremely high risk');
      recommendations.push('Consider this a scam until proven otherwise');
    } else if (riskScore >= 50) {
      recommendations.push('⚠️ HIGH RISK - Proceed with extreme caution');
      recommendations.push('Only invest what you can afford to lose');
      recommendations.push('Do additional research before investing');
    } else if (riskScore >= 30) {
      recommendations.push('⚠️ MEDIUM RISK - Be careful');
      recommendations.push('Verify contract source code before investing');
      recommendations.push('Start with a small test transaction');
    } else if (riskScore > 0) {
      recommendations.push('✅ LOW RISK - Appears relatively safe');
      recommendations.push('Still perform your own due diligence');
    } else {
      recommendations.push('✅ SAFE - No major risks detected');
      recommendations.push('Contract appears legitimate');
    }

    return recommendations;
  }

  /**
   * Revoke approval for a contract
   * @example
   * await kit.security.revokeApproval('0x...', 'USDT')
   */
  async revokeApproval(
    spender: string,
    tokenAddress: string
  ): Promise<{ hash: string }> {
    const owner = await this.getAddress();

    try {
      // Call approve with amount = 0
      const data = encodeFunctionData({
        abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
        functionName: 'approve',
        args: [spender as `0x${string}`, 0n]
      });

      const hash = await this.walletClient.sendTransaction({
        to: tokenAddress as `0x${string}`,
        data
      });

      console.error(`✅ Revoked approval for ${spender}`);
      return { hash };

    } catch (error) {
      console.error('Error revoking approval:', error);
      throw new Error('Failed to revoke approval');
    }
  }

  /**
   * Check all token approvals for an address
   */
  async checkApprovals(tokenAddresses: string[]): Promise<Array<{
    token: string;
    spender: string;
    allowance: string;
  }>> {
    const owner = await this.getAddress();
    const approvals: Array<{ token: string; spender: string; allowance: string }> = [];

    // FIX H9: Actually check on-chain allowances for known spenders
    const knownSpenders = [
      PANCAKE_ROUTER,
      CLAWKIT_CONTRACTS.BatchExecutor,
      CLAWKIT_CONTRACTS.ApprovalRevoker,
    ].filter(addr => addr !== '0x0000000000000000000000000000000000000000');

    for (const token of tokenAddresses) {
      for (const spender of knownSpenders) {
        try {
          const allowance = await this.publicClient.readContract({
            address: token as `0x${string}`,
            abi: parseAbi(['function allowance(address,address) view returns (uint256)']),
            functionName: 'allowance',
            args: [owner as `0x${string}`, spender as `0x${string}`],
          });

          if (allowance > 0n) {
            approvals.push({
              token,
              spender,
              allowance: allowance.toString(),
            });
          }
        } catch {
          // Token may not support allowance — skip
        }
      }
    }

    return approvals;
  }

  /**
   * Batch revoke multiple approvals using ApprovalRevoker contract
   */
  async batchRevokeApprovals(
    tokens: string[],
    spenders: string[]
  ): Promise<{ hash: string; count: number }> {
    if (tokens.length !== spenders.length) {
      throw new Error('Tokens and spenders arrays must have same length');
    }

    try {
      // ApprovalRevoker is a registry — cannot directly revoke on user's behalf.
      // Step 1: Flag approvals for revocation via the agent
      const flagData = encodeFunctionData({
        abi: parseAbi(['function flagApprovalsBatch(address user, address[] tokens, address[] spenders)']),
        functionName: 'flagApprovalsBatch',
        args: [
          toAddress(await this.getAddress()),
          tokens as `0x${string}`[],
          spenders as `0x${string}`[]
        ]
      });

      await this.walletClient.sendTransaction({
        to: toAddress(APPROVAL_REVOKER),
        data: flagData
      });

      // Step 2: Get revocation calldata and execute each from user's context
      const [revokeTokens, revokeCalldatas] = await this.publicClient.readContract({
        address: toAddress(APPROVAL_REVOKER),
        abi: parseAbi(['function getRevocationCalldata(address user) view returns (address[] tokens, bytes[] calldatas)']),
        functionName: 'getRevocationCalldata',
        args: [toAddress(await this.getAddress())]
      }) as [readonly `0x${string}`[], readonly `0x${string}`[]];

      const hashes: string[] = [];
      for (let i = 0; i < revokeTokens.length; i++) {
        const hash = await this.walletClient.sendTransaction({
          to: revokeTokens[i],
          data: revokeCalldatas[i]
        });
        hashes.push(hash);
      }

      // Step 3: Clear flagged approvals
      const clearData = encodeFunctionData({
        abi: parseAbi(['function clearFlaggedApprovals(uint256 limit)']),
        functionName: 'clearFlaggedApprovals',
        args: [0n] // 0 = clear all
      });

      await this.walletClient.sendTransaction({
        to: toAddress(APPROVAL_REVOKER),
        data: clearData
      });

      console.error(`✅ Batch revoked ${tokens.length} approvals`);
      return { hash: hashes[0] || '', count: tokens.length };

    } catch (error) {
      console.error('Error batch revoking approvals:', error);
      throw new Error('Failed to batch revoke approvals');
    }
  }

  /**
   * Monitor for suspicious activities
   */
  async monitorSuspiciousActivity(callback: (alert: any) => void): Promise<() => void> {
    const address = await this.getAddress();

    // Setup real-time monitoring using viem
    const unwatch = this.publicClient.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        // Check for suspicious high-value patterns
        // FIX Bug #23: Active Monitoring
        if (blockNumber % 10n === 0n) {
          // Periodic deep scan or just heartbeat
          callback({
            type: 'heartbeat',
            blockNumber: blockNumber.toString(),
            message: 'Security Monitor Active'
          });
        }
      }
    });

    return unwatch;
  }

  // Helper methods
  private async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }
}
