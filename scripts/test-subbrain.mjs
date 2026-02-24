#!/usr/bin/env node
/**
 * Test script for Sub-Brain MCP integration
 * 
 * Usage: node test-subbrain.mjs
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_BIN = path.resolve(__dirname, '../target/release/mcp-server');

console.log('🧪 Testing Sub-Brain MCP Integration\n');
console.log(`MCP Binary: ${MCP_BIN}`);

function callMcpTool(tool, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(MCP_BIN, [], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('MCP timeout'));
    }, 10000);

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
      // Filter out ONNX warning
      if (!chunk.toString().includes('ONNX') && !chunk.toString().includes('Ollama')) {
        errorOutput += chunk.toString();
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`MCP exited with code ${code}: ${errorOutput}`));
        return;
      }

      // Parse JSON-RPC responses
      const lines = output.trim().split('\n').filter(line => line.trim());
      const responses = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          responses.push(parsed);
        } catch {
          // Ignore non-JSON lines
        }
      }
      resolve({ responses, errorOutput });
    });

    // Send initialize first
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    });

    // Send tool call
    const toolRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: tool,
        arguments: params
      }
    });

    child.stdin.write(initRequest + '\n');
    child.stdin.write(toolRequest + '\n');
    child.stdin.end();
  });
}

async function testToolsList() {
  console.log('\n📋 Test 1: tools/list');
  try {
    const result = await callMcpTool(null, {});
    // Check if eidolon_subbrain_auto is in the tools list
    const hasSubBrain = result.responses.some(r => 
      JSON.stringify(r).includes('eidolon_subbrain_auto')
    );
    if (hasSubBrain) {
      console.log('  ✅ eidolon_subbrain_auto registered');
    } else {
      console.log('  ⚠️  Checking tool list...');
      console.log('  Responses:', JSON.stringify(result.responses, null, 2).substring(0, 500));
    }
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
  }
}

async function testSubBrainAuto() {
  console.log('\n🧠 Test 2: eidolon_subbrain_auto');
  try {
    const result = await callMcpTool('eidolon_subbrain_auto', {
      input: 'audit project code for security',
      user_id: 'test-user',
      auto_execute: false,
      max_tools: 2
    });

    const toolResponse = result.responses.find(r => r.id === 2 && r.result);
    if (toolResponse?.result?.content?.[0]?.text) {
      const analysis = JSON.parse(toolResponse.result.content[0].text);
      console.log('  ✅ Sub-Brain response received');
      console.log(`  Intent: ${analysis.subbrain_analysis?.intent_classification?.category || 'N/A'}`);
      console.log(`  Strategy: ${analysis.subbrain_analysis?.routing_strategy || 'N/A'}`);
      console.log(`  Ready for LLM: ${analysis.ready_for_llm_analysis}`);
    } else {
      console.log('  ⚠️  Unexpected response format');
      console.log('  Response:', JSON.stringify(toolResponse, null, 2).substring(0, 500));
    }
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
  }
}

async function main() {
  await testToolsList();
  await testSubBrainAuto();
  console.log('\n✨ Test complete\n');
}

main().catch(console.error);
