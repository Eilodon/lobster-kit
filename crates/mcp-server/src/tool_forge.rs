use crate::EidolonMcpServer;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use wasmtime::{Config, Engine, Module, Store};

#[derive(Clone)]
pub struct WasmTool {
    pub name: String,
    pub description: String,
    pub wasm_bytes: Vec<u8>,
}

impl EidolonMcpServer {
    pub(crate) async fn handle_forge_tool(&self, params: serde_json::Value) -> serde_json::Value {
        let tool_name = params["name"].as_str().unwrap_or("unknown_tool").to_string();
        let description = params["description"].as_str().unwrap_or("Dynamic tool").to_string();
        let code = params["code"].as_str().unwrap_or("");

        if tool_name.is_empty() || code.is_empty() {
            return serde_json::json!({
                "error": "Tool name and code are required."
            });
        }

        let forge_id = chrono::Utc::now().timestamp_millis().to_string();
        let tmp_dir = PathBuf::from(format!("/tmp/eidolon_forge_{}", forge_id));

        if let Err(e) = fs::create_dir_all(&tmp_dir) {
            return serde_json::json!({ "error": format!("Failed to create forge dir: {}", e) });
        }

        let cargo_toml = format!(r#"
[package]
name = "{}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
"#, tool_name);

        let src_dir = tmp_dir.join("src");
        let _ = fs::create_dir_all(&src_dir);
        let _ = fs::write(tmp_dir.join("Cargo.toml"), cargo_toml);
        let _ = fs::write(src_dir.join("lib.rs"), code);

        // Compile
        let output = tokio::task::spawn_blocking(move || {
            Command::new("cargo")
                .arg("build")
                .arg("--target")
                .arg("wasm32-unknown-unknown")
                .arg("--release")
                .current_dir(&tmp_dir)
                .output()
        }).await.unwrap();

        match output {
            Ok(out) => {
                if !out.status.success() {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    return serde_json::json!({
                        "error": "Compilation failed",
                        "stderr": stderr
                    });
                }
                
                // Read WASM
                let wasm_path = PathBuf::from(format!("/tmp/eidolon_forge_{}/target/wasm32-unknown-unknown/release/{}.wasm", forge_id, tool_name.replace('-', "_")));
                if let Ok(wasm_bytes) = fs::read(&wasm_path) {
                    
                    // Validate it can load in Wasmtime
                    let mut config = Config::new();
                    config.wasm_component_model(false);
                    let engine = Default::default();
                    match Module::new(&engine, &wasm_bytes) {
                        Ok(_) => {
                            let mut tools = self.dynamic_tools.lock().await;
                            tools.insert(tool_name.clone(), WasmTool {
                                name: tool_name.clone(),
                                description: description.clone(),
                                wasm_bytes,
                            });
                            
                            serde_json::json!({
                                "status": "success",
                                "tool_name": tool_name,
                                "message": "Tool forged and hot-loaded into registry."
                            })
                        }
                        Err(e) => {
                            serde_json::json!({
                                "error": "WASM validation failed",
                                "details": e.to_string()
                            })
                        }
                    }
                } else {
                    serde_json::json!({
                        "error": "WASM file not found after successful compilation."
                    })
                }
            }
            Err(e) => serde_json::json!({
                "error": format!("Compilation IO Error: {}", e)
            })
        }
    }
    
    // Fallback executor for dynamic tools. It expects the WASM module to export an `invoke` function 
    // that takes input via wasmtime simple call. 
    // For simplicity of this milestone, we expect `execute` to just return an integer 
    // (e.g., Fibonacci calculation).
    pub(crate) async fn execute_dynamic_tool(&self, tool_name: &str, params: serde_json::Value) -> serde_json::Value {
        let tools = self.dynamic_tools.lock().await;
        if let Some(tool) = tools.get(tool_name) {
            let wasm_bytes = tool.wasm_bytes.clone();
            drop(tools);
            
            let engine = Engine::default();
            let module = Module::new(&engine, &wasm_bytes).unwrap();
            let mut store = Store::new(&engine, ());
            let instance = wasmtime::Instance::new(&mut store, &module, &[]).unwrap();
            
            if let Ok(execute_func) = instance.get_typed_func::<u32, u32>(&mut store, "execute") {
                let input = params["input"].as_u64().unwrap_or(10) as u32;
                match execute_func.call(&mut store, input) {
                    Ok(res) => serde_json::json!({ "result": res }),
                    Err(e) => serde_json::json!({ "error": format!("Runtime error: {}", e) })
                }
            } else {
                serde_json::json!({ "error": "Tool must export an `execute(u32) -> u32` function." })
            }
        } else {
            serde_json::json!({ "error": "Tool not found" })
        }
    }
}
