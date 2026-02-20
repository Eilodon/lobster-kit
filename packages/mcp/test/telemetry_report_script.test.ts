import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

function createDb(filePath: string, rows: Array<{
    tool_name: string;
    call_count: number;
    success_rate: number;
    avg_latency_ms: number;
    latency_p95_ms: number;
    fallback_rate: number;
    last_called: number;
}>) {
    const db = new Database(filePath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_performance (
        tool_name TEXT PRIMARY KEY,
        call_count INTEGER NOT NULL,
        success_rate REAL NOT NULL,
        avg_latency_ms REAL NOT NULL,
        latency_p95_ms REAL NOT NULL DEFAULT 0,
        fallback_rate REAL NOT NULL DEFAULT 0,
        last_called INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generated_tool_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL
      );
    `);
    const insert = db.prepare(`
      INSERT INTO tool_performance
        (tool_name, call_count, success_rate, avg_latency_ms, latency_p95_ms, fallback_rate, last_called)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
        insert.run(
            row.tool_name,
            row.call_count,
            row.success_rate,
            row.avg_latency_ms,
            row.latency_p95_ms,
            row.fallback_rate,
            row.last_called
        );
    }
    db.close();
}

function runReport(dbPath: string, extraArgs: string[] = []) {
    return spawnSync(process.execPath, ['scripts/mcp-telemetry-report.mjs', '--db', dbPath, ...extraArgs], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
}

describe('mcp-telemetry-report script', () => {
    it('passes when no threshold breach exists', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-telemetry-pass-'));
        const dbPath = path.join(dir, 'telemetry.db');
        createDb(dbPath, [
            {
                tool_name: 'clawkit_reason_chain',
                call_count: 50,
                success_rate: 0.9,
                avg_latency_ms: 800,
                latency_p95_ms: 1200,
                fallback_rate: 0.05,
                last_called: Date.now(),
            },
        ]);

        const result = runReport(dbPath, ['--max-error-rate', '0.2', '--max-p95-ms', '2200', '--min-calls', '30']);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('telemetry-report: PASS');
    });

    it('fails when thresholds are breached', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-telemetry-fail-'));
        const dbPath = path.join(dir, 'telemetry.db');
        createDb(dbPath, [
            {
                tool_name: 'clawkit_reason_chain',
                call_count: 60,
                success_rate: 0.7,
                avg_latency_ms: 1200,
                latency_p95_ms: 3500,
                fallback_rate: 0.2,
                last_called: Date.now(),
            },
        ]);

        const result = runReport(dbPath, ['--max-error-rate', '0.2', '--max-p95-ms', '2200', '--min-calls', '30']);
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('breached thresholds');
    });
});

