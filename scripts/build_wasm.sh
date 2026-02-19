#!/bin/bash
set -e

# Build the WASM package
# Assumes running from packages/soul/ or root used with correct context
# Just usage: pnpm build:wasm (from soul)

echo "🏗️ Building WASM package..."
wasm-pack build --target nodejs --release --out-dir pkg core-rust

# Clean up
echo "🧹 Cleaning up..."
rm -f pkg/.gitignore

# Keep backward-compatible path for legacy consumers:
# core-rust/pkg -> ../pkg (single source of WASM artifacts).
if [ -L core-rust/pkg ] || [ -d core-rust/pkg ]; then
  rm -rf core-rust/pkg
fi
ln -s ../pkg core-rust/pkg

echo "✅ WASM build complete. Artifacts in pkg/"
echo "   - pkg/core_rust.js"
echo "   - pkg/core_rust_bg.wasm"
echo "   - pkg/core_rust.d.ts"
echo "🔗 Legacy alias updated: core-rust/pkg -> ../pkg"
