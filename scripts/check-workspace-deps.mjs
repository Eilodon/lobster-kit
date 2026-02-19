#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PACKAGES_DIR = path.join(ROOT, "packages");
const SOURCE_DIR_NAME = "src";
const SOURCE_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

if (!fs.existsSync(PACKAGES_DIR)) {
  console.error("Missing packages/ directory.");
  process.exit(1);
}

function listPackageDirs() {
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name))
    .filter((pkgDir) => fs.existsSync(path.join(pkgDir, "package.json")));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectSourceFiles(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "target") {
        continue;
      }
      collectSourceFiles(fullPath, files);
      continue;
    }

    const ext = path.extname(entry.name);
    if (SOURCE_FILE_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

function getLineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function findWorkspaceImports(sourceText) {
  const results = [];
  const patterns = [
    /\bfrom\s+["'](@clawkit\/[a-z0-9-]+)(?:\/[^"']*)?["']/g,
    /\bimport\s+["'](@clawkit\/[a-z0-9-]+)(?:\/[^"']*)?["']/g,
    /\brequire\(\s*["'](@clawkit\/[a-z0-9-]+)(?:\/[^"']*)?["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      results.push({
        packageName: match[1],
        index: match.index ?? 0,
      });
    }
  }

  return results;
}

const packageDirs = listPackageDirs();
const packageMeta = packageDirs.map((pkgDir) => {
  const packageJsonPath = path.join(pkgDir, "package.json");
  const packageJson = readJson(packageJsonPath);
  return {
    dir: pkgDir,
    name: packageJson.name,
    dependencies: packageJson.dependencies ?? {},
    peerDependencies: packageJson.peerDependencies ?? {},
    optionalDependencies: packageJson.optionalDependencies ?? {},
  };
});

const workspacePackageNames = new Set(packageMeta.map((pkg) => pkg.name));
const errors = [];

for (const pkg of packageMeta) {
  const sourceFiles = collectSourceFiles(path.join(pkg.dir, SOURCE_DIR_NAME));
  if (sourceFiles.length === 0) {
    continue;
  }

  const declaredRuntimeDeps = new Set([
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.peerDependencies),
    ...Object.keys(pkg.optionalDependencies),
  ]);

  for (const filePath of sourceFiles) {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const imports = findWorkspaceImports(sourceText);
    for (const imp of imports) {
      if (imp.packageName === pkg.name) {
        continue;
      }
      if (!workspacePackageNames.has(imp.packageName)) {
        continue;
      }
      if (declaredRuntimeDeps.has(imp.packageName)) {
        continue;
      }

      errors.push({
        packageName: pkg.name,
        missingDependency: imp.packageName,
        filePath: path.relative(ROOT, filePath),
        line: getLineNumber(sourceText, imp.index),
      });
    }
  }
}

if (errors.length > 0) {
  console.error("Workspace dependency drift detected:");
  for (const error of errors) {
    console.error(
      `- ${error.packageName} imports ${error.missingDependency} but does not declare it in dependencies/peerDependencies/optionalDependencies`
    );
    console.error(`  at ${error.filePath}:${error.line}`);
  }
  process.exit(1);
}

console.log("Workspace dependency check passed.");
