#!/bin/bash
set -e

# Build the WASM package
# Assumes running from packages/soul/ or root used with correct context
# Just usage: pnpm build:wasm (from soul)

echo "🏗️ Building WASM package..."
WASM_TARGET="${WASM_TARGET:-nodejs}"
if [ "${WASM_ENABLE_SIMD:-0}" = "1" ]; then
  echo "⚡ SIMD enabled (simd128 + bulk-memory)"
  RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+simd128,+bulk-memory" \
    wasm-pack build --target "${WASM_TARGET}" --release --out-dir pkg core-rust
else
  wasm-pack build --target "${WASM_TARGET}" --release --out-dir pkg core-rust
fi

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
