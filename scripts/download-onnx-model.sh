#!/bin/bash
# download-onnx-model.sh — Download all-MiniLM-L6-v2 ONNX model for ClawKit embedding engine
#
# This downloads the sentence-transformers model used by sense_intent for
# zero-shot risk classification via cosine similarity against safe/danger centroids.
#
# Model: sentence-transformers/all-MiniLM-L6-v2
# Size: ~90MB (model.onnx) + ~700KB (tokenizer.json)
# Performance: ~2-5ms per embedding on CPU

set -euo pipefail

MODEL_DIR="${ONNX_MODEL_DIR:-data/models/minilm}"
HF_BASE="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main"

mkdir -p "$MODEL_DIR"

echo "[ClawKit] Downloading all-MiniLM-L6-v2 ONNX model..."

# Download ONNX model
if [ ! -f "$MODEL_DIR/model.onnx" ]; then
    echo "  → Downloading model.onnx (~90MB)..."
    curl -L -o "$MODEL_DIR/model.onnx" \
        "${HF_BASE}/onnx/model.onnx" \
        --progress-bar
else
    echo "  → model.onnx already exists, skipping."
fi

# Download tokenizer
if [ ! -f "$MODEL_DIR/tokenizer.json" ]; then
    echo "  → Downloading tokenizer.json..."
    curl -L -o "$MODEL_DIR/tokenizer.json" \
        "${HF_BASE}/tokenizer.json" \
        --progress-bar
else
    echo "  → tokenizer.json already exists, skipping."
fi

# Verify
if [ -f "$MODEL_DIR/model.onnx" ] && [ -f "$MODEL_DIR/tokenizer.json" ]; then
    MODEL_SIZE=$(du -h "$MODEL_DIR/model.onnx" | cut -f1)
    echo ""
    echo "[ClawKit] ✅ ONNX model ready at $MODEL_DIR"
    echo "  model.onnx    : $MODEL_SIZE"
    echo "  tokenizer.json: $(du -h "$MODEL_DIR/tokenizer.json" | cut -f1)"
    echo ""
    echo "To use: set ONNX_MODEL_DIR=$MODEL_DIR before running the MCP server."
    echo "The server will automatically use ONNX embeddings for sense_intent (~2-5ms vs ~2-10s Ollama)."
else
    echo "[ClawKit] ❌ Download failed. Check network and try again."
    exit 1
fi
