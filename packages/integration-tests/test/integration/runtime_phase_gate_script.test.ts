import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function runGate(args: string[]) {
    const MONOREPO_ROOT = path.resolve(__dirname, '../../../..');
    return spawnSync(process.execPath, ['scripts/runtime-phase-gate.mjs', ...args], {
        cwd: MONOREPO_ROOT,
        encoding: 'utf8',
    });
}

describe('runtime-phase-gate script', () => {
    it('passes with valid Phase A metrics', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-gate-pass-'));
        const metricsPath = path.join(tmpDir, 'metrics-a-pass.json');
        fs.writeFileSync(metricsPath, JSON.stringify({
            window_days: 7,
            phase: {
                required_contract_pass_rate: 1,
                required_feature_flags_e2e: true,
                required_canary_e2e: true,
            },
            global: {
                max_error_rate: 0.03,
                max_rollback_count: 1,
            },
        }, null, 2));

        const result = runGate(['--phase', 'A', '--metrics', metricsPath]);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('runtime-phase-gate: PASS');
    });

    it('fails when Phase B thresholds are not met', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-gate-fail-'));
        const metricsPath = path.join(tmpDir, 'metrics-b-fail.json');
        fs.writeFileSync(metricsPath, JSON.stringify({
            window_days: 7,
            phase: {
                min_memory_count: 50000,
                max_memory_query_p95_ms: 420,
                min_recall_at_k: 0.72,
                max_data_loss_ratio: 0.01,
            },
            global: {
                max_error_rate: 0.08,
                max_rollback_count: 3,
            },
        }, null, 2));

        const result = runGate(['--phase', 'B', '--metrics', metricsPath]);
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('errors:');
        expect(result.stderr).toContain('min_memory_count');
    });
});
