const fs = require('fs');

const filesToUpdate = [
    'packages/soul/src/eidolon/EidolonGuard.ts',
    'packages/soul/src/index.ts',
    'packages/soul/test/NeuralLink.test.ts',
    'packages/soul/test/DivineTransparency.test.ts',
    'packages/soul/test/EidolonGuard.test.ts',
    'packages/soul/src/eidolon/ActiveLearning.ts',
    'packages/soul/test/ActiveLearning.test.ts',
    'packages/soul/test/CausalBrain.test.ts',
    'packages/soul/test/CausalBrainConsistency.test.ts',
    'packages/soul/test/CausalBrainRustBridge.test.ts',
    'packages/soul/test/CausalBrainSchemaRegression.test.ts',
    'packages/core/src/index.ts'
];

for (const file of filesToUpdate) {
    let content = fs.readFileSync(file, 'utf8');

    content = content.replace(/from '\.\.\/ai\/CausalBrain'/g, "from '@clawkit/core'");
    content = content.replace(/from '\.\/eidolon\/DivineTransparency'/g, "from '@clawkit/core'");
    content = content.replace(/from '\.\/DivineTransparency'/g, "from '@clawkit/core'");
    content = content.replace(/from '\.\.\/src\/eidolon\/DivineTransparency'/g, "from '@clawkit/core'");
    content = content.replace(/from '\.\.\/src\/ai\/CausalBrain'/g, "from '@clawkit/core'");

    fs.writeFileSync(file, content);
}

// Fix CausalBrain.ts inside core
let cb = fs.readFileSync('packages/core/src/ai/CausalBrain.ts', 'utf8');
cb = cb.replace(/from '@clawkit\/core'/g, "from '../memory/IStorageProvider'");
fs.writeFileSync('packages/core/src/ai/CausalBrain.ts', cb);

// Fix DivineTransparency.ts inside core
let dt = fs.readFileSync('packages/core/src/DivineTransparency.ts', 'utf8');
dt = dt.replace(/from '\.\.\/ai\/IOracle'/g, "from './ai/IOracle'");
dt = dt.replace(/from '\.\/EidolonTypes'/g, "from './types/EidolonTypes'");
fs.writeFileSync('packages/core/src/DivineTransparency.ts', dt);

// Fix core index
let ci = fs.readFileSync('packages/core/src/index.ts', 'utf8');
if (!ci.includes('DivineTransparency')) {
    ci += `\nexport { DivineTransparency } from './DivineTransparency';\n`;
}
if (!ci.includes('CausalBrain')) {
    ci += `\nexport { CausalBrain, CausalEdge } from './ai/CausalBrain';\n`;
}
fs.writeFileSync('packages/core/src/index.ts', ci);
