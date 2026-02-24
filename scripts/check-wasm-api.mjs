import fs from 'fs';
import path from 'path';

const PKG_FILE = path.resolve('crates/core-rust/pkg/core_rust.d.ts');

async function checkApiSurface() {
    console.log('🛡️  Checking WASM API Surface Area Limit...');

    if (!fs.existsSync(PKG_FILE)) {
        console.error(`🚨 File not found: ${PKG_FILE}. Please build the WASM pkg first.`);
        process.exit(1);
    }

    const content = fs.readFileSync(PKG_FILE, 'utf-8');

    // Count exported items (functions, classes, interfaces)
    // Matches patterns like `export function`, `export class`, etc.
    const exportRegex = /^export\s+(function|class|interface|type)\s+/gm;
    const matches = content.match(exportRegex) || [];

    const count = matches.length;
    console.log(`📊 Total WASM API surface exports: ${count}`);

    if (count > 150) {
        console.error(`❌ CI WASM API SURFACE LIMIT EXCEEDED! Limit is 150, but found ${count} exports.`);
        console.error(`Please consolidate your WASM APIs to prevent a chaotic binding surface.`);
        process.exit(1);
    } else {
        console.log('✅ WASM API surface is well within constraints.');
    }
}

checkApiSurface().catch(err => {
    console.error(err);
    process.exit(1);
});
