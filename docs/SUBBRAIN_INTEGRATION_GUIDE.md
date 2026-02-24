# Sub-Brain Auto-Orchestration Integration Guide

## Tổng quan

**Sub-Brain Auto-Orchestration** là giải pháp tối ưu để tích hợp pre-processing layer vào Windsurf/Cascade flow. Thay vì để LLM tự quyết định gọi tool, Sub-Brain tự động:

1. **Phân loại intent** từ user input
2. **Recommend tools** phù hợp
3. **Auto-execute** nếu confidence cao (>75%)
4. **Trả về enriched context** cho LLM phân tích

## Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                     User Input                              │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              Cascade LLM (Windsurf)                         │
│  Gọi: eidolon_subbrain_auto({input: "..."})                 │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              MCP Server: eidolon_subbrain_auto              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Layer 1: Intent Classification                        │ │
│  │   - eidolon_sense_intent                              │ │
│  │   - Rule-based intent matching                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                         ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Layer 2: Tool Recommendation                            │ │
│  │   - eidolon_tool_recommend                            │ │
│  │   - Embedding-based ranking                           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                         ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Layer 3: Routing Decision                               │ │
│  │   - Confidence scoring                                  │ │
│  │   - Strategy: AUTO / PROPOSE / DEEP_ANALYSIS            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                         ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Layer 4: Auto-Execution (nếu AUTO)                     │ │
│  │   - Execute tool chain                                  │ │
│  │   - Aggregate results                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                         ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Layer 5: Context Enrichment                             │ │
│  │   - Key findings extraction                             │ │
│  │   - LLM guidance generation                             │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              Enriched Context → LLM Analysis                │
│  {                                                           │
│    intent_classification,                                    │
│    tool_results,                                             │
│    key_findings,                                             │
│    suggested_approach,                                       │
│    llm_guidance                                              │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

## Files đã tạo/cập nhật

### Rust (MCP Server)

| File | Mô tả |
|------|-------|
| `crates/mcp-server/src/subbrain_auto.rs` | Core Sub-Brain implementation |
| `crates/mcp-server/src/dispatch.rs` | Register `eidolon_subbrain_auto` handler |
| `crates/mcp-server/src/main.rs` | Add module + tool catalog |

### TypeScript (Client)

| File | Mô tả |
|------|-------|
| `packages/core/src/cognitive/SubBrainOrchestratorClient.ts` | Client wrapper cho Cascade |
| `packages/core/src/cognitive/index.ts` | Export SubBrainOrchestratorClient |

## Usage

### 1. Trong Cascade Agent (Recommended)

```typescript
import { SubBrainOrchestratorClient, withSubBrainAnalysis } from '@eidolon/core';

// Option A: Direct usage
const subbrain = new SubBrainOrchestratorClient();

const userInput = "audit project code for security issues";
const analysis = await subbrain.analyzeInput(userInput, {
  userId: 'cascade-user',
  autoExecute: true,
  maxTools: 3
});

if (!('error' in analysis) && analysis.ready_for_llm_analysis) {
  // analysis.subbrain_analysis chứa:
  // - intent_classification: {category, confidence, entities, sentiment}
  // - tool_recommendations: [{tool, relevance_score}]
  // - executed_tools: ['eidolon_check_pattern', 'eidolon_reason_chain']
  // - tool_results: [...]
  // - enriched_context: {user_intent, tools_data, llm_guidance}
  // - suggested_approach: "Audit results ready..."
  
  const prompt = `
User: ${userInput}

Sub-Brain Analysis:
- Intent: ${analysis.subbrain_analysis.intent_classification.category}
- Confidence: ${(analysis.subbrain_analysis.intent_classification.confidence * 100).toFixed(0)}%
- Executed: ${analysis.subbrain_analysis.executed_tools.join(', ')}
- Key findings: ${JSON.stringify(analysis.subbrain_analysis.enriched_context.tools_data.key_findings)}
- Suggested approach: ${analysis.subbrain_analysis.suggested_approach}

Provide comprehensive response based on above analysis.
`;
  
  // Send to LLM...
}

// Option B: Wrapper function
const response = await withSubBrainAnalysis(
  userInput,
  async (analysis) => {
    // Generate response dựa trên enriched analysis
    return generateLLMResponse(analysis);
  }
);
```

### 2. Intent Classification Only (Quick Check)

```typescript
const subbrain = new SubBrainOrchestratorClient();

const intent = await subbrain.classifyIntent("fix bug in WasmAdapter");
// {
//   intent: "DebugIssue",
//   confidence: 0.85,
//   suggestedTools: ["eidolon_recall_similar", "eidolon_memory_query"]
// }
```

### 3. Raw MCP Tool Call

```bash
# Gọi trực tiếp qua MCP binary
echo '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "eidolon_subbrain_auto",
    "arguments": {
      "input": "audit project code",
      "user_id": "user123",
      "auto_execute": true,
      "max_tools": 3
    }
  }
}' | ./crates/mcp-server/target/release/mcp-server
```

## Intent Categories

| Category | Trigger Keywords | Auto-Tools |
|----------|-----------------|------------|
| `CodeAudit` | "audit", "kiểm tra", "review" | `check_pattern`, `reason_chain`, `orchestrate` |
| `DebugIssue` | "bug", "lỗi", "fix", "crash" | `recall_similar`, `memory_query`, `sense_intent` |
| `ExplainCode` | "giải thích", "explain", "how" | `sense_intent`, `memory_query`, `reason_chain` |
| `CreateFeature` | "tạo", "thêm", "implement" | `tool_recommend`, `reason_chain`, `orchestrate` |
| `SecurityScan` | "security", "bảo mật" | `check_pattern`, `security_scan`, `orchestrate` |
| `MemoryQuery` | "nhớ", "recall", "context" | `recall_user`, `memory_query`, `recall_similar` |
| `GeneralQuery` | (default) | `sense_intent`, `reason_chain`, `tool_recommend` |

## Routing Strategies

| Strategy | Confidence | Behavior |
|----------|-----------|----------|
| `AUTO` | > 75% | Auto-execute tools, return enriched context |
| `PROPOSE` | 45-75% | Return tool recommendations, LLM decides |
| `DEEP_ANALYSIS` | < 45% | Request deep analysis before responding |

## Testing

```typescript
import { runSubBrainTests } from '@eidolon/core';

const results = await runSubBrainTests();
console.log(`Passed: ${results.passed}/${results.passed + results.failed}`);
// Output:
// {
//   passed: 3,
//   failed: 0,
//   results: [
//     { test: 'Intent Classification', success: true },
//     { test: 'Full Sub-Brain Analysis', success: true },
//     { test: 'Debug Intent Handling', success: true }
//   ]
// }
```

## Build & Deploy

### 1. Build MCP Server

```bash
cd crates/mcp-server
cargo build --release
```

### 2. Verify Tool Registration

```bash
# Tool should appear in tools/list
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ./target/release/mcp-server
```

### 3. Test Integration

```bash
# Test Sub-Brain with sample input
echo '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "eidolon_subbrain_auto",
    "arguments": {"input": "audit project", "auto_execute": false}
  }
}' | ./target/release/mcp-server
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Unknown tool` | Tool not registered | Check `dispatch.rs` và `main.rs` |
| `MCP timeout` | Binary not found | Verify `mcp-server` compiled successfully |
| `Intent always GeneralQuery` | Keywords not matching | Check intent classification logic trong `subbrain_auto.rs` |
| `No tools executed` | auto_execute=false hoặc confidence thấp | Set `auto_execute: true` hoặc check confidence threshold |

## So sánh với các phương án khác

| Approach | Pros | Cons | Use Case |
|----------|------|------|----------|
| **Sub-Brain (này)** | Single tool call, tận dụng sẵn orchestrators | Cần rebuild MCP | **Production** |
| MetaCognitiveOrchestrator (TS) | Không cần modify Rust | Complex integration | Development |
| Prompt Engineering | Đơn giản | Không đảm bảo compliance | Quick prototyping |
| External Pre-processor | Full control | Complex deployment | Custom infrastructure |

## Next Steps

1. ✅ Implement `eidolon_subbrain_auto` (Rust)
2. ✅ Create TypeScript client
3. ⏳ **Build & test MCP server**
4. ⏳ **Update Cascade system prompt** để auto-gọi Sub-Brain
5. ⏳ **A/B test** so sánh với native LLM decision

---

**Tóm lại:** Sub-Brain Auto-Orchestration là giải pháp tối ưu nhất - kết hợp sức mạnh của các orchestrators sẵn có trong project thành một entry point duy nhất, dễ integrate vào Cascade flow mà không cần modify IDE internals.
