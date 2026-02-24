#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');

/** @typedef {{ from: string; to: string; transform?: (content: string) => string }} MirrorRule */

/** @type {MirrorRule[]} */
const mirrorRules = [
  { from: 'packages/defi-bnb/src/nft.ts', to: 'packages/integration-tests/src/nft.ts' },
  {
    from: 'packages/soul/src/oracles/PythAdapter.ts',
    to: 'packages/integration-tests/src/eidolon/oracles/PythAdapter.ts',
    transform: (content) =>
      content.replace(
        "import { PythConfig } from '../config/PythConfig';",
        "import type { PythConfig } from '@clawkit/soul';"
      )
  },
  {
    from: 'packages/core/src/memory/GreenfieldAdapter.ts',
    to: 'packages/integration-tests/src/eidolon/memory/GreenfieldAdapter.ts',
    transform: (content) =>
      content.replace(
        "import { IStorageProvider } from './IStorageProvider';",
        "import type { IStorageProvider } from '@clawkit/core';"
      ).replace(
        "import { AsyncLock } from \"../utils/AsyncLock\";",
        "import { AsyncLock } from '@clawkit/core';"
      )
  },
  {
    from: 'packages/core/src/memory/SQLiteLearningStore.ts',
    to: 'packages/integration-tests/src/eidolon/memory/SQLiteLearningStore.ts',
    transform: (content) =>
      content.replace(
        "import { IStorageProvider } from './IStorageProvider';",
        "import type { IStorageProvider } from '@clawkit/core';"
      )
  },
  {
    from: 'packages/core/src/memory/AppendOnlyAdapter.ts',
    to: 'packages/integration-tests/src/eidolon/memory/AppendOnlyAdapter.ts',
    transform: (content) =>
      content.replace(
        "import { IStorageProvider } from './IStorageProvider';",
        "import type { IStorageProvider } from '@clawkit/core';"
      ).replace(
        "import { AsyncLock } from '../utils/AsyncLock';",
        "import { AsyncLock } from '@clawkit/core';"
      )
  },
  { from: 'packages/defi-bnb/src/utils/ApiGateway.ts', to: 'packages/integration-tests/src/utils/ApiGateway.ts' },
  { from: 'packages/toolkit/src/services/PriceService.ts', to: 'packages/integration-tests/src/services/PriceService.ts' }
];

const changed = [];

for (const rule of mirrorRules) {
  const sourcePath = path.join(repoRoot, rule.from);
  const targetPath = path.join(repoRoot, rule.to);

  let content = await readFile(sourcePath, 'utf8');
  if (rule.transform) {
    content = rule.transform(content);
  }

  await mkdir(path.dirname(targetPath), { recursive: true });

  let oldContent = '';
  try {
    oldContent = await readFile(targetPath, 'utf8');
  } catch {
    // New file target.
  }

  if (oldContent !== content) {
    if (!checkOnly) {
      await writeFile(targetPath, content, 'utf8');
    }
    changed.push(rule.to);
  }
}

if (changed.length === 0) {
  console.log('sync-integration-mirrors: no changes');
} else {
  console.log(checkOnly
    ? 'sync-integration-mirrors: drift detected in files:'
    : 'sync-integration-mirrors: updated files:');
  for (const file of changed) {
    console.log(`- ${file}`);
  }
  if (checkOnly) {
    process.exitCode = 1;
  }
}
