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
    test_session_storage
    print_summary
}

# Run main function
main "$@"
