# 🩺 EIDOLON-V: BÁO CÁO GIÁM ĐỊNH HỆ THỐNG (SYSTEM AUTOPSY)

**MỤC TIÊU:** Xác minh tính khả thi và sự cần thiết của kế hoạch nâng cấp "Singuarity Architect" trên codebase hiện tại.
**THỜI GIAN:** 2026-02-15
**TRẠNG THÁI:** 🔴 CRITICAL_UPGRADE_REQUIRED

---

## 1. 👁️ OMNISCIENT ORACLE (Active Liquidity Probing)

### 🧐 HIỆN TRẠNG (Current State)
*   **File:** `src/eidolon/sensors/ClawOracle.ts`
*   **Logic:**
    *   Hàm `sense()` đang trả về hardcoded `'DEEP'` cho `liquidityDepth`.
    *   Hàm `getBNBPrice()` chỉ check giá cho 1 WBNB.
    *   Code hiện tại là "Mù" (Blind). Nó giả định thanh khoản luôn tốt.
*   **Đánh giá:** 🛑 **FAKE SIGNAL**. Hệ thống đang nói dối về thanh khoản.
*   **Xác nhận Plan:** ✅ **CHÍNH XÁC**. Việc triển khai Active Probing là bắt buộc để phát hiện trượt giá (slippage) và "Whale Dumping" trước khi trade.
*   **Ghi chú kỹ thuật:** Cần lưu ý giới hạn RPC (Rate Limits) khi gọi view call liên tục. Nên sử dụng `Multicall` nếu có thể.

## 2. ⚡ HYPER-ROUTING (Parallel Execution)

### 🧐 HIỆN TRẠNG (Current State)
*   **File:** `src/defi.ts`
*   **Logic:**
    *   Hàm `getRealQuote` sử dụng vòng lặp `for...of` để duyệt qua mảng `feeTiers`.
    *   Nó dừng lại ngay khi tìm thấy pool hợp lệ đầu tiên (`break` logic).
    *   Ví dụ: Nếu pool 0.25% tồn tại nhưng giá tệ, nó vẫn chọn pool đó mà không check pool 0.05% hay 1%.
*   **Đánh giá:** 🐢 **SERIAL & SUBOPTIMAL**. Hệ thống chọn "lối đi đầu tiên", không phải "lối đi tốt nhất". Tốc độ chậm do chờ từng promise tuần tự.
*   **Xác nhận Plan:** ✅ **CHÍNH XÁC**. Chuyển sang `Promise.all` (Parallel) và chọn `bestQuote` thay vì `firstQuote` là nâng cấp thay đổi cuộc chơi về P&L.

## 3. 🧠 CAPITAL-AGNOSTIC BRAIN (Relative Rewards)

### 🧐 HIỆN TRẠNG (Current State)
*   **File:** `src/eidolon/EmotionalCore.ts`
*   **Logic:**
    *   Hàm `stimulate(value, type)` nhận giá trị tuyệt đối.
    *   `dopamine += value * 2`.
    *   Lãi $10 với vốn $100 (tốt) được coi như lãi $10 với vốn $1M (tệ).
*   **Đánh giá:** 📉 **BIAS SCALE**. Agent sẽ bị "nghiện" đánh volume lớn để lấy reward cao, bỏ qua hiệu quả sử dụng vốn (Capital Efficiency).
*   **Xác nhận Plan:** ✅ **CHÍNH XÁC**. Cần chuyển sang công thức Sharpe/ROI: `Reward = (Realized PnL / Capital)`. Điều này giúp Agent thông minh hơn ở mọi quy mô vốn.

## 4. 🔗 ATOMIC CONFIG (Zero-Trust)

### 🧐 HIỆN TRẠNG (Current State)
*   **File:** `src/defi.ts`
*   **Logic:**
    *   Kiểm tra config hời hợt: `if (!chainConfig) default to opBNB`.
    *   Sử dụng hàm helper `toAddress` để ép kiểu string thành address, có thể che giấu lỗi format.
*   **Đánh giá:** ⚠️ **LOOSE**. Nếu file config chứa address sai checksum (ví dụ `0xabcd...`), lỗi sẽ chỉ nổ ra khi gửi transaction (Runtime Error fatal).
*   **Xác nhận Plan:** ✅ **CHÍNH XÁC**. Validate ngay khi khởi động (Boot time) để Fail Fast.

---

## 🚀 KẾT LUẬN & ĐỀ XUẤT (SYNTHESIS)

Kế hoạch nâng cấp hoàn toàn phù hợp với thực tế codebase. Code hiện tại đang ở mức "Prototype" (Mô hình thử nghiệm), chưa phải "Production-Ready".

### ĐIỀU CHỈNH NHỎ (ADJUSTMENTS):
1.  **RPC Multicall:** Khi thực hiện *Omniscient Oracle* và *Hyper-Routing*, nên gom các call vào Multicall contract để giảm tải RPC request số lượng lớn.
2.  **Slippage Dynamic:** Kết hợp Liquidity Probing để tự động điều chỉnh Slippage tolerance (Depth mỏng -> Slippage cao hoặc Cancel trade).

**SẴN SÀNG TRIỂN KHAI.**
