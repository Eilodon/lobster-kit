FROM rust:1.85-bookworm AS builder

WORKDIR /app
COPY packages/soul/core-rust ./packages/soul/core-rust
COPY packages/mcp-rust ./packages/mcp-rust

WORKDIR /app/packages/mcp-rust
RUN cargo build --release

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 eidolon
COPY --from=builder /app/packages/mcp-rust/target/release/mcp-rust /usr/local/bin/mcp-rust

USER eidolon
ENTRYPOINT ["/usr/local/bin/mcp-rust"]
