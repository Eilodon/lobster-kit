/**
 * SubBrainOrchestratorClient
 * 
 * TypeScript client/wrapper để tích hợp clawkit_subbrain_auto vào Cascade/Windsurf.
 * Đây là layer kết nối giữa IDE và MCP Sub-Brain.
 * 
 * Usage trong Cascade Agent:
 * ```typescript
 * const subbrain = new SubBrainOrchestratorClient(mcpServerPath);
 * const result = await subbrain.analyzeInput("audit project code");
 * // result chứa enriched context sẵn sàng cho LLM phân tích
 * ```
 */

import { spawn } from 'child_process';
import * as path from 'path';

export interface SubBrainInput {
  input: string;
  userId?: string;
  autoExecute?: boolean;
  maxTools?: number;
  context?: Record<string, unknown>;
}

export interface SubBrainResult {
  subbrain_analysis: {
    intent_classification: {
      category: string;
      confidence: number;
      entities?: unknown;
      sentiment?: unknown;
    };
    routing_strategy: string;
    tool_recommendations: Array<{
      tool: string;
      relevance_score: number;
    }>;
    executed_tools: string[];
    execution_summary: {
      total: number;
      successful: number;
      errors: number;
    };
    tool_results?: Array<{
      tool: string;
      result: unknown;
      relevance: number;
    }>;
    execution_errors?: Array<{
      tool: string;
      error: unknown;
    }>;
    enriched_context: {
      user_intent: {
        raw_input: string;
        category: string;
        confidence: number;
      };
      analysis_ready: boolean;
      tools_data: {
        executed: string[];
        key_findings: unknown[];
        relevant_memories: unknown[];
        patterns_detected: unknown[];
      };
      llm_guidance: {
        focus_areas: string[];
        use_results: boolean;
        ask_clarification: boolean;
      };
    };
    suggested_approach: string;
  };
  ready_for_llm_analysis: boolean;
  auto_executed: boolean;
}

export class SubBrainOrchestratorClient {
  private mcpBin: string;
  private timeoutMs: number;

  constructor(
    mcpBinPath = 'crates/mcp-server/target/release/mcp-server',
    timeoutMs = 30000
  ) {
    this.mcpBin = path.resolve(process.cwd(), mcpBinPath);
    this.timeoutMs = timeoutMs;
  }

  /**
   * Analyze user input through Sub-Brain orchestration
   * 
   * Flow: Input → Sub-Brain → Auto-execute tools → Enriched context → LLM
   * 
   * @param input - Raw user input text
   * @returns Enriched analysis ready for LLM processing
   */
  async analyzeInput(input: string, options?: {
    userId?: string;
    autoExecute?: boolean;
    maxTools?: number;
  }): Promise<SubBrainResult | { error: string }> {
    const params: SubBrainInput = {
      input,
      userId: options?.userId || 'cascade-user',
      autoExecute: options?.autoExecute ?? true,
      maxTools: options?.maxTools || 3,
      context: {
        source: 'cascade_ide',
        timestamp: new Date().toISOString()
      }
    };

    try {
      const result = await this.callMcpTool('clawkit_subbrain_auto', params);
      return result as SubBrainResult;
    } catch (error) {
      return {
        error: `Sub-Brain analysis failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Quick check - chỉ classify intent không execute tools
   * Dùng cho routing decision nhanh
   */
  async classifyIntent(input: string): Promise<{
    intent: string;
    confidence: number;
    suggestedTools: string[];
  } | { error: string }> {
    const result = await this.analyzeInput(input, { autoExecute: false, maxTools: 0 });
    
    if ('error' in result) {
      return result;
    }

    return {
      intent: result.subbrain_analysis.intent_classification.category,
      confidence: result.subbrain_analysis.intent_classification.confidence,
      suggestedTools: result.subbrain_analysis.tool_recommendations
        .slice(0, 3)
        .map(r => r.tool)
    };
  }

  /**
   * Core MCP tool call implementation
   */
  private async callMcpTool(
    tool: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.mcpBin, [], {
        cwd: process.cwd(),
        env: { ...process.env, MCP_SUBBRAIN_MODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      let errorOutput = '';
      
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Sub-Brain MCP timeout'));
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk) => {
        output += chunk;
      });

      child.stderr?.on('data', (chunk) => {
        errorOutput += chunk;
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          try {
            // Parse JSON-RPC response
            const lines = output.trim().split('\n');
            for (const line of lines.reverse()) {
              if (line.includes('"result"')) {
                const response = JSON.parse(line);
                if (response.result?.content?.[0]?.text) {
                  // MCP tool response format
                  const resultText = response.result.content[0].text;
                  resolve(JSON.parse(resultText));
                  return;
                } else if (response.result) {
                  resolve(response.result);
                  return;
                }
              }
            }
            resolve({ raw_output: output });
          } catch (parseError) {
            reject(new Error(`Failed to parse MCP response: ${parseError}`));
          }
        } else {
          reject(new Error(`MCP exited with code ${code}: ${errorOutput}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      // Send JSON-RPC request
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: tool,
          arguments: params
        }
      });

      child.stdin?.write(request + '\n');
      child.stdin?.end();
    });
  }
}

/**
 * Integration helper cho Cascade Agent
 * 
 * Cách dùng trong Cascade:
 * 
 * ```typescript
 * // Trong agent response handler
 * import { withSubBrainAnalysis } from './SubBrainOrchestratorClient';
 * 
 * const userInput = "audit project for security issues";
 * 
 * // Option 1: Manual integration
 * const subbrain = new SubBrainOrchestratorClient();
 * const analysis = await subbrain.analyzeInput(userInput);
 * 
 * if (!('error' in analysis) && analysis.ready_for_llm_analysis) {
 *   // Dùng enriched_context để generate response
 *   const prompt = `
 * User: ${userInput}
 * 
 * Sub-Brain Analysis:
 * - Intent: ${analysis.subbrain_analysis.intent_classification.category}
 * - Strategy: ${analysis.subbrain_analysis.routing_strategy}
 * - Tools executed: ${analysis.subbrain_analysis.executed_tools.join(', ')}
 * - Key findings: ${JSON.stringify(analysis.subbrain_analysis.enriched_context.tools_data.key_findings)}
 * 
 * ${analysis.subbrain_analysis.suggested_approach}
 * `;
 *   
 *   // Send prompt to LLM...
 * }
 * 
 * // Option 2: Wrapper function
 * const response = await withSubBrainAnalysis(
 *   userInput,
 *   async (analysis) => {
 *     // Generate response dựa trên analysis
 *     return generateLLMResponse(analysis);
 *   }
 * );
 * ```
 */
export async function withSubBrainAnalysis<T>(
  input: string,
  callback: (analysis: SubBrainResult) => Promise<T>,
  options?: {
    mcpBinPath?: string;
    autoExecute?: boolean;
  }
): Promise<T | { error: string; fallback: boolean }> {
  const client = new SubBrainOrchestratorClient(
    options?.mcpBinPath,
    30000
  );

  const analysis = await client.analyzeInput(input, {
    autoExecute: options?.autoExecute ?? true
  });

  if ('error' in analysis) {
    return {
      error: analysis.error,
      fallback: true
    };
  }

  if (!analysis.ready_for_llm_analysis) {
    return {
      error: 'Sub-Brain analysis incomplete',
      fallback: true
    };
  }

  return callback(analysis);
}

/**
 * Sub-Brain Integration Test Suite
 */
export async function runSubBrainTests(): Promise<{
  passed: number;
  failed: number;
  results: Array<{ test: string; success: boolean; error?: string }>
}> {
  const client = new SubBrainOrchestratorClient();
  const results: Array<{ test: string; success: boolean; error?: string }> = [];

  // Test 1: Intent classification
  try {
    const intent = await client.classifyIntent("audit project code for security");
    results.push({
      test: 'Intent Classification',
      success: !('error' in intent) && intent.intent === 'CodeAudit',
      error: 'error' in intent ? intent.error : undefined
    });
  } catch (e) {
    results.push({ test: 'Intent Classification', success: false, error: String(e) });
  }

  // Test 2: Full analysis
  try {
    const analysis = await client.analyzeInput("explain how MemoryRouter works");
    results.push({
      test: 'Full Sub-Brain Analysis',
      success: !('error' in analysis) && analysis.ready_for_llm_analysis,
      error: 'error' in analysis ? analysis.error : undefined
    });
  } catch (e) {
    results.push({ test: 'Full Sub-Brain Analysis', success: false, error: String(e) });
  }

  // Test 3: Debug intent
  try {
    const analysis = await client.analyzeInput("fix bug in WasmAdapter", { autoExecute: true });
    results.push({
      test: 'Debug Intent Handling',
      success: !('error' in analysis),
      error: 'error' in analysis ? analysis.error : undefined
    });
  } catch (e) {
    results.push({ test: 'Debug Intent Handling', success: false, error: String(e) });
  }

  return {
    passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  };
}
