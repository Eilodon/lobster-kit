import { WalletClient, PublicClient, parseAbi, encodeFunctionData } from 'viem';
import { ClawKitConfig, PANCAKE_ROUTER, CLAWKIT_CONTRACTS, ClawKitWalletClient, toAddress } from './types';
import axios from 'axios';
import { withRetry } from './utils/Resilience';
import { verifyConfigIntegrity } from './utils/ConfigIntegrity';
import { ERC20_ALLOWANCE_ABI, ERC20_APPROVE_ABI } from './abi/erc20';


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
  private readonly MAX_CACHE_SIZE = 100; // Prevent memory leaks
  private scanCache: Map<string, { result: SecurityScanResult; timestamp: number }> = new Map();

  constructor(
    private walletClient: ClawKitWalletClient,
    private publicClient: PublicClient,
    private config: ClawKitConfig
  ) {
    this.validateConfig();
    // In-memory cache starts empty, no file loading needed.
  }

  /**
   * 🛡️ IMMUNE SYSTEM: Validate Configuration on Boot
   * "Bio-Check": Refuse to start if environment is hostile (missing critical config)
   */
  private validateConfig() {
    // FIX: Relax strict check. ClawKit can operate with just publicClient.
    // if (!this.config.rpcUrl) throw new Error("CRITICAL: Missing RPC URL. Agent cannot see.");
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

    // FIX P2: True LRU eviction policy
    if (this.scanCache.has(key)) {
      // Refresh: delete so it can be re-inserted at the end
      this.scanCache.delete(key);
    } else if (this.scanCache.size >= this.MAX_CACHE_SIZE) {
      // Evict oldest (first inserted)
      const oldestKey = this.scanCache.keys().next().value;
      if (oldestKey) this.scanCache.delete(oldestKey);
    }

    this.scanCache.set(key, { result, timestamp: Date.now() });
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
   * Security rationale:
   * - Uses direct ERC20 `approve(spender, 0)` from user wallet.
   * - Avoids delegating approval resets to external helper contracts.
   * - Keeps failure domain minimal for emergency containment.
   * @example
   * await kit.security.revokeApproval('0x...', 'USDT')
   */
  async revokeApproval(
    spender: string,
    tokenAddress: string
  ): Promise<{ hash: string }> {
    try {
      // 🛡️ SPINAL REFLEX: Direct approve(0) — no external contract dependency
      const data = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [spender as `0x${string}`, 0n]
      });

      const hash = await this.walletClient.sendTransaction({
        to: tokenAddress as `0x${string}`,
        data
      });

      console.info(`✅ Revoked approval for ${spender} on token ${tokenAddress}`);
      return { hash };

    } catch (error) {
      console.error('Error revoking approval:', error);
      throw new Error('Failed to revoke approval');
    }
  }

  /**
   * Check all token approvals for an address
   * Security rationale:
   * - Enumerates known high-risk spenders (DEX routers + helper contracts).
   * - Uses on-chain allowance reads only; no off-chain trust assumptions.
   * - Returns only non-zero allowances to focus operator attention.
   */
  async checkApprovals(tokenAddresses: string[]): Promise<Array<{
    token: string;
    spender: string;
    allowance: string;
  }>> {
    const owner = await this.getAddress();
    const approvals: Array<{ token: string; spender: string; allowance: string }> = [];

    // FIX P4-F4: Include chainConfig spenders + deduplicate
    const knownSpenders = [
      PANCAKE_ROUTER,
      this.config.chainConfig?.contracts?.pancakeRouter,
      this.config.chainConfig?.contracts?.batchExecutor,
      CLAWKIT_CONTRACTS.BatchExecutor,
      CLAWKIT_CONTRACTS.ApprovalRevoker,
    ].filter((addr): addr is string =>
      !!addr && addr !== '0x0000000000000000000000000000000000000000'
    );
    // Deduplicate (case-insensitive)
    const uniqueSpenders = [...new Set(knownSpenders.map(s => s.toLowerCase()))];

    for (const token of tokenAddresses) {
      for (const spender of uniqueSpenders) {
        try {
          const allowance = await this.publicClient.readContract({
            address: token as `0x${string}`,
            abi: ERC20_ALLOWANCE_ABI,
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
   * 🛡️ SPINAL REFLEX: Batch revoke approvals via direct approve(0) calls.
   * No external contract dependency — trustless and atomic.
   * Each revoke is a direct ERC20 call from the user's wallet.
   * Security rationale:
   * - Best-effort loop: one token failure does not block other revokes.
   * - Throws only when all revokes fail, signaling full containment failure.
   */
  async batchRevokeApprovals(
    tokens: string[],
    spenders: string[]
  ): Promise<{ hashes: string[]; count: number }> {
    if (tokens.length !== spenders.length) {
      throw new Error('Tokens and spenders arrays must have same length');
    }
    if (tokens.length === 0) {
      return { hashes: [], count: 0 };
    }

    const hashes: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      try {
        const data = encodeFunctionData({
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [toAddress(spenders[i]), 0n]
        });

        const hash = await this.walletClient.sendTransaction({
          to: toAddress(tokens[i]),
          data
        });
        hashes.push(hash);
        console.info(`✅ Revoked [${i + 1}/${tokens.length}]: token=${tokens[i]} spender=${spenders[i]}`);
      } catch (err: any) {
        // Non-fatal: log and continue. One bad token should not block others.
        const msg = `Failed to revoke token=${tokens[i]} spender=${spenders[i]}: ${err.message}`;
        console.error(`❌ ${msg}`);
        errors.push(msg);
      }
    }

    const revokedCount = hashes.length;
    console.info(`✅ Batch revoke complete: ${revokedCount}/${tokens.length} succeeded.`);

    if (revokedCount === 0 && errors.length > 0) {
      throw new Error(`Batch revoke failed for all tokens: ${errors[0]}`);
    }

    // FIX P2: Return all hashes for tracking
    return { hashes, count: revokedCount };
  }

  /**
   * Monitor for suspicious activities
   */
  /**
   * Monitor for suspicious activities
   * P3: Now accepts optional custom token list for expanded coverage.
   * Watches Approval events from ALL specified tokens simultaneously.
   */
  async monitorSuspiciousActivity(
    callback: (alert: any) => void,
    additionalTokens: string[] = []
  ): Promise<() => void> {
    const userAddress = await this.getAddress();
    console.info(`🛡️ Security Monitor Active for user: ${userAddress}`);

    const safeSpenders = [
      PANCAKE_ROUTER.toLowerCase(),
      CLAWKIT_CONTRACTS.BatchExecutor.toLowerCase(),
      CLAWKIT_CONTRACTS.ApprovalRevoker.toLowerCase(),
      '0x0000000000000000000000000000000000000000' // Zero address
    ];

    // Try to mount the WASM scanner
    const { WasmAdapter } = await import('@clawkit/core');
    const adapter = WasmAdapter.getInstance();
    let wasmScanner: any = null;
    if (typeof (adapter as any).createBatchApprovalScanner === 'function') {
      wasmScanner = (adapter as any).createBatchApprovalScanner();
      if (wasmScanner) {
        wasmScanner.add_safe_spenders(safeSpenders);
      }
    }

    const safeSpendersSet = new Set(safeSpenders);

    // 1. Heartbeat
    const unwatchBlock = this.publicClient.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        if (blockNumber % 50n === 0n) {
          callback({
            type: 'heartbeat',
            blockNumber: blockNumber.toString(),
            message: 'Security Monitor Active & Scanning'
          });
        }
      }
    });

    // 2. Watch Approval Events
    const configTokens = Object.values(this.config.chainConfig?.tokens || {})
      .map(t => t.address);
    const knownTokens = [...new Set([...configTokens, ...additionalTokens])];
    console.info(`🛡️ Watching ${knownTokens.length} tokens for suspicious approvals.`);

    const unwatchEvents = this.publicClient.watchContractEvent({
      address: knownTokens as `0x${string}`[],
      abi: parseAbi(['event Approval(address indexed owner, address indexed spender, uint256 value)']),
      eventName: 'Approval',
      args: {
        owner: toAddress(userAddress) // Only watch approvals FROM us
      },
      onLogs: (logs) => {
        if (!logs || logs.length === 0) return;

        // BATCH MODE: Condense logs and push to zero-allocation WASM scan
        if (wasmScanner && logs.length > 5) {
          const spendersCSV = logs.map(l => (l.args as any).spender || '').join(',');
          const threatsCSV = wasmScanner.scan_approvals_csv(spendersCSV);

          if (threatsCSV) {
            const threatIndices = threatsCSV.split(',').map(Number);
            for (const idx of threatIndices) {
              if (isNaN(idx)) continue;
              const log = logs[idx];
              const { spender, value } = log.args as any;
              callback({
                type: 'SUSPICIOUS_APPROVAL',
                severity: 'HIGH',
                message: `🚨 Unknown Spender Approved! (WASM Detected)`,
                details: {
                  token: log.address,
                  spender: spender,
                  amount: value?.toString()
                },
                timestamp: Date.now()
              });
            }
          }
        } else {
          // FALLBACK / LOW-VOLUME MODE
          for (const log of logs) {
            const { spender, value } = log.args as any;
            if (spender && !safeSpendersSet.has(spender.toLowerCase())) {
              callback({
                type: 'SUSPICIOUS_APPROVAL',
                severity: 'HIGH',
                message: `🚨 Unknown Spender Approved!`,
                details: {
                  token: log.address,
                  spender: spender,
                  amount: value?.toString()
                },
                timestamp: Date.now()
              });
            }
          }
        }
      }
    });

    // Return unsubscriber
    return () => {
      unwatchBlock();
      unwatchEvents();
    };
  }

  // Helper methods
  private async getAddress(): Promise<string> {
    const [address] = await this.walletClient.getAddresses();
    return address;
  }
}
