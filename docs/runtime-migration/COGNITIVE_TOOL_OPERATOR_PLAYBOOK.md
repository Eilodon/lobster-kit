# Cognitive Tool Operator Playbook (LLM-First, Updated: 2026-02-22)

Muc tieu: toi da hoa gia tri thuc te cua `clawkit_*` tools cho LLM khi xu ly tac vu thuc chien, giam hallucination, giam token waste, va tang kha nang quyet dinh co kiem soat.

## 1) Su that van hanh can nho

- `clawkit_*` la nhom tool cognitive chinh, co telemetry + audit qua `tools/call`.
- Nhieu `eidolon_*` hien la compatibility bridge (legacy emulation), khong nen coi la engine DeFi/Security production-ready.
- `memories` hien la state trong process runtime; restart process co the mat bo nho tam thoi.
- `tool_performance`, `generated_tool_audit`, `recommender_shadow_audit` duoc persist vao SQLite.

## 2) Pipeline chuan de LLM goi tool

Ap dung cho task phuc tap, task rui ro, hoac task can truy hoi boi canh:

1. `clawkit_tool_recommend`
2. `clawkit_route_action`
3. `clawkit_memory_query`
4. `clawkit_compress_context`
5. `clawkit_reason_chain`
6. `clawkit_simulate_response` (neu co hanh dong rui ro)
7. `clawkit_record_outcome` (sau khi co ket qua)

Mac dinh:
- Dung `recommender_model=v2`, `shadow_mode=true`.
- Dung `route=auto` cho `memory_query`.
- Dung `mode=auto` cho `reason_chain`, co `latency_budget_ms` ro rang.

## 3) Chinh sach goi tool theo loai tac vu

### A. Q&A ngan, factual don gian

- Khong can full pipeline.
- Chi goi `clawkit_memory_query` neu can boi canh lich su.

### B. Planning / architecture / trade-off

- Bat buoc: `tool_recommend -> memory_query -> compress_context -> reason_chain`.
- Them `route_action` neu co xac suat phat sinh action can xac nhan user.

### C. Action co rui ro (swap, security, automation)

- Bat buoc: `route_action -> reason_chain -> simulate_response`.
- Neu `route_action.strategy=ASK_USER`, dung va hoi xac nhan user.

### D. Loop hoc hoi

- Moi ket qua tot/xau deu goi `record_outcome`.
- Dinh ky goi `dream_conversation` de thu gon memory in-process.

## 4) Nguong quyet dinh de LLM tu xu ly

Su dung ket qua `clawkit_route_action`:

- `AUTO`: tu thuc hien buoc tiep.
- `PROPOSE`: dua 1 de xuat ro rang, cho user chap thuan nhanh.
- `ASK_USER`: dung, dat cau hoi xac nhan ngan gon truoc khi action.

## 5) Template tham so khuyen nghi

### `clawkit_tool_recommend`

```json
{
  "task": "analyze risk and retrieve relevant memory before action",
  "available_tools": [
    "clawkit_memory_query",
    "clawkit_reason_chain",
    "clawkit_compress_context",
    "clawkit_simulate_response"
  ],
  "recommender_model": "v2",
  "shadow_mode": true
}
```

### `clawkit_memory_query`

```json
{
  "query": "why risk increased before swap execution",
  "route": "auto",
  "k": 8
}
```

### `clawkit_compress_context`

```json
{
  "target_tokens": 600,
  "preserve_recent": 4,
  "dedupe_threshold": 0.85,
  "focus_terms": ["risk", "slippage", "approval", "rollback"]
}
```

### `clawkit_reason_chain`

```json
{
  "draft": "proposed action or answer",
  "context": "compressed context text",
  "mode": "auto",
  "latency_budget_ms": 1200
}
```

### `clawkit_route_action`

```json
{
  "suggested_tool": "clawkit_reason_chain",
  "intent_confidence": 0.74,
  "context_type": "risk_analysis"
}
```

## 6) Nhung gi khong nen lam

- Khong dung `eidolon_*` de ky vong quote/scan/swap that trong runtime Rust hien tai.
- Khong bo qua `tools/call`; bo qua se mat telemetry va audit.
- Khong goi song song cac buoc co phu thuoc du lieu (vi du: `update_user` va `recall_user` cung luc).
- Khong dua context dai vao `reason_chain` ma khong `compress_context` truoc.

## 7) Telemetry loop de nang chat luong

Theo doi:
- `eidolon://telemetry`
- `eidolon://generated-tool-audit`
- `eidolon://recommender-shadow`

Gate toi thieu truoc promotion:
- du call_count theo nguong phase gate
- error rate/p95/fallback rate khong breach
- co artifact shadow A/B trong `recommender_shadow_audit`

## 8) Muc tieu toi uu cho chinh LLM operator

- Gia tri lon nhat cua bo tool nay khong nam o mot tool le, ma o chu trinh:
  recommend -> route -> retrieve -> compress -> reason -> simulate -> learn.
- Neu phai uu tien, uu tien 4 tool nay truoc:
  `clawkit_memory_query`, `clawkit_compress_context`, `clawkit_reason_chain`, `clawkit_tool_recommend`.
