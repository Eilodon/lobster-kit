const fs = require('fs');
const path = 'packages/integration-tests/test/integration/cognitive-audit-benchmark.test.ts';
let code = fs.readFileSync(path, 'utf8');

// 1. Remove duplicate MONOREPO_ROOT declarations
code = code.replace(/(\/\/ Compute monorepo root relative to this file\n\/\/ This file is in packages\/integration-tests\/test\/integration\/\nconst MONOREPO_ROOT = path\.resolve\(__dirname, '\.\.\/\.\.\/\.\.\/\.\.'\);\n\n)+/g, "// Compute monorepo root relative to this file\n// This file is in packages/integration-tests/test/integration/\nconst MONOREPO_ROOT = path.resolve(__dirname, '../../../..');\n\n");

// 2. Fix maxFiles
code = code.replace(/const files = this\.findFiles\(options\.targetDir, options\.maxFiles\);\n\s*filesScanned\.push\(\.\.\.files\);/g, "const files = this.findFiles(options.targetDir, 500);\n    filesScanned.push(...files);");
code = code.replace(/private findFiles\(dir: string, maxFiles = 50\): string\[\]/g, "private findFiles(dir: string, maxFiles = 500): string[]");

// 3. Fix process.cwd() -> MONOREPO_ROOT for findings and mcpBin and spawn and targetDir
code = code.replace(/file: path\.relative\(process\.cwd\(\), file\)/g, "file: path.relative(MONOREPO_ROOT, file)");
code = code.replace(/const fullBinPath = path\.resolve\(process\.cwd\(\), this\.mcpBin\)/g, "const fullBinPath = path.resolve(MONOREPO_ROOT, this.mcpBin)");
code = code.replace(/cwd: process\.cwd\(\),/g, "cwd: MONOREPO_ROOT,");
code = code.replace(/targetDir: path\.resolve\(process\.cwd\(\), 'packages'\)/g, "targetDir: path.resolve(MONOREPO_ROOT, 'packages')");
code = code.replace(/const reportPath = path\.resolve\(process\.cwd\(\), 'data\/memory/g, "const reportPath = path.resolve(MONOREPO_ROOT, 'data/memory");

fs.writeFileSync(path, code);
