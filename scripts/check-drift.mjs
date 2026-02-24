import fs from 'fs';
import path from 'path';

// Map of filename -> expected canonical package
const CANONICAL_LOCATIONS = {
    'EidolonGuard.ts': 'soul',
    'WasmAdapter.ts': 'soul',
    'CausalBrain.ts': 'core',
    'DivineTransparency.ts': 'core',
    'EventRingBuffer.ts': 'core'
};

const PACKAGES_DIR = path.resolve('packages');

async function checkDrift() {
    console.log('🛡️  Checking for Ghost File Drift...');

    let driftFound = false;
    const packages = fs.readdirSync(PACKAGES_DIR).filter(p => fs.statSync(path.join(PACKAGES_DIR, p)).isDirectory());

    for (const pkg of packages) {
        // e.g., packages/core/src/eidolon or packages/soul/src/eidolon
        const possibleMirrorsDir = path.join(PACKAGES_DIR, pkg, 'src', 'eidolon');
        if (fs.existsSync(possibleMirrorsDir)) {
            const files = fs.readdirSync(possibleMirrorsDir);
            for (const file of files) {
                if (CANONICAL_LOCATIONS[file] && CANONICAL_LOCATIONS[file] !== pkg) {
                    console.error(`🚨 DRIFT DETECTED: Ghost file ${file} found in ${pkg} (Should only be in ${CANONICAL_LOCATIONS[file]})`);
                    driftFound = true;
                }
            }
        }
    }

    if (driftFound) {
        console.error('❌ CI DRIFT CHECK FAILED! Please consolidate ghost files into their canonical packages.');
        process.exit(1);
    } else {
        console.log('✅ No ghost file drift detected. Workspace is consolidated.');
    }
}

checkDrift().catch(err => {
    console.error(err);
    process.exit(1);
});
