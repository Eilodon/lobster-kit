#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function isMcpBinaryFresh(binPath) {
    if (!fs.existsSync(binPath)) return false;
    const binMtime = fs.statSync(binPath).mtimeMs;
    const watchedInputs = [
        path.resolve(repoRoot, 'crates/mcp-server/src/main.rs'),
        path.resolve(repoRoot, 'crates/mcp-server/Cargo.toml'),
        path.resolve(repoRoot, 'crates/mcp-server/Cargo.lock'),
    ];
    return watchedInputs.every((entry) => !fs.existsSync(entry) || fs.statSync(entry).mtimeMs <= binMtime);
}

function resolveMcpCommand() {
    const releaseBin = path.resolve(repoRoot, 'crates/mcp-server/target/release/mcp-server');
    if (isMcpBinaryFresh(releaseBin)) {
        return { cmd: releaseBin, cmdArgs: [] };
    }
    return {
        cmd: 'cargo',
        cmdArgs: ['run', '--release', '--manifest-path', 'crates/mcp-server/Cargo.toml', '--quiet'],
    };
}

function startMcpProcess() {
    const resolved = resolveMcpCommand();
    const child = spawn(resolved.cmd, resolved.cmdArgs, {
        cwd: repoRoot,
        env: { ...process.env, TENSOR_ORACLE_ALLOW_HF_DOWNLOAD: "true" },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    let reqId = 1;
    const pending = new Map();

    const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
        let parsed;
        try {
            parsed = JSON.parse(line);
        } catch {
            return;
        }
        const id = parsed?.id;
        if (!pending.has(id)) return;
        const entry = pending.get(id);
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve(parsed?.result ?? parsed?.error ?? null);
    });

    child.stderr.on('data', (data) => {
        if (process.env.DEBUG) console.error(data.toString());
    });

    child.on('exit', () => {
        for (const [, entry] of pending) {
            clearTimeout(entry.timer);
            entry.reject(new Error('MCP process exited before response'));
        }
        pending.clear();
    });

    function call(method, params, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const id = reqId++;
            const payload = {
                jsonrpc: '2.0',
                id,
                method,
                params: params ?? {},
            };
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Timeout after ${timeoutMs}ms for method=${method}`));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
            child.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    function stop() {
        child.kill();
        rl.close();
    }

    return { call, stop, resolved };
}

function percentile(arr, p) {
    if (arr.length === 0) return 0;
    arr.sort((a, b) => a - b);
    const index = (arr.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (upper >= arr.length) return arr[lower];
    return arr[lower] * (1 - weight) + arr[upper] * weight;
}

async function runBenchmark(mcp, concurrency, totalRequests) {
    const latencies = [];
    let errors = 0;

    let currentReq = 0;
    const workers = Array(concurrency).fill(0).map(async () => {
        while (currentReq < totalRequests) {
            currentReq++;
            const start = Date.now();
            try {
                const res = await mcp.call('eidolon_sense_intent', { query: "What is the market doing?" });
                if (res?.error || res?.isError) {
                    errors++;
                }
            } catch (err) {
                errors++;
            } finally {
                const latency = Date.now() - start;
                latencies.push(latency);
            }
        }
    });

    await Promise.all(workers);

    return { latencies, errors };
}

async function main() {
    console.log("Starting MCP Server to benchmark baseline...");
    const mcp = startMcpProcess();

    // Wait for it to boot (TensorOracle might take a bit)
    await new Promise(r => setTimeout(r, 15000));

    // Warm up
    console.log("Warming up...");
    try {
        await mcp.call('eidolon_sense_intent', { query: "hello" });
    } catch (e) {
        console.error("Warmup failed", e);
    }

    const concurrency = parseInt(process.argv[2] || "5", 10);
    const totalRequests = parseInt(process.argv[3] || "50", 10);

    console.log(`Running benchmark with concurrency=${concurrency}, total=${totalRequests}`);
    const start = Date.now();

    const { latencies, errors } = await runBenchmark(mcp, concurrency, totalRequests);

    const totalTime = Date.now() - start;

    mcp.stop();

    const p50 = percentile(latencies, 0.5);
    const p90 = percentile(latencies, 0.9);
    const p95 = percentile(latencies, 0.95);
    const p99 = percentile(latencies, 0.99);
    const avg = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const throughput = (totalRequests / totalTime) * 1000;

    console.log("\n=== Baseline Benchmark Results ===");
    console.log(`Concurrency : ${concurrency}`);
    console.log(`Total Req   : ${totalRequests}`);
    console.log(`Errors      : ${errors}`);
    console.log(`Throughput  : ${throughput.toFixed(2)} req/sec`);
    console.log(`Avg Latency : ${avg.toFixed(2)} ms`);
    console.log(`P50 Latency : ${p50.toFixed(2)} ms`);
    console.log(`P90 Latency : ${p90.toFixed(2)} ms`);
    console.log(`P95 Latency : ${p95.toFixed(2)} ms`);
    console.log(`P99 Latency : ${p99.toFixed(2)} ms`);

    const reportOut = path.resolve(repoRoot, 'data/memory/benchmark_baseline.json');
    fs.mkdirSync(path.dirname(reportOut), { recursive: true });
    fs.writeFileSync(reportOut, JSON.stringify({
        timestamp: Date.now(),
        concurrency,
        totalRequests,
        errors,
        throughput,
        avg, p50, p90, p95, p99
    }, null, 2));

    console.log(`\nReport saved to ${reportOut}`);
}

main().catch(err => {
    console.error("Benchmark failed:", err);
    process.exit(1);
});
