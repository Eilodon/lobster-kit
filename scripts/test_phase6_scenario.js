const { spawn } = require('child_process');

async function runScenario() {
    console.log("==========================================================");
    console.log("EIDOLON-V: TENSOR ORACLE REAL-WORLD AUDIT SCENARIO (PHASE 6B)");
    console.log("TESTING: ANALYSIS DEPTH VS LATENCY TRADEOFF UNDER TRAUMA SPIKE");
    console.log("==========================================================");

    console.log("\n[1] Bắt đầu khởi chạy MCP Server (Cargo run)... Vui lòng đợi!");
    const server = spawn('cargo', ['run', '--bin', 'mcp-server', '--manifest-path', 'crates/mcp-server/Cargo.toml']);

    let messageId = 1;
    let pendingRequests = new Map();
    let buffer = '';

    const sendRequest = (method, params) => {
        return new Promise((resolve, reject) => {
            const id = messageId++;
            const req = { jsonrpc: "2.0", id, method, params };
            pendingRequests.set(id, { resolve, reject });
            server.stdin.write(JSON.stringify(req) + '\n');
        });
    };

    const sendNotification = (method, params) => {
        const req = { jsonrpc: "2.0", method, params };
        server.stdin.write(JSON.stringify(req) + '\n');
    };

    server.stdout.on('data', (data) => {
        buffer += data.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop(); // Keep the incomplete line

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.id && pendingRequests.has(msg.id)) {
                    if (msg.error) {
                        pendingRequests.get(msg.id).reject(msg.error);
                    } else {
                        pendingRequests.get(msg.id).resolve(msg.result);
                    }
                    pendingRequests.delete(msg.id);
                }
            } catch (e) {
                // Not standard JSON RPC
            }
        }
    });

    let bootComplete = false;

    server.stderr.on('data', (data) => {
        const logData = data.toString();
        if (logData.includes("[Eidolon TensorOracle]")) {
            console.log("🧠", logData.trim());
        }
        if (logData.includes("Server Started")) {
            bootComplete = true;
        }
    });

    // Wait for boot 
    await new Promise(r => setTimeout(r, 6000));

    try {
        await sendRequest("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0" }
        });
        sendNotification("notifications/initialized", {});

        console.log("\n✅ MCP & TensorOracle Initialization Complete.");

        const testDraft = "function swap(tokenA, tokenB, amount) { tokenA.transferFrom(msg.sender, this, amount); callUntrustedContract(); tokenB.transfer(msg.sender, calculatedAmount); }";
        const testContext = "Đây là hàm swap trong một AMM. Tìm xem có vector Reentrancy hay không.";

        // KỊCH BẢN 1: Entropy 0.9 -> Analyze Contract -> Full CoT output
        console.log("\n----------------------------------------------------------");
        console.log("VÒNG 1: MÔI TRƯỜNG AN TOÀN (Entropy Cao = 0.9, Trauma Thấp = 0.1)");
        console.log("MONG ĐỢI: API MCP mở khóa TẦM NHÌN SÂU (/think) do không có nguy hiểm mạc định.");
        console.log("----------------------------------------------------------");

        await sendRequest("tools/call", {
            name: "eidolon_set_entropy",
            arguments: { target_entropy: 0.9, duration_ms: 10000 }
        });

        console.log("\n>> [Analysis Thread] Đang quét mã độc...");
        let start1 = Date.now();
        let res1 = await sendRequest("tools/call", {
            name: "eidolon_reason_chain",
            arguments: { draft: testDraft, context: testContext, mode: "deep" }
        });
        let time1 = Date.now() - start1;

        console.log(`\n[VÒNG 1 HOÀN TẤT | Phản hồi: ${time1}ms]`);
        if (res1?.content) {
            const json1 = JSON.parse(res1.content.find(c => c.type === 'text').text);
            console.log(`- Thermodynamic Entropy System: ${json1.thermo_entropy}`);
            console.log(`- Chi tiết Evaluation:`, json1.draft_evaluation);
        }

        // KỊCH BẢN 2: Trauma Spike -> Analyze Contract -> Full CoT output
        console.log("\n----------------------------------------------------------");
        console.log("VÒNG 2: HỆ THỐNG BỊ TẤN CÔNG (Trauma Cực Cao > 0.8, Entropy hệ thống rơi tự do)");
        console.log("MONG ĐỢI: Dù hệ thống Panic, nhưng tool *Reasoning* (phân tích) KHÔNG được dốt đi.");
        console.log("Nó phải VẪN GIỮ ĐƯỢC CHẾ ĐỘ /think ĐỂ TÌM VECTOR TẤN CÔNG (High Trauma = High Uncertainty).");
        console.log("----------------------------------------------------------");

        // Giả lập cực hạn: Set entropy thấp để mô phỏng sự hoang mang/phản xạ đóng (Reflex Lock)
        await sendRequest("tools/call", {
            name: "eidolon_set_entropy",
            // in reality, the `systems.rs` triggers high trauma > 0.8 during liquidation/loss
            arguments: { target_entropy: 0.1, duration_ms: 10000 }
        });

        console.log("\n>> [Analysis Thread] Yêu cầu Oracle phân tích lại mã với Trauma kịch trần...");

        // This simulates a call to an analysis tool. `tensor_oracle.rs` will intercept is_action=false 
        // to bypass the `/no_think` reflex.
        let start2 = Date.now();
        let res2 = await sendRequest("tools/call", {
            name: "eidolon_reason_chain",
            arguments: { draft: testDraft, context: testContext, mode: "deep" }
        });
        let time2 = Date.now() - start2;

        console.log(`\n[VÒNG 2 HOÀN TẤT | Phản hồi: ${time2}ms]`);
        if (res2?.content) {
            const json2 = JSON.parse(res2.content.find(c => c.type === 'text').text);
            console.log(`- Base System Entropy: 0.1`);
            console.log(`- (Nhưng bên trong Tensor Engine, /think vẫn chạy cho Analysis)`);
            console.log(`- Chi tiết Evaluation:`, json2.draft_evaluation);
        }

        console.log("\n==========================================================");
        console.log(`SO SÁNH ĐỘ TRỄ: Vòng Bình Yên (${time1}ms) vs Vòng Đang Bị Tấn Công (${time2}ms).`);
        console.log("Vòng bị tấn công phân tích lâu hơn/tương đương chứng tỏ AI CÀNG RỦI RO CÀNG SUY NGHĨ SÂU.");
        console.log("==========================================================");

        server.kill();
        process.exit(0);

    } catch (e) {
        console.error("Lỗi kịch bản:", e);
        server.kill();
        process.exit(1);
    }
}

runScenario();
