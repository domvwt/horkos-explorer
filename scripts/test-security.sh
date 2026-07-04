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
    print_summary
}

# Run main function
main "$@"
