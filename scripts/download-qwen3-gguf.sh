#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MODEL_DIR="${MODEL_DIR:-${REPO_ROOT}/.models}"
GGUF_OUT="${GGUF_OUT:-${MODEL_DIR}/qwen3-1.7b-instruct-q4_k_m.gguf}"
TOKENIZER_OUT="${TOKENIZER_OUT:-${MODEL_DIR}/qwen3-tokenizer.json}"

GGUF_URL="${GGUF_URL:-https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf?download=true}"
TOKENIZER_URL="${TOKENIZER_URL:-https://huggingface.co/Qwen/Qwen3-1.7B/resolve/main/tokenizer.json?download=true}"

mkdir -p "${MODEL_DIR}"

echo "[mcp-qwen3] model dir: ${MODEL_DIR}"

if [[ -s "${GGUF_OUT}" ]]; then
  echo "[mcp-qwen3] GGUF exists, skipping download: ${GGUF_OUT}"
else
  echo "[mcp-qwen3] downloading GGUF -> ${GGUF_OUT}"
  curl -L --fail --retry 3 --retry-delay 2 -C - -o "${GGUF_OUT}" "${GGUF_URL}"
fi

if [[ -s "${TOKENIZER_OUT}" ]]; then
  echo "[mcp-qwen3] tokenizer exists, skipping download: ${TOKENIZER_OUT}"
else
  echo "[mcp-qwen3] downloading tokenizer -> ${TOKENIZER_OUT}"
  curl -L --fail --retry 3 --retry-delay 2 -o "${TOKENIZER_OUT}" "${TOKENIZER_URL}"
fi

GGUF_MAGIC="$(dd if="${GGUF_OUT}" bs=4 count=1 2>/dev/null || true)"
if [[ "${GGUF_MAGIC}" != "GGUF" ]]; then
  echo "[mcp-qwen3] ERROR: invalid GGUF header at ${GGUF_OUT}" >&2
  exit 66
fi

GGUF_SIZE="$(stat -c %s "${GGUF_OUT}")"
if (( GGUF_SIZE < 100 * 1024 * 1024 )); then
  echo "[mcp-qwen3] ERROR: GGUF file too small (${GGUF_SIZE} bytes): ${GGUF_OUT}" >&2
  exit 66
fi

TOK_SIZE="$(stat -c %s "${TOKENIZER_OUT}")"
if (( TOK_SIZE < 1024 )); then
  echo "[mcp-qwen3] ERROR: tokenizer file too small (${TOK_SIZE} bytes): ${TOKENIZER_OUT}" >&2
  exit 66
fi

echo "[mcp-qwen3] ready:"
echo "  GGUF: ${GGUF_OUT} (${GGUF_SIZE} bytes)"
echo "  tokenizer: ${TOKENIZER_OUT} (${TOK_SIZE} bytes)"
