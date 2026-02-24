#!/bin/bash
set -e

# Build the WASM package
# Supports both new structure (crates/core-rust) and legacy (packages/soul/core-rust)
# Usage: pnpm build:wasm (from soul) or bash scripts/build_wasm.sh (from root)

echo "🏗️ Building WASM package..."
WASM_TARGET="${WASM_TARGET:-nodejs}"

# Determine core-rust location
# Priority: crates/core-rust (new workspace) > packages/soul/core-rust (legacy)
if [ -d "crates/core-rust" ]; then
  CORE_RUST_DIR="crates/core-rust"
elif [ -d "core-rust" ]; then
  CORE_RUST_DIR="core-rust"
elif [ -d "packages/soul/core-rust" ]; then
  CORE_RUST_DIR="packages/soul/core-rust"
else
  echo "❌ Cannot find core-rust directory"
  exit 1
fi

echo "📦 Using core-rust at: ${CORE_RUST_DIR}"

if [ "${WASM_ENABLE_SIMD:-0}" = "1" ]; then
  echo "⚡ SIMD enabled (simd128 + bulk-memory)"
  RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+simd128,+bulk-memory" \
    wasm-pack build --target "${WASM_TARGET}" --release --out-dir pkg "${CORE_RUST_DIR}"
else
  wasm-pack build --target "${WASM_TARGET}" --release --out-dir pkg "${CORE_RUST_DIR}"
fi

# Clean up
echo "🧹 Cleaning up..."
rm -f pkg/.gitignore

# Keep backward-compatible path for legacy consumers:
# core-rust/pkg -> ../pkg (single source of WASM artifacts).
if [ -d "core-rust" ] || [ -L "core-rust/pkg" ] || [ -d "core-rust/pkg" ]; then
  if [ -L core-rust/pkg ] || [ -d core-rust/pkg ]; then
    rm -rf core-rust/pkg
  fi
  ln -s ../pkg core-rust/pkg
fi

# Also create symlink for new structure
if [ -d "crates/core-rust" ]; then
  if [ -L "crates/core-rust/pkg" ] || [ -d "crates/core-rust/pkg" ]; then
    rm -rf "crates/core-rust/pkg"
  fi
  ln -s ../../pkg "crates/core-rust/pkg"
fi

# Sync the new build directly to src/wasm so tests and adapter load the freshest bindings
mkdir -p packages/soul/src/wasm
if [ -d "pkg" ]; then
  cp -r pkg/* packages/soul/src/wasm/ || true
fi

echo "✅ WASM build complete. Artifacts in pkg/"
echo "   - pkg/core_rust.js"
echo "   - pkg/core_rust_bg.wasm"
echo "   - pkg/core_rust.d.ts"
echo "🔗 Legacy aliases updated"
