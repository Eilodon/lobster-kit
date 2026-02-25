#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MCP_BIN="${MCP_BIN:-${REPO_ROOT}/target/release/mcp-server}"
GGUF_PATH="${TENSOR_ORACLE_GGUF_PATH:-${REPO_ROOT}/.models/qwen3-1.7b-instruct-q4_k_m.gguf}"
TOKENIZER_PATH="${TENSOR_ORACLE_TOKENIZER_PATH:-${REPO_ROOT}/.models/qwen3-tokenizer.json}"

fail() {
  echo "[mcp-preflight] ERROR: $*" >&2
  exit 66
}

[[ -x "${MCP_BIN}" ]] || fail "mcp-server binary not executable: ${MCP_BIN}. Run: cargo build -p mcp-server --release"
[[ -f "${GGUF_PATH}" ]] || fail "missing GGUF: ${GGUF_PATH}. Run: scripts/download-qwen3-gguf.sh"
[[ -s "${GGUF_PATH}" ]] || fail "empty GGUF: ${GGUF_PATH}"
[[ -f "${TOKENIZER_PATH}" ]] || fail "missing tokenizer: ${TOKENIZER_PATH}. Run: scripts/download-qwen3-gguf.sh"
[[ -s "${TOKENIZER_PATH}" ]] || fail "empty tokenizer: ${TOKENIZER_PATH}"

GGUF_MAGIC="$(dd if="${GGUF_PATH}" bs=4 count=1 2>/dev/null || true)"
[[ "${GGUF_MAGIC}" == "GGUF" ]] || fail "invalid GGUF header at ${GGUF_PATH}"

GGUF_SIZE="$(stat -c %s "${GGUF_PATH}")"
(( GGUF_SIZE >= 100 * 1024 * 1024 )) || fail "GGUF too small (${GGUF_SIZE} bytes): ${GGUF_PATH}"

TOK_SIZE="$(stat -c %s "${TOKENIZER_PATH}")"
(( TOK_SIZE >= 1024 )) || fail "tokenizer too small (${TOK_SIZE} bytes): ${TOKENIZER_PATH}"

export TENSOR_ORACLE_GGUF_PATH="${GGUF_PATH}"
export TENSOR_ORACLE_TOKENIZER_PATH="${TOKENIZER_PATH}"
export TENSOR_ORACLE_ALLOW_HF_DOWNLOAD="${TENSOR_ORACLE_ALLOW_HF_DOWNLOAD:-false}"

exec "${MCP_BIN}" "$@"
