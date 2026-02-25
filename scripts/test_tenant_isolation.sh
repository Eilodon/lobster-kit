#!/usr/bin/env bash
set -e
SERVER_BIN="./target/debug/mcp-server"
TEST_DIR=$(mktemp -d)
export EIDOLON_USERS_PATH="$TEST_DIR/users.json"
export EIDOLON_DB_PATH="$TEST_DIR/telemetry.db"
request_a='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"eidolon_commit_pattern","arguments":{"tenant_id":"tenant_A","pattern":"Critical vulnerability found in core"}}}'
request_b='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"eidolon_commit_pattern","arguments":{"tenant_id":"tenant_B","pattern":"Safe deployment of frontend"}}}'
query_a_finds_a='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"eidolon_memory_query","arguments":{"tenant_id":"tenant_A","query":"vulnerability"}}}'
query_a_finds_b='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"eidolon_memory_query","arguments":{"tenant_id":"tenant_A","query":"deployment"}}}'
query_b_finds_a='{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"eidolon_memory_query","arguments":{"tenant_id":"tenant_B","query":"vulnerability"}}}'

{
  echo "$request_a"
  sleep 0.5
  echo "$request_b"
  sleep 0.5
  echo "$query_a_finds_a"
  sleep 0.5
  echo "$query_a_finds_b"
  sleep 0.5
  echo "$query_b_finds_a"
  sleep 2
} | $SERVER_BIN > "$TEST_DIR/output.log" 2> "$TEST_DIR/error.log"

cat "$TEST_DIR/error.log"
cat "$TEST_DIR/output.log"
rm -rf "$TEST_DIR"
