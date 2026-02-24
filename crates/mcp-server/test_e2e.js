const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

const mcpBinary = path.join(__dirname, 'target', 'release', 'mcp-rust');

console.log(`Starting MCP Server: ${mcpBinary}`);
const child = spawn(mcpBinary, [], {
    env: { ...process.env, DEEPSEEK_API_KEY: 'test_key' }
});

const rl = readline.createInterface({
    input: child.stdout,
    terminal: false
});

let testIndex = 0;
const tests = [
    { method: 'eidolon_recall_user', params: { user_id: 'john_doe' } },
    { method: 'eidolon_sense_intent', params: {} },
    { method: 'eidolon_simulate_response', params: { action: 'greet' } },
    { method: 'eidolon_reason_chain', params: { draft: 'hi', context: 'none', mode: 'fast' } },
    { method: 'eidolon_record_outcome', params: { pattern: 'greeting', severity: 0 } },
];

function runNextTest() {
    if (testIndex >= tests.length) {
        console.log('\n✅ All 5 representative E2E tests passed successfully.');
        child.kill();
        process.exit(0);
        return;
    }

    const test = tests[testIndex];
    const req = {
        jsonrpc: '2.0',
        id: testIndex + 1,
        method: test.method,
        params: test.params
    };

    console.log(`\n[SEND] ${JSON.stringify(req)}`);
    child.stdin.write(JSON.stringify(req) + '\n');
}

rl.on('line', (line) => {
    try {
        const res = JSON.parse(line);
        console.log(`[RCVD] ${JSON.stringify(res, null, 2)}`);

        if (res.error) {
            console.error('❌ Error received from MCP server');
            process.exit(1);
        }

        if (res.id === testIndex + 1) {
            testIndex++;
            // Adding a small delay to simulate human typing or agent thinking
            setTimeout(runNextTest, 100);
        }
    } catch (e) {
        console.error(`Failed to parse response: ${line}`);
    }
});

child.stderr.on('data', (data) => {
    console.error(`[STDERR] ${data.toString()}`);
});

child.on('close', (code) => {
    if (code !== 0 && code !== null) {
        console.error(`MCP process exited with code ${code}`);
    }
});

// Start the first test
runNextTest();
