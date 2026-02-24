import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'fs';
import { join } from 'path';

const IGNORE_DIRS = ['node_modules', 'dist', 'target', '.git', 'coverage', '.turbo'];
const IGNORE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz', '.wasm', '.rlib', '.so', '.dll', '.rmeta', '.d'];

function walkAndReplace(dir) {
    const items = readdirSync(dir);
    for (const item of items) {
        if (IGNORE_DIRS.includes(item)) continue;

        const fullPath = join(dir, item);
        let stat;
        try {
            stat = lstatSync(fullPath);
        } catch (e) {
            continue; // Skip broken symlinks or missing files
        }

        if (stat.isDirectory()) {
            walkAndReplace(fullPath);
        } else if (stat.isFile()) {
            if (IGNORE_EXTS.some(ext => fullPath.endsWith(ext))) continue;

            try {
                let content = readFileSync(fullPath, 'utf-8');
                let newContent = content
                    .replace(/eidolon/g, 'eidolon')
                    .replace(/Eidolon/g, 'Eidolon')
                    .replace(/EIDOLON/g, 'EIDOLON')
                    .replace(/Eidolon/g, 'Eidolon');

                if (content !== newContent) {
                    writeFileSync(fullPath, newContent, 'utf-8');
                    console.log(`Updated: ${fullPath}`);
                }
            } catch (e) {
                // Ignore unreadable/binary files
            }
        }
    }
}

// Rename specific files first
const filesToRename = [
    ['docs/Eidolon_CognitiveMCP_Design_v3_final.md', 'docs/Eidolon_CognitiveMCP_Design_v3_final.md'],
    ['packages/core/src/interfaces/IEidolon.ts', 'packages/core/src/interfaces/IEidolon.ts'],
    ['scripts/eidolon-benchmark.mjs', 'scripts/eidolon-benchmark.mjs']
];

for (const [oldPath, newPath] of filesToRename) {
    try {
        if (lstatSync(oldPath).isFile()) {
            spawnSync('git', ['mv', oldPath, newPath]);
            console.log(`Renamed: ${oldPath} -> ${newPath}`);
        }
    } catch (e) { }
}

console.log("Starting bulk text replacement...");
walkAndReplace('.');
console.log("Done.");
