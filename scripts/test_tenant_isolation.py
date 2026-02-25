#!/usr/bin/env python3
import subprocess
import json
import time
import sys
import tempfile
import os
import threading

def read_output(process, responses):
    for line in iter(process.stdout.readline, ''):
        line = line.strip()
        if not line:
            continue
        try:
            resp = json.loads(line)
            if "id" in resp:
                responses[resp["id"]] = resp
        except json.JSONDecodeError:
            pass

def main():
    test_dir = tempfile.mkdtemp()
    os.environ["EIDOLON_USERS_PATH"] = os.path.join(test_dir, "users.json")
    os.environ["EIDOLON_DB_PATH"] = os.path.join(test_dir, "telemetry.db")
    
    print(f"Starting MCP server with temporary directory: {test_dir}")
    
    server_bin = "./target/debug/mcp-server"
    
    # Start the server process
    process = subprocess.Popen(
        [server_bin],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    
    responses = {}
    
    # Start a thread to read stdout asynchronously
    thread = threading.Thread(target=read_output, args=(process, responses))
    thread.daemon = True
    thread.start()
    
    def send_request(req_id, method, args):
        req = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {
                "name": method,
                "arguments": args
            }
        }
        process.stdin.write(json.dumps(req) + "\n")
        process.stdin.flush()
    
    # Wait a bit for server to boot up
    time.sleep(5)
    
    # Send commits
    send_request(1, "eidolon_commit_pattern", {"tenant_id": "tenant_A", "pattern": "Critical vulnerability found in core"})
    send_request(2, "eidolon_commit_pattern", {"tenant_id": "tenant_B", "pattern": "Safe deployment of frontend"})
    
    # Wait for commits
    start_time = time.time()
    while (1 not in responses or 2 not in responses) and (time.time() - start_time) < 10:
        time.sleep(0.5)
        
    print(f"Commit A: {responses.get(1)}")
    print(f"Commit B: {responses.get(2)}")
    
    # Send queries
    send_request(3, "eidolon_memory_query", {"tenant_id": "tenant_A", "query": "vulnerability"})
    send_request(4, "eidolon_memory_query", {"tenant_id": "tenant_A", "query": "deployment"})
    send_request(5, "eidolon_memory_query", {"tenant_id": "tenant_B", "query": "vulnerability"})
    
    # Wait for responses
    timeout = 10
    start_time = time.time()
    while len(responses) < 5 and (time.time() - start_time) < timeout:
        time.sleep(0.5)
        
    process.terminate()
    process.wait()
    
    def check_result(req_id, should_find_matches, search_string):
        resp = responses.get(req_id)
        if not resp:
            print(f"❌ Missing response for request ID {req_id}")
            return False
        
        try:
            content_text = resp["result"]["content"][0]["text"]
            data = json.loads(content_text)
            results = data.get("results", [])
            
            found_string = any(search_string in item.get("content", "") for item in results)
            
            if should_find_matches:
                return found_string
            else:
                return not found_string
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as e:
            print(f"❌ Malformed response for ID {req_id}: {resp}")
            return False

    success = True
    
    print("Checking Match Isolation:")
    if check_result(3, True, "vulnerability"):
        print("✅ Tenant A can see its own memory.")
    else:
        print("❌ Tenant A CANNOT see its own memory!")
        print(f"Response: {responses.get(3)}")
        success = False
        
    if check_result(4, False, "deployment"):
        print("✅ Tenant A cannot see Tenant B's memory.")
    else:
        print("❌ CROSS-TENANT LEAK: Tenant A CAN see Tenant B's memory!")
        print(f"Response: {responses.get(4)}")
        success = False
        
    if check_result(5, False, "vulnerability"):
        print("✅ Tenant B cannot see Tenant A's memory.")
    else:
        print("❌ CROSS-TENANT LEAK: Tenant B CAN see Tenant A's memory!")
        print(f"Response: {responses.get(5)}")
        success = False

    # Cleanup temp dir
    import shutil
    shutil.rmtree(test_dir)
    
    if not success:
        sys.exit(1)
        
if __name__ == "__main__":
    main()
