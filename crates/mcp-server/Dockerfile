FROM rust:1.85-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/trading-domain ./crates/trading-domain
COPY crates/core-rust ./crates/core-rust
COPY crates/mcp-server ./crates/mcp-server

WORKDIR /app/crates/mcp-server
RUN cargo build --release

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 eidolon
COPY --from=builder /app/crates/mcp-server/target/release/mcp-server /usr/local/bin/mcp-server

USER eidolon
ENTRYPOINT ["/usr/local/bin/mcp-server"]
