#!/usr/bin/env node
/**
 * Comprehensive Cognitive Tools Test Suite
 * Tests all cognitive tools in the MCP server
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_BIN = path.resolve(__dirname, '../target/release/mcp-server');

const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, success, details = '') {
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${name}${details ? ` | ${details}` : ''}`);
  results.tests.push({ name, success, details });
  if (success) results.passed++; else results.failed++;
}

async function callMcp(tool, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(MCP_BIN, [], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.kill();
      reject(new Error('Timeout'));
    }, 60000);

    child.stdout.on('data', (d) => {
      if (resolved) return;
      stdoutBuf += d;
      const lines = stdoutBuf.split('\n');
      const toolResp = lines.find(l => l.includes('"id":2') && l.trim().startsWith('{'));
      if (toolResp) {
        resolved = true;
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(toolResp);
          const content = parsed.result?.content?.[0]?.text;
          resolve(content ? JSON.parse(content) : parsed.result);
        } catch {
          resolve({ error: 'Parse failed', raw: toolResp.substring(0, 200) });
        }
        child.kill();
      }
    });

    child.stderr.on('data', () => { });

    child.on('close', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({ error: 'No response', raw: stdoutBuf.substring(0, 200) });
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    }) + '\n');

    setTimeout(() => {
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 2,
        method: 'tools/call',
        params: { name: tool, arguments: args }
      }) + '\n');
      // Do not forcefully close stdin here; let the child compute until it replies or hits timeout
    }, 300);
  });
}

async function testSenseIntent() {
  console.log('\n🧠 Test: eidolon_sense_intent');
  const result = await callMcp('eidolon_sense_intent', {
    query: 'audit code for security vulnerabilities',
    user_id: 'test-user'
  });

  if (result.error) {
    logTest('sense_intent', false, result.error);
  } else if (result.ensemble?.critical_action_signal_score !== undefined || result.confidence !== undefined) {
    logTest('sense_intent', true, `Risk: ${result.ensemble?.critical_action_signal_score || 'N/A'}, Conf: ${(result.confidence * 100).toFixed(0)}%`);
  } else {
    logTest('sense_intent', false, 'Missing expected fields');
  }
}

async function testToolRecommend() {
  console.log('\n🧠 Test: eidolon_tool_recommend');
  const result = await callMcp('eidolon_tool_recommend', {
    task: 'audit project code for security issues',
    available_tools: ['eidolon_check_pattern', 'eidolon_reason_chain', 'eidolon_orchestrate']
  });

  if (result.error) {
    logTest('tool_recommend', false, result.error);
  } else if (result.recommended_tools && result.recommended_tools.length > 0) {
    const top = result.recommended_tools[0];
    logTest('tool_recommend', true, `Top: ${top.tool} (${(top.relevance_score * 100).toFixed(0)}%)`);
  } else {
    logTest('tool_recommend', false, 'No recommendations');
  }
}

async function testOrchestrate() {
  console.log('\n🧠 Test: eidolon_orchestrate');
  const result = await callMcp('eidolon_orchestrate', {
    task: 'analyze codebase for performance bottlenecks',
    agent_count: 3,
    confidence: 0.8
  });

  if (result.error) {
    logTest('orchestrate', false, result.error);
  } else if (result.status === 'consensus_reached' || result.agents_spawned) {
    logTest('orchestrate', true, `Agents: ${result.agents_spawned || 'N/A'}, Status: ${result.status || 'OK'}`);
  } else {
    logTest('orchestrate', false, 'Missing consensus data');
  }
}

async function testCheckPattern() {
  console.log('\n🧠 Test: eidolon_check_pattern');
  const result = await callMcp('eidolon_check_pattern', {
    pattern: 'unsafe memory access in rust',
    mode: 'zen'
  });

  if (result.error) {
    logTest('check_pattern', false, result.error);
  } else if (result.inhibited !== undefined) {
    logTest('check_pattern', true, `Inhibited: ${result.inhibited}`);
  } else {
    logTest('check_pattern', false, 'Missing pattern check result');
  }
}

async function testMemoryQuery() {
  console.log('\n🧠 Test: eidolon_memory_query');
  const result = await callMcp('eidolon_memory_query', {
    query: 'previous security audit results',
    route: 'auto',
    k: 5
  });

  if (result.error) {
    logTest('memory_query', false, result.error);
  } else if (result.memories || result.results || result.matches) {
    const count = (result.memories || result.results || result.matches || []).length;
    logTest('memory_query', true, `${count} memories found`);
  } else {
    logTest('memory_query', true, 'Query executed (no memories yet)');
  }
}

async function testRecallSimilar() {
  console.log('\n🧠 Test: eidolon_recall_similar');
  const result = await callMcp('eidolon_recall_similar', {
    context: 'debugging wasm memory issues',
    k: 3
  });

  if (result.error) {
    logTest('recall_similar', false, result.error);
  } else {
    logTest('recall_similar', true, 'Similarity search executed');
  }
}

async function testRouteAction() {
  console.log('\n🧠 Test: eidolon_route_action');
  const result = await callMcp('eidolon_route_action', {
    suggested_tool: 'eidolon_check_pattern',
    intent_confidence: 0.85,
    context_type: 'security_audit'
  });

  if (result.error) {
    logTest('route_action', false, result.error);
  } else if (result.strategy) {
    logTest('route_action', true, `Strategy: ${result.strategy}, Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  } else {
    logTest('route_action', false, 'Missing routing decision');
  }
}

async function testSubBrainFull() {
  console.log('\n🧠 Test: eidolon_subbrain_auto (End-to-End)');
  const result = await callMcp('eidolon_subbrain_auto', {
    input: 'audit project code for security vulnerabilities and fix any issues found',
    user_id: 'test-user',
    auto_execute: true,
    max_tools: 3
  });

  if (result.error) {
    logTest('subbrain_auto', false, result.error);
  } else if (result.subbrain_analysis) {
    const intent = result.subbrain_analysis.intent_classification?.category || 'Unknown';
    const strategy = result.subbrain_analysis.routing_strategy || 'Unknown';
    const executed = result.subbrain_analysis.executed_tools?.length || 0;
    logTest('subbrain_auto', true, `Intent: ${intent}, Strategy: ${strategy}, Executed: ${executed} tools`);
  } else {
    logTest('subbrain_auto', false, 'Missing subbrain_analysis');
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   Cognitive Tools Test Suite - Eidolon MCP         ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`Binary: ${MCP_BIN}`);

  await testSenseIntent();
  await testToolRecommend();
  await testOrchestrate();
  await testCheckPattern();
  await testMemoryQuery();
  await testRecallSimilar();
  await testRouteAction();
  await testSubBrainFull();

  console.log('\n' + '═'.repeat(52));
  console.log(`📊 Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═'.repeat(52) + '\n');

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
