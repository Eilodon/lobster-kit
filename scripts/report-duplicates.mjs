#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const rootDir = path.join(repoRoot, 'packages');
const includeExt = new Set(['.ts', '.tsx', '.json']);
const skipDirs = new Set(['dist', 'node_modules', 'target', 'pkg', '.turbo']);
const intentionalExactPaths = new Set([
  // Intentional mirrors maintained by scripts/sync-integration-mirrors.mjs
  'packages/integration-tests/src/nft.ts',
  'packages/integration-tests/src/eidolon/oracles/PythAdapter.ts',
  'packages/integration-tests/src/eidolon/memory/GreenfieldAdapter.ts',
  'packages/integration-tests/src/eidolon/memory/SQLiteLearningStore.ts',
  'packages/integration-tests/src/eidolon/memory/AppendOnlyAdapter.ts',
  'packages/integration-tests/src/utils/ApiGateway.ts',
  'packages/integration-tests/src/services/PriceService.ts'
]);

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      await walk(fullPath, out);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name);
    if (!includeExt.has(ext)) continue;

    const normalized = fullPath.replace(/\\/g, '/');
    if (!normalized.includes('/src/')) continue;

    out.push(fullPath);
  }
  return out;
}

function hashContent(content) {
  return createHash('sha1').update(content).digest('hex');
}

function rel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, '/');
}

function isIntentionalDuplicate(filePath, contentUtf8) {
  const relative = rel(filePath);
  if (intentionalExactPaths.has(relative)) {
    return true;
  }

  const compact = contentUtf8.trim();
  const isSimpleReExport = /^export\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?$/.test(compact);
  return isSimpleReExport;
}

const files = await walk(rootDir);
const groups = new Map();

for (const file of files) {
  const st = await stat(file);
  if (st.size === 0) continue;
  const content = await readFile(file);
  const contentUtf8 = content.toString('utf8');
  if (isIntentionalDuplicate(file, contentUtf8)) continue;
  const hash = hashContent(content);
  const list = groups.get(hash) ?? [];
  list.push(file);
  groups.set(hash, list);
}

const duplicates = [...groups.entries()]
  .filter(([, list]) => list.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

if (duplicates.length === 0) {
  console.log('No duplicate source files detected under packages/*/src.');
  process.exit(0);
}

console.log(`Duplicate source groups: ${duplicates.length}`);
for (const [hash, list] of duplicates) {
  console.log(`\n[${hash}] x${list.length}`);
  for (const file of list.map(rel).sort()) {
    console.log(`- ${file}`);
  }
}
