#!/bin/bash

# Security Testing Script for Horkos Explorer
# Tests query validation, rate limiting, and session storage security features

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SERVER_URL="${SERVER_URL:-http://localhost:8080}"
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_test() {
    echo -e "${YELLOW}TEST:${NC} $1"
}

print_pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    ((TESTS_PASSED++))
}

print_fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    ((TESTS_FAILED++))
}

print_info() {
    echo -e "${BLUE}INFO:${NC} $1"
}

# Check if server is running
check_server() {
    print_header "Checking Server Status"

    if curl -s -f "$SERVER_URL/api/mode" > /dev/null 2>&1; then
        print_pass "Server is running at $SERVER_URL"

        mode=$(curl -s "$SERVER_URL/api/mode" | jq -r '.mode')
        if [ "$mode" = "READ_ONLY" ]; then
            print_pass "Server is in READ_ONLY mode"
        else
            print_fail "Server is NOT in READ_ONLY mode (found: $mode)"
        fi
    else
        print_fail "Server is not responding at $SERVER_URL"
        echo -e "\nPlease start the server with:"
        echo -e "  npm run serve\n"
        exit 1
    fi
}

# Test Query Validation
test_query_validation() {
    print_header "Testing Query Validation"

    # Test 1: Block CREATE statement
    print_test "Block CREATE statement"
    response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -d '{"query": "CREATE (n:Test {name: \"malicious\"}) RETURN n"}')

    if echo "$response" | jq -e '.code == "QUERY_VALIDATION_FAILED"' > /dev/null 2>&1; then
        print_pass "CREATE statement blocked"
    else
        print_fail "CREATE statement was not blocked"
        echo "Response: $response"
    fi

    # Test 2: Block DROP statement
    print_test "Block DROP statement"
    response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -d '{"query": "DROP TABLE users"}')

    if echo "$response" | jq -e '.code == "QUERY_VALIDATION_FAILED"' > /dev/null 2>&1; then
        print_pass "DROP statement blocked"
    else
        print_fail "DROP statement was not blocked"
    fi

    # Test 3: Block DELETE statement
    print_test "Block DELETE statement"
    response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -d '{"query": "MATCH (n) DELETE n"}')

    if echo "$response" | jq -e '.code == "QUERY_VALIDATION_FAILED"' > /dev/null 2>&1; then
        print_pass "DELETE statement blocked"
    else
        print_fail "DELETE statement was not blocked"
    fi

    # Test 4: Block multi-statement with malicious query
    print_test "Block multi-statement query with DROP"
    response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -d '{"query": "MATCH (n) RETURN n LIMIT 1; DROP TABLE users;"}')

    if echo "$response" | jq -e '.code == "QUERY_VALIDATION_FAILED" and (.error | contains("Statement 2"))' > /dev/null 2>&1; then
        print_pass "Multi-statement query blocked (detected at statement 2)"
    else
        print_fail "Multi-statement query was not properly blocked"
    fi

    # Test 5: Block comment bypass attempts
    print_test "Block comment bypass with /* */"
    response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -d '{"query": "/* comment */ CREATE (n:Test) RETURN n"}')

    if echo "$response" | jq -e '.code == "QUERY_VALIDATION_FAILED"' > /dev/null 2>&1; then
        print_pass "Block comment bypass prevented"
    else
        print_fail "Block comment bypass was not prevented"
    fi

    # Test 6: Allow legitimate MATCH queries
    print_test "Allow legitimate MATCH query"
    response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -d '{"query": "MATCH (n:Person) RETURN n.name LIMIT 1"}')

    if echo "$response" | jq -e '.rows' > /dev/null 2>&1; then
        print_pass "Legitimate MATCH query allowed"
    else
        print_fail "Legitimate MATCH query was blocked"
        echo "Response: $response"
    fi

    # --- TASK-101: LOAD FROM / allowlist ---
    # Regression tests for the parse-tree allowlist QueryValidator. These assert
    # that Kuzu LOAD FROM (arbitrary local-file / URL read), database-management
    # statements, and standalone CALL are BLOCKED, while legitimate read queries
    # (UNWIND / UNION / ORDER BY ... SKIP ... LIMIT, etc.) are still ALLOWED.
    # BLOCKED = validator returns code QUERY_VALIDATION_FAILED (query not executed).
    # ALLOWED = query executes and the response contains rows.

    # Helper: assert a query is BLOCKED by the validator.
    assert_blocked() {
        local label="$1"
        local query="$2"
        print_test "Block $label"
        local response
        response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg q "$query" '{query: $q}')")
        if echo "$response" | jq -e '.code == "QUERY_VALIDATION_FAILED"' > /dev/null 2>&1; then
            print_pass "$label blocked"
        else
            print_fail "$label was NOT blocked"
            echo "Response: $response"
        fi
    }

    # Helper: assert a query is ALLOWED (executes, returns rows).
    assert_allowed() {
        local label="$1"
        local query="$2"
        print_test "Allow $label"
        local response
        response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg q "$query" '{query: $q}')")
        if echo "$response" | jq -e '.rows' > /dev/null 2>&1; then
            print_pass "$label allowed"
        else
            print_fail "$label was blocked or errored"
            echo "Response: $response"
        fi
    }

    # BLOCKED: LOAD FROM local-file read (the proven exploit) in all forms.
    assert_blocked "LOAD FROM (extension-inferred)" \
        "LOAD FROM '/etc/passwd' RETURN *"
    assert_blocked "LOAD FROM (forced csv format - proven exploit)" \
        "LOAD FROM '/etc/passwd' (file_format='csv', header=false, delim=':') RETURN * LIMIT 5"
    assert_blocked "LOAD FROM (URL / SSRF form)" \
        "LOAD FROM 'http://169.254.169.254/latest/meta-data/' RETURN *"
    assert_blocked "LOAD FROM smuggled behind block comment" \
        "/* MATCH */ LOAD FROM '/etc/passwd' RETURN *"

    # BLOCKED: database-management / DDL statements and standalone CALL.
    assert_blocked "ATTACH database" \
        "ATTACH '/etc/passwd' AS x (dbtype csv)"
    assert_blocked "INSTALL extension" \
        "INSTALL httpfs"
    assert_blocked "USE database" \
        "USE x"
    assert_blocked "standalone CALL" \
        "CALL show_tables() RETURN *"

    # BLOCKED: a benign MATCH followed by LOAD FROM must reject the whole batch.
    assert_blocked "multi-statement MATCH then LOAD FROM" \
        "MATCH (n) RETURN n LIMIT 1; LOAD FROM '/etc/passwd' RETURN *"

    # ALLOWED: legitimate read queries must still execute (no over-blocking).
    assert_allowed "count(n)" \
        "MATCH (n) RETURN count(n)"
    assert_allowed "OPTIONAL MATCH" \
        "OPTIONAL MATCH (n)-[r]->(m) RETURN n LIMIT 1"
    assert_allowed "WITH ... UNWIND ... RETURN" \
        "WITH [1,2,3] AS xs UNWIND xs AS x RETURN x"
    assert_allowed "UNION" \
        "MATCH (n) RETURN n LIMIT 1 UNION MATCH (m) RETURN m LIMIT 1"
    assert_allowed "ORDER BY ... SKIP ... LIMIT" \
        "MATCH (n) RETURN n ORDER BY n.id SKIP 1 LIMIT 5"
    # String literal containing 'LOAD FROM' must NOT be false-blocked.
    assert_allowed "string literal containing LOAD FROM" \
        "MATCH (n) WHERE n.name = 'LOAD FROM' RETURN n LIMIT 1"

    # Parse-DoS guard: a deeply nested-parenthesis payload (~1KB) must be
    # REJECTED QUICKLY by the O(n) nesting-depth guard, so the expensive ANTLR
    # parse never runs. Without the guard this ~1KB request pinned the Node
    # event loop for >30s (measured); with it, it is rejected in <50ms.
    print_test "Block + fast-reject deeply nested parse-DoS payload"
    DEPTH=500
    OPENS=$(printf '(%.0s' $(seq 1 $DEPTH))
    CLOSES=$(printf ')%.0s' $(seq 1 $DEPTH))
    DOS_QUERY="MATCH (n) RETURN ${OPENS}1${CLOSES}"
    dos_payload=$(jq -n --arg q "$DOS_QUERY" '{query: $q}')
    start_ms=$(date +%s%3N)
    dos_response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -d "$dos_payload")
    end_ms=$(date +%s%3N)
    elapsed_ms=$((end_ms - start_ms))
    if echo "$dos_response" | jq -e '.code == "QUERY_VALIDATION_FAILED"' > /dev/null 2>&1; then
        if [ "$elapsed_ms" -lt 1000 ]; then
            print_pass "Nested parse-DoS payload rejected quickly (${elapsed_ms}ms)"
        else
            # Rejected but slowly -> guard may not be firing before the parser.
            print_fail "Nested payload rejected but SLOW (${elapsed_ms}ms) - guard may run after parse"
        fi
    else
        print_fail "Nested parse-DoS payload was NOT rejected (${elapsed_ms}ms)"
        echo "Response: $dos_response"
    fi
    # --- end TASK-101 ---
}

# Test Rate Limiting
test_rate_limiting() {
    print_header "Testing Rate Limiting"

    print_test "Send rapid requests to trigger rate limit (30 req/min limit)"
    print_info "Sending requests..."

    local limit_hit=false
    local requests_sent=0

    for i in {1..35}; do
        response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -d '{"query": "MATCH (n:Person) RETURN count(n)"}')

        requests_sent=$i

        if echo "$response" | grep -q "RATE_LIMIT_EXCEEDED"; then
            limit_hit=true
            print_pass "Rate limit triggered after $requests_sent requests"
            break
        fi

        # Show progress every 10 requests
        if [ $((i % 10)) -eq 0 ]; then
            print_info "  $i requests sent..."
        fi
    done

    if [ "$limit_hit" = false ]; then
        print_fail "Rate limit was not triggered after $requests_sent requests"
    fi
}

# Test Session Storage
test_session_storage() {
    print_header "Testing Session Storage (should be disabled)"

    # Test 1: Check session history endpoint returns empty
    print_test "Session history endpoint returns empty"
    response=$(curl -s "$SERVER_URL/api/session/history")

    if [ "$response" = "[]" ] || [ "$response" = "{}" ]; then
        print_pass "Session history is empty/disabled"
    else
        print_fail "Session history returned unexpected data: $response"
    fi

    # Test 2: Check session settings endpoint returns empty
    print_test "Session settings endpoint returns empty"
    response=$(curl -s "$SERVER_URL/api/session/settings")

    if [ "$response" = "{}" ] || [ "$response" = "[]" ]; then
        print_pass "Session settings is empty/disabled"
    else
        print_fail "Session settings returned unexpected data: $response"
    fi

    # Test 3: Verify DISABLE_SESSION_DB message in logs
    print_test "Check for session disabled message in server logs"
    print_info "Note: This requires checking server startup logs manually"
    print_info "Expected: 'Server-side session storage is disabled (DISABLE_SESSION_DB=true)'"
}

# Test Access Mode
test_access_mode() {
    print_header "Testing Access Mode"

    print_test "Verify READ_ONLY mode is enforced"
    response=$(curl -s "$SERVER_URL/api/mode")
    mode=$(echo "$response" | jq -r '.mode')

    if [ "$mode" = "READ_ONLY" ]; then
        print_pass "Server is in READ_ONLY mode"
    else
        print_fail "Server is NOT in READ_ONLY mode (found: $mode)"
    fi
}

# Test GPT / query-generation endpoint is not exposed
test_gpt_endpoint_disabled() {
    print_header "Testing GPT Endpoint Exposure"

    # The text2cypher (/api/gpt) endpoint must not be mounted in READ_ONLY mode.
    # It has been removed from the build, so it should return 404 Not Found.
    print_test "POST /api/gpt returns 404 (endpoint not mounted)"
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SERVER_URL/api/gpt" \
        -H "Content-Type: application/json" \
        -d '{"question": "count everything", "token": "x"}')

    if [ "$status" = "404" ]; then
        print_pass "/api/gpt is not exposed (HTTP 404)"
    else
        print_fail "/api/gpt returned HTTP $status (expected 404)"
    fi
}

# Print summary
print_summary() {
    print_header "Test Summary"

    total=$((TESTS_PASSED + TESTS_FAILED))

    echo -e "${GREEN}Passed:${NC} $TESTS_PASSED/$total"
    echo -e "${RED}Failed:${NC} $TESTS_FAILED/$total"

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "\n${GREEN}All tests passed! ✓${NC}\n"
        exit 0
    else
        echo -e "\n${RED}Some tests failed! ✗${NC}\n"
        exit 1
    fi
}

# --- TASK-102: trust proxy / XFF spoofing ---
# Regression test for X-Forwarded-For (XFF) spoofing bypassing rate limits.
#
# This test assumes the server is started with the DEFAULT trust-proxy setting
# (TRUST_PROXY=1, i.e. Express trusts exactly one reverse-proxy hop). In that
# configuration this test harness IS the single trusted hop: whatever XFF value
# curl sends becomes the right-most entry Express reads as req.ip. To simulate a
# malicious client sitting BEHIND that trusted proxy we prepend a rotating fake
# client IP to XFF (e.g. "203.0.113.<i>, 10.0.0.1"). With trust proxy = 1 Express
# ignores the spoofed left-most entry and keys the rate limiter on the stable
# right-most value (10.0.0.1), so rotation must NOT grant unlimited requests --
# the limiter still trips (429). Without the fix (trust proxy = true, trusting
# the whole chain) Express would take the rotating left-most entry and keep
# returning 200.
#
# This test establishes its OWN fresh per-IP rate-limit bucket: because every
# request carries "X-Forwarded-For: <spoofed>, 10.0.0.1", with 1 trusted hop the
# limiter keys on the right-most 10.0.0.1 -- a DIFFERENT key from test_rate_limiting
# (which sends no XFF and keys on the socket IP 127.0.0.1). It therefore does NOT
# share or depend on any prior test's budget and must send enough requests to
# exceed the limit on the 10.0.0.1 key on its own. Do not shrink the loop below
# the effective limit or the test will never trip.
#
# The loop bound is derived from the server's own `RateLimit-Limit` response
# header (express-rate-limit sets standardHeaders: true) so the test is correct
# regardless of the ambient limit (dev default 500 vs prod/READ_ONLY default 30).
# For a deterministic, fast run, start the server with
# QUERY_RATE_LIMIT_MAX_REQUESTS=30. If the limit cannot be read, or is larger
# than MAX_XFF_PROBE, the test SKIPs with a warning rather than falsely failing.
test_xff_spoofing() {
    print_header "Testing X-Forwarded-For Spoofing Resistance"

    # Local skip helper (counts as neither pass nor fail) to avoid a false alarm
    # when the effective limit is unknown or impractically large for a probe.
    print_skip() { echo -e "${YELLOW}⚠ SKIP:${NC} $1"; }

    # Upper bound on how many requests we are willing to send to trip the limit.
    # A dev server defaults to 500 queries/min which is impractical to exhaust
    # here; such a run should be skipped and re-run with QUERY_RATE_LIMIT_MAX_REQUESTS=30.
    local MAX_XFF_PROBE=60

    print_test "Rotating spoofed X-Forwarded-For must NOT bypass the query rate limit"

    # Discover the effective query rate limit from the RateLimit-Limit header.
    # -D - dumps response headers to stdout; the body is discarded (-o /dev/null).
    local headers effective_limit
    headers=$(curl -s -o /dev/null -D - -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -H "X-Forwarded-For: 203.0.113.1, 10.0.0.1" \
        -d '{"query": "MATCH (n:Person) RETURN count(n)"}')
    # Header name is case-insensitive; value may be a plain number or a structured
    # "limit=N" form depending on express-rate-limit version -- grab the digits.
    effective_limit=$(echo "$headers" | grep -i '^RateLimit-Limit:' | grep -oE '[0-9]+' | head -1)

    if [ -z "$effective_limit" ]; then
        print_skip "Could not read RateLimit-Limit header; cannot bound the probe. Ensure the server is running with rate limiting enabled (standardHeaders)."
        unset -f print_skip
        return
    fi

    if [ "$effective_limit" -gt "$MAX_XFF_PROBE" ]; then
        print_skip "Effective query limit is $effective_limit (> probe cap $MAX_XFF_PROBE); this looks like a dev server (NODE_ENV=development => 500/min). Re-run with QUERY_RATE_LIMIT_MAX_REQUESTS=30 for a deterministic check."
        unset -f print_skip
        return
    fi

    # Send limit + a small margin so the limiter is guaranteed to trip on the
    # stable 10.0.0.1 key if (and only if) spoofing does NOT rotate req.ip.
    local probe_count=$((effective_limit + 5))
    print_info "Effective query limit is $effective_limit; sending $probe_count requests, each with a different fake client IP prepended to XFF..."

    local limit_hit=false
    local requests_sent=0

    for ((i=1; i<=probe_count; i++)); do
        # 203.0.113.0/24 is TEST-NET-3 (reserved for documentation) -> safe fakes.
        spoofed_ip="203.0.113.$((i % 250 + 1))"
        response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -H "X-Forwarded-For: ${spoofed_ip}, 10.0.0.1" \
            -d '{"query": "MATCH (n:Person) RETURN count(n)"}')

        requests_sent=$i

        if echo "$response" | grep -q "RATE_LIMIT_EXCEEDED"; then
            limit_hit=true
            print_pass "Rate limit still triggered after $requests_sent spoofed-XFF requests (limit=$effective_limit; spoofing did NOT grant unlimited access)"
            break
        fi

        if [ $((i % 10)) -eq 0 ]; then
            print_info "  $i spoofed requests sent..."
        fi
    done

    unset -f print_skip

    if [ "$limit_hit" = false ]; then
        print_fail "Rate limit was NOT triggered after $requests_sent rotating-XFF requests (limit=$effective_limit) -- trust proxy is too permissive (XFF spoofing bypasses rate limits)"
    fi
}
# --- end TASK-102 ---

# --- TASK-100: security headers ---
# Verifies the app emits application-layer security headers (helmet). These are
# defence-in-depth: they must be present even if the nginx proxy is bypassed or
# misconfigured. The CSP may be enforcing OR report-only, so we accept either
# Content-Security-Policy or Content-Security-Policy-Report-Only.
test_security_headers() {
    print_header "Testing Security Headers (helmet / defence-in-depth)"

    # Capture response headers from a normal GET. Use -sI-style header dump via
    # -D - so we read the exact header block; grep is case-insensitive (-i)
    # because header names are case-insensitive per HTTP.
    local headers
    headers=$(curl -s -D - -o /dev/null "$SERVER_URL/api/mode")

    # X-Content-Type-Options: nosniff (blocks MIME-sniffing)
    print_test "X-Content-Type-Options: nosniff present"
    if echo "$headers" | grep -iq "^X-Content-Type-Options:.*nosniff"; then
        print_pass "X-Content-Type-Options: nosniff present"
    else
        print_fail "X-Content-Type-Options: nosniff missing"
    fi

    # Clickjacking protection: accept X-Frame-Options OR CSP frame-ancestors
    print_test "Clickjacking protection (X-Frame-Options or CSP frame-ancestors)"
    if echo "$headers" | grep -iq "^X-Frame-Options:" || \
       echo "$headers" | grep -iq "frame-ancestors"; then
        print_pass "Clickjacking protection present"
    else
        print_fail "Clickjacking protection missing (no X-Frame-Options / frame-ancestors)"
    fi

    # Referrer-Policy present
    print_test "Referrer-Policy present"
    if echo "$headers" | grep -iq "^Referrer-Policy:"; then
        print_pass "Referrer-Policy present"
    else
        print_fail "Referrer-Policy missing"
    fi

    # Strict-Transport-Security present (browsers ignore over plain HTTP; fine)
    print_test "Strict-Transport-Security present"
    if echo "$headers" | grep -iq "^Strict-Transport-Security:"; then
        print_pass "Strict-Transport-Security present"
    else
        print_fail "Strict-Transport-Security missing"
    fi

    # CSP present in EITHER enforcing or report-only form
    print_test "Content-Security-Policy present (enforce or report-only)"
    if echo "$headers" | grep -iq "^Content-Security-Policy:" || \
       echo "$headers" | grep -iq "^Content-Security-Policy-Report-Only:"; then
        print_pass "Content-Security-Policy present"
    else
        print_fail "Content-Security-Policy missing (neither enforce nor report-only)"
    fi
}
# --- end TASK-100 ---

# --- TASK-105: resource guards (DoS) + datasets route robustness ---
# Confirmed live against the shipping READ_ONLY server during the TASK-105
# adversarial sweep. These lock in the guardrails that bound a single
# unauthenticated request's CPU/memory/response cost, plus the datasets
# /files route crash discovered by the sweep.
test_resource_guards() {
    print_header "Testing Resource Guards (DoS bounds — TASK-105)"

    # 1. Validator nesting-depth cap: a deeply-nested-paren query must be
    #    REJECTED by the O(n) depth check BEFORE the expensive ANTLR parse,
    #    so it returns fast (a bare ANTLR parse of depth 300+ freezes the
    #    event loop for tens of seconds). We assert both: rejected AND fast.
    print_test "Deeply-nested query rejected quickly (parser CPU-DoS cap)"
    local nested start end elapsed_ms body
    nested=$(printf 'RETURN %s1%s' "$(printf '(%.0s' $(seq 1 500))" "$(printf ')%.0s' $(seq 1 500))")
    start=$(date +%s%3N)
    body=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        --data-binary "$(jq -nc --arg q "$nested" '{query:$q}')")
    end=$(date +%s%3N)
    elapsed_ms=$((end - start))
    if echo "$body" | grep -q "QUERY_VALIDATION_FAILED" && [ "$elapsed_ms" -lt 1000 ]; then
        print_pass "Depth-500 query rejected in ${elapsed_ms}ms (< 1000ms cap holds)"
    else
        print_fail "Depth-500 query not cheaply rejected (${elapsed_ms}ms): $(echo "$body" | head -c 120)"
    fi

    # 2. Result-size cap: a broad cartesian must be truncated at
    #    KUZU_QUERY_SIZE_LIMIT rows (default 10000), not stream the whole graph.
    print_test "Broad result set capped at row limit (no whole-graph exfiltration)"
    local rows
    rows=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        --data-binary '{"query":"MATCH (a),(b) RETURN a.id, b.id"}' | jq -r '.rows | length' 2>/dev/null)
    if [ -n "$rows" ] && [ "$rows" != "null" ] && [ "$rows" -le 10000 ]; then
        print_pass "Result capped at ${rows} rows (<= 10000)"
    else
        print_fail "Result-size cap not enforced (rows=$rows)"
    fi

    # 3. JSON body-size limit: a body over JSON_BODY_LIMIT (default 1mb) must
    #    be rejected with 413 before the handler runs.
    print_test "Oversized JSON body rejected (413)"
    local bigcode
    bigcode=$(jq -nc --arg q "MATCH (n) RETURN n //$(printf 'A%.0s' $(seq 1 1200000))" '{query:$q}' \
        | curl -s -o /dev/null -w "%{http_code}" -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" --data-binary @-)
    if [ "$bigcode" = "413" ]; then
        print_pass "Oversized body rejected with HTTP 413"
    else
        print_fail "Oversized body not rejected (got HTTP $bigcode, expected 413)"
    fi
}

# Datasets /files/:file must not crash the process when the datasets directory
# is absent (e.g. a SKIP_DATASETS=true slim image build). The sweep found that
# an unguarded `await fs.readdir` on a KNOWN dataset name with a missing dir
# throws an unhandled rejection that terminates the whole server (unauth DoS).
# NOTE: run this LAST — on an unpatched server it kills the process, so any
# test after it would spuriously fail against a dead server.
test_datasets_route_robustness() {
    print_header "Testing Datasets Route Robustness (unauth crash — TASK-105)"

    local known probe_code alive_code
    known=$(curl -s "$SERVER_URL/api/datasets" | jq -r '.[0] // empty' 2>/dev/null)
    if [ -z "$known" ]; then
        print_info "No datasets advertised (datasets feature absent) — skipping crash probe"
        return
    fi

    print_test "GET /api/datasets/<known>/files/x does not crash the server"
    # Fire the probe at a known dataset name; a missing datasets dir on disk is
    # what triggers the unguarded readdir. Then confirm the server is STILL up.
    probe_code=$(curl -s -o /dev/null -w "%{http_code}" \
        "$SERVER_URL/api/datasets/$(jq -rn --arg s "$known" '$s|@uri')/files/probe")
    sleep 1
    alive_code=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/api/mode")
    if [ "$alive_code" = "200" ]; then
        print_pass "Server survived the datasets /files probe (route returned $probe_code, /api/mode still 200)"
    else
        print_fail "Server CRASHED after datasets /files probe (/api/mode now $alive_code) — unguarded readdir DoS"
    fi
}
# --- end TASK-105 ---

# Main execution
main() {
    echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║   Horkos Explorer Security Test Suite     ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"

    # Check dependencies
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required but not installed.${NC}"
        echo "Install it with: sudo apt install jq"
        exit 1
    fi

    check_server
    test_access_mode
    test_gpt_endpoint_disabled
    test_query_validation
    test_rate_limiting
    test_xff_spoofing  # TASK-102: uses its own fresh per-IP bucket (right-most XFF 10.0.0.1); independent of test_rate_limiting's budget
    test_security_headers  # TASK-100: security-headers presence check
    test_session_storage
    test_resource_guards  # TASK-105: nesting-depth DoS cap, result-size cap, body-size 413
    # MUST be last: on an unpatched server the datasets /files probe crashes the
    # process, so any test after it would fail against a dead server.
    test_datasets_route_robustness  # TASK-105: unauthenticated datasets /files readdir crash
    print_summary
}

# Run main function
main "$@"
