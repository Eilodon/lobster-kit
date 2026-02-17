#!/bin/bash
set -e

# Build the WASM package
echo "🏗️ Building WASM package..."
wasm-pack build --target web --release --out-dir ../pkg core-rust

# Clean up
echo "🧹 Cleaning up..."
rm -f ../pkg/.gitignore

echo "✅ WASM build complete. Artifacts in pkg/"
echo "   - pkg/core_rust.js"
echo "   - pkg/core_rust_bg.wasm"
echo "   - pkg/core_rust.d.ts"
