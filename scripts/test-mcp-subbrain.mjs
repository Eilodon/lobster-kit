#!/usr/bin/env node
/**
 * MCP Server Test - Sub-Brain Integration
 * 
 * Tests:
 * 1. MCP server responds to initialize
 * 2. clawkit_subbrain_auto tool is registered
 * 3. Sub-Brain tool executes correctly
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_BIN = path.resolve(__dirname, '../target/release/mcp-server');

const TESTS = {
  passed: 0,
  failed: 0,
  results: []
};

function logTest(name, success, details = '') {
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (details) console.log(`   ${details}`);
  TESTS.results.push({ name, success, details });
  if (success) TESTS.passed++; else TESTS.failed++;
}

async function sendMcpRequest(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(MCP_BIN, [], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Timeout'));
    }, 10000);

    child.stdout.on('data', (chunk) => stdout += chunk);
    child.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      if (!line.includes('ONNX') && !line.includes('Ollama')) {
        stderr += line;
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      
      const responses = [];
      for (const line of stdout.split('\n')) {
        if (line.trim()) {
          try {
            responses.push(JSON.parse(line));
          } catch {
            // Ignore non-JSON lines
          }
        }
      }
      
      resolve({ responses, stderr, code });
    });

    // Send all requests
    for (const req of requests) {
      child.stdin.write(JSON.stringify(req) + '\n');
    }
    child.stdin.end();
  });
}

async function test1_Initialize() {
  console.log('\n📋 Test 1: Initialize');
  try {
    const { responses } = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }
    ]);
    
    const init = responses.find(r => r.id === 1);
    if (init?.result?.serverInfo?.name === 'clawkit-v4') {
      logTest('Initialize', true, `Server: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
    } else {
      logTest('Initialize', false, 'Invalid initialize response');
    }
  } catch (err) {
    logTest('Initialize', false, err.message);
  }
}

async function test2_ToolsList() {
  console.log('\n📋 Test 2: Tools List');
  try {
    const { responses } = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    ]);
    
    const toolsList = responses.find(r => r.id === 2);
    const tools = toolsList?.result?.tools || [];
    const hasSubBrain = tools.some(t => t.name === 'clawkit_subbrain_auto');
    
    if (hasSubBrain) {
      const subBrainTool = tools.find(t => t.name === 'clawkit_subbrain_auto');
      logTest('Sub-Brain Tool Registered', true, `${tools.length} tools total`);
      logTest('Tool Description', true, subBrainTool.description.substring(0, 60) + '...');
    } else {
      logTest('Sub-Brain Tool Registered', false, `Tools found: ${tools.map(t => t.name).join(', ').substring(0, 100)}`);
    }
  } catch (err) {
    logTest('Tools List', false, err.message);
  }
}

async function test3_SubBrainExecution() {
  console.log('\n📋 Test 3: Sub-Brain Auto Execution');
  try {
    const { responses } = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { 
        jsonrpc: '2.0', 
        id: 2, 
        method: 'tools/call',
        params: {
          name: 'clawkit_subbrain_auto',
          arguments: {
            input: 'audit project code for security',
            user_id: 'test-user',
            auto_execute: false
          }
        }
      }
    ]);
    
    const toolCall = responses.find(r => r.id === 2);
    const content = toolCall?.result?.content?.[0]?.text;
    
    if (content) {
      try {
        const result = JSON.parse(content);
        if (result.subbrain_analysis) {
          const intent = result.subbrain_analysis.intent_classification?.category || 'Unknown';
          const strategy = result.subbrain_analysis.routing_strategy || 'Unknown';
          logTest('Sub-Brain Execution', true, `Intent: ${intent}, Strategy: ${strategy}`);
        } else {
          logTest('Sub-Brain Execution', false, 'Missing subbrain_analysis in response');
        }
      } catch {
        logTest('Sub-Brain Execution', false, 'Invalid JSON response');
      }
    } else {
      logTest('Sub-Brain Execution', false, 'No content in response');
    }
  } catch (err) {
    logTest('Sub-Brain Execution', false, err.message);
  }
}

async function main() {
  console.log('🧪 MCP Server Test - Sub-Brain Integration');
  console.log(`Binary: ${MCP_BIN}`);
  
  await test1_Initialize();
  await test2_ToolsList();
  await test3_SubBrainExecution();
  
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${TESTS.passed} passed, ${TESTS.failed} failed`);
  console.log('='.repeat(50) + '\n');
  
  process.exit(TESTS.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
