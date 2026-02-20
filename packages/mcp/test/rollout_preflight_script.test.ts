import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function runPreflight(args: string[]) {
    return spawnSync(process.execPath, ['scripts/mcp-rollout-preflight.mjs', ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
}

describe('mcp-rollout-preflight script', () => {
    it('passes for staging profile defaults', () => {
        const result = runPreflight(['--profile', 'staging']);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('preflight: PASS');
    });

    it('fails for unsafe production config', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-preflight-'));
        const envFile = path.join(tmpDir, 'invalid-production.env');
        fs.writeFileSync(envFile, [
            'COGNITIVE_CANARY_PERCENT=20',
            'COGNITIVE_AUTO_ROLLBACK_ERROR_RATE=0.2',
            'COGNITIVE_AUTO_ROLLBACK_P95_MS=1800',
            'COGNITIVE_AUTO_ROLLBACK_MIN_CALLS=50',
            'TOOL_GEN_EXPERIMENTAL_ENABLED=true',
            'TOOL_GEN_MAX_DYNAMIC_TOOLS=16',
        ].join('\n'));

        const result = runPreflight(['--profile', 'production', '--env-file', envFile]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('errors:');
        expect(result.stderr).toContain('TOOL_GEN_EXPERIMENTAL_ENABLED');
    });
});
