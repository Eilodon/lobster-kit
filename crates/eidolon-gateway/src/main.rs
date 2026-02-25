#[tokio::main]
async fn main() {
    if let Err(err) = eidolon_gateway::run_from_env().await {
        eprintln!("[eidolon-gateway] fatal: {}", err);
        std::process::exit(1);
    }
}
