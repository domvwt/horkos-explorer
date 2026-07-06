#!/bin/bash

# Security Testing Script for Horkos Explorer
# Tests query validation, rate limiting, session storage, and DoS-bound guards.
#
# ── HOW TO RUN (single invocation, greens every section) ─────────────────────
#
# 1. Start the API server. Both entry points now mount the full app-level
#    security stack via the shared middleware/AppSecurity.js, so the header and
#    XFF sections pass against EITHER:
#      - helmet security headers   (test_security_headers)
#      - trust-proxy / right-most XFF resolution  (per-section rate-limit keys,
#        test_xff_spoofing, and the per-IP row budget ALL depend on this)
#    the production server (node src/server/index.js) AND the webpack dev server
#    (Configure.js, via `npm run serve`) both apply helmet, trust-proxy and
#    X-Robots-Tag identically. The PRODUCTION server is still RECOMMENDED for a
#    single clean invocation, because `npm run serve` sets NODE_ENV=development,
#    which relaxes the default rate limits and row budget (you would then have to
#    pass the explicit env values below to make the sections assert correctly).
#    The production server's default unmatched-/api 404 is text/html, so the
#    /api/session/* JSON-404 handler (added under DISABLE_SESSION_DB=true) is what
#    keeps that section green here too. Start the production server with:
#
#      MODE=READ_ONLY \
#      DISABLE_SESSION_DB=true \
#      QUERY_RATE_LIMIT_MAX_REQUESTS=30 \
#      QUERY_ROW_BUDGET=50 \
#      PORT=8080 \
#      KUZU_DIR=/path/to/dir KUZU_FILE=<dev graph>.kuzu \
#      node src/server/index.js
#
#    (Do NOT set NODE_ENV=development: it relaxes the default rate limits and
#     the default row budget. The explicit env values above are what the
#     sections below assert against.)
#
# 2. Once it is listening on http://localhost:8080, run:  npm run test-security
#
# Why these env values (one invocation is enough — no second profile needed):
#   - QUERY_RATE_LIMIT_MAX_REQUESTS=30: test_rate_limiting must TRIP the query
#     rate limit within the 35 requests it sends, and test_xff_spoofing only
#     RUNS when the effective limit is <= 60 (otherwise it SKIPs). 30 satisfies
#     both, and the ~28 requests test_query_validation sends on its own isolated
#     key stay under it, leaving that section headroom.
#   - QUERY_ROW_BUDGET=50: chosen to straddle two needs on DIFFERENT keys.
#     test_query_validation's legitimate allowed queries ship ~16 rows total on
#     its key (203.0.113.20), so a budget of 50 lets them all through; meanwhile
#     test_row_budget ships 5 rows per paginated request on its own key
#     (198.51.100.7), so 50/5 = 10 full pages and request 11 trips the budget —
#     well within the 40 requests it sends — and the ROW_BUDGET 429 fires before
#     the rate limit. Keep the default 24h window so the budget does not reset
#     mid-run. (A budget of 5 would be too small: it would 429 the query-
#     validation section's own legitimate reads.)
#   - The dev graph needs a few thousand Person rows so pagination ships >0 rows.
#   - RESTART the server before re-running the suite: limiter and row-budget
#     state is in-process and the budget window is 24h, so leftover per-key
#     debits (e.g. the 10000-row cartesian in test_resource_guards) turn a
#     repeat run against the same process red.
#
# Cross-section isolation: every section that ships rows or trips a limiter sends
# its OWN X-Forwarded-For. With trust-proxy=1 (production default) Express uses
# the right-most XFF entry as req.ip => the per-IP rate-limit / row-budget key.
# Distinct keys mean one section's request volume can never cascade-fail a later
# section with 429s. Keys in use:
#   test_query_validation -> 203.0.113.20     test_rate_limiting -> 203.0.113.30
#   test_row_budget       -> 198.51.100.7/.8  test_xff_spoofing  -> 10.0.0.1 (right-most)
#   test_resource_guards  -> 203.0.113.40

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
    # Not ((VAR++)): its exit status is 1 when the pre-increment value is 0,
    # which aborts the whole suite under `set -e` on the first passing test.
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

print_fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
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
        echo -e "\nPlease start the server (production node src/server/index.js recommended;"
        echo -e "both entry points now mount the app-level security stack) with the"
        echo -e "env recipe in the HOW TO RUN header of scripts/test-security.sh\n"
        exit 1
    fi
}

# Test Query Validation
test_query_validation() {
    print_header "Testing Query Validation"

    # Per-section rate-limit key. Every /api/cypher request in this section sends
    # this X-Forwarded-For so they all share ONE query-rate-limit bucket that no
    # other section touches. Without isolation, this section's ~30 requests plus
    # the rate-limit section's burst pile onto the same socket-IP bucket and
    # later sections cascade-fail with 429s. TEST-NET-3 (RFC 5737) is unroutable.
    local SECTION_XFF="203.0.113.20"

    # Test 1: Block CREATE statement
    print_test "Block CREATE statement"
    response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -H "X-Forwarded-For: ${SECTION_XFF}" \
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
        -H "X-Forwarded-For: ${SECTION_XFF}" \
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
        -H "X-Forwarded-For: ${SECTION_XFF}" \
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
        -H "X-Forwarded-For: ${SECTION_XFF}" \
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
        -H "X-Forwarded-For: ${SECTION_XFF}" \
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
        -H "X-Forwarded-For: ${SECTION_XFF}" \
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

    # Helper: assert a query is BLOCKED by the validator. Carries this section's
    # X-Forwarded-For so all validation requests share ONE rate-limit key that no
    # other section touches (see SECTION_XFF at the top of this function).
    assert_blocked() {
        local label="$1"
        local query="$2"
        print_test "Block $label"
        local response
        response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -H "X-Forwarded-For: ${SECTION_XFF}" \
            -d "$(jq -n --arg q "$query" '{query: $q}')")
        if echo "$response" | jq -e '.code == "QUERY_VALIDATION_FAILED"' > /dev/null 2>&1; then
            print_pass "$label blocked"
        else
            print_fail "$label was NOT blocked"
            echo "Response: $response"
        fi
    }

    # Helper: assert a query is ALLOWED (executes, returns rows). Carries this
    # section's X-Forwarded-For for the same rate-limit isolation as assert_blocked.
    assert_allowed() {
        local label="$1"
        local query="$2"
        print_test "Allow $label"
        local response
        response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -H "X-Forwarded-For: ${SECTION_XFF}" \
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

    # BLOCKED: trailing tokens after a valid read-only prefix. The Cypher
    # grammar's oC_Cypher rule accepts a valid PREFIX and stops; without the
    # validator's EOF assertion the trailing garbage would be silently dropped
    # by the validator while still reaching the engine.
    assert_blocked "trailing garbage after a valid RETURN prefix" \
        "MATCH (n) RETURN n GARBAGE TRAILING TOKENS"
    assert_blocked "trailing write clause after a valid RETURN prefix" \
        "MATCH (n) RETURN n CREATE (x)"

    # BLOCKED: comment cannot hide a real second statement from the splitter.
    assert_blocked "LOAD FROM after a comment-obscured semicolon" \
        "MATCH (n) RETURN n /*c*/; LOAD FROM '/etc/passwd' RETURN *"

    # ALLOWED: legitimate trailing/inline comments must not be over-blocked
    # (comments are stripped before validation, string-literal-safe).
    assert_allowed "legitimate trailing line comment" \
        "MATCH (n) RETURN n LIMIT 1 // just a note"
    assert_allowed "legitimate inline block comment between tokens" \
        "MATCH (n) /* mid */ RETURN n LIMIT 1"
    # A comment-like sequence INSIDE a string literal must be preserved, not
    # treated as a comment. The comment stripper (QueryValidator.stripComments)
    # is string-aware: it tracks quoted-string and backtick-identifier state, so
    # the '/*y*/' inside this string literal is NOT stripped and the query is
    # correctly ALLOWED. (This is the string-awareness that makes the assertion
    # pass; do NOT change the stripper's string handling without an adversarial
    # test pass — a lone apostrophe inside a backtick identifier once defeated
    # the paren-nesting DoS guard, so its scanners are security-sensitive.)
    #
    # We RETURN the literal directly (rather than filter on a node property) so
    # the query is schema-independent and executes on any graph, and so the
    # returned row PROVES the '/*y*/' bytes survived comment-stripping intact.
    assert_allowed "comment-like sequence inside a string literal" \
        "RETURN 'http://x/*y*/' AS url"

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
        -H "X-Forwarded-For: ${SECTION_XFF}" \
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

    # Per-section rate-limit key: this section deliberately trips the query rate
    # limit, so it must run on a bucket no other section has touched (otherwise
    # leftover requests from an earlier section would make it trip early — or
    # exhaust the bucket for a later section). TEST-NET-3 (RFC 5737), unroutable.
    local SECTION_XFF="203.0.113.30"

    for i in {1..35}; do
        response=$(curl -s -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -H "X-Forwarded-For: ${SECTION_XFF}" \
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

# Test the per-IP cumulative row budget (anti-bulk-scrape).
#
# The per-response size cap bounds ONE response and the query rate limit bounds
# request COUNT, but neither bounds how much of the corpus one IP can paginate
# out across requests. RowBudget.js debits the rows actually shipped per IP and
# rejects once the QUERY_ROW_BUDGET window is exhausted.
#
# REQUIRES the server to be started with a tiny QUERY_ROW_BUDGET — see the env
# notes in this script's header (the budget trips well inside the 30/min query
# rate limit, so no rate-limit relaxation is needed). Each request
# below carries a fixed X-Forwarded-For so it maps to one budget key; a DIFFERENT
# X-Forwarded-For is a different key with a fresh budget (proves per-IP scoping
# and that the trusted right-most XFF is the key, not spoofable left entries).
test_row_budget() {
    print_header "Testing Per-IP Row Budget (anti-bulk-scrape)"

    local scrape_ip="198.51.100.7"
    local fresh_ip="198.51.100.8"

    # 1. Paginate the same IP past the tiny budget; a 429 ROW_BUDGET_EXCEEDED
    #    must fire (and NOT a QUERY_RATE_LIMIT_EXCEEDED, if the rate limit was
    #    relaxed per the header notes).
    print_test "Paginating past QUERY_ROW_BUDGET returns 429 ROW_BUDGET_EXCEEDED"
    local budget_hit=false
    local reqs=0
    for i in {1..40}; do
        reqs=$i
        local skip=$(( (i - 1) * 5 ))
        local q="MATCH (n:Person) RETURN n.id ORDER BY n.id SKIP ${skip} LIMIT 5"
        local body code
        body=$(curl -s -w '\n%{http_code}' -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -H "X-Forwarded-For: ${scrape_ip}" \
            --data-binary "$(jq -nc --arg q "$q" '{query:$q}')")
        code=$(echo "$body" | tail -n1)
        body=$(echo "$body" | sed '$d')
        if echo "$body" | grep -q "ROW_BUDGET_EXCEEDED" && [ "$code" = "429" ]; then
            budget_hit=true
            print_pass "Row budget exhausted after $reqs paginated requests (429 ROW_BUDGET_EXCEEDED)"
            break
        fi
    done
    if [ "$budget_hit" = false ]; then
        print_fail "Row budget was not exhausted after $reqs paginated requests (is QUERY_ROW_BUDGET set small?)"
    fi

    # 2. A DIFFERENT IP key (fresh right-most XFF) still gets 200 — the budget is
    #    per-IP, and a client cannot reset the exhausted key by rotating a spoofed
    #    left-most XFF (the trusted right-most entry is the key). Note: if the
    #    exhausted key's window has since reset, that key would 200 too; using a
    #    fresh key makes the assertion window-independent.
    print_test "A different IP (fresh budget key) still returns 200"
    local fcode
    fcode=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SERVER_URL/api/cypher" \
        -H "Content-Type: application/json" \
        -H "X-Forwarded-For: ${fresh_ip}" \
        --data-binary '{"query":"MATCH (n:Person) RETURN n.id LIMIT 1"}')
    if [ "$fcode" = "200" ]; then
        print_pass "Fresh IP key -> 200 (budget is per-IP; spoofed left XFF cannot reset it)"
    else
        print_fail "Fresh IP key returned $fcode (expected 200)"
    fi
}

# Test Session Storage
test_session_storage() {
    print_header "Testing Session Storage (should be disabled)"

    # With DISABLE_SESSION_DB=true the /api/session/* routes are not backed by
    # the SQLite session store. The server mounts a stub that answers every
    # session request with a JSON 404 ({ "error": ... }) instead of letting the
    # request fall past the static handler to Express's default HTML 404 page
    # ("Cannot GET ..."). The frontend is localStorage-only in this mode and
    # already tolerates a failed session call (MainLayout.vue / ShellMainView.vue
    # catch and fall back), so a JSON 404 is safe. We assert the machine-readable
    # JSON 404 here and, critically, that the response is NOT HTML.

    # Helper: assert a session endpoint returns a JSON 404, not HTML.
    assert_session_json_404() {
        local label="$1"
        local method="$2"
        local path="$3"
        print_test "$label returns JSON 404 (not the HTML page)"
        local body code
        body=$(curl -s -w "\n%{http_code}" -X "$method" "$SERVER_URL$path")
        code=$(echo "$body" | tail -n1)
        body=$(echo "$body" | sed '$d')
        if [ "$code" != "404" ]; then
            print_fail "$label returned HTTP $code (expected 404). Body: $body"
            return
        fi
        # Must be a JSON object carrying an error key — a fallthrough would
        # return Express's HTML 404 page, which is not valid JSON.
        if echo "$body" | jq -e '.error' > /dev/null 2>&1; then
            print_pass "$label -> 404 with JSON error body (session disabled)"
        else
            print_fail "$label returned non-JSON body (HTML fallthrough?): $body"
        fi
    }

    assert_session_json_404 "Session history endpoint" "GET" "/api/session/history"
    assert_session_json_404 "Session settings endpoint" "GET" "/api/session/settings"
    # Writes and subpaths are stubbed for every method too, so a probe cannot
    # mutate server-side state or slip through on a non-GET verb.
    assert_session_json_404 "Session settings write" "POST" "/api/session/settings"
    assert_session_json_404 "Session history delete" "DELETE" "/api/session/history/probe-uuid"
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

# Fail-closed in-code defaults: when MODE / KUZU_QUERY_SIZE_LIMIT /
# KUZU_QUERY_TIMEOUT are UNSET, the server must still fall back to the SAFE value
# (READ_ONLY / 10000 rows / 30000ms) rather than the old fail-open behaviour, so
# safety survives a dropped Dockerfile ENV.
#
# These assertions require booting the server WITHOUT those env vars, which the
# single-instance suite here cannot do mid-run. They are documented for an
# env-matrix harness (boot one instance per case) and are NOT wired into main():
#
#   1. MODE unset            -> GET /api/mode reports READ_ONLY (not READ_WRITE)
#   2. MODE="" / whitespace  -> READ_ONLY
#   3. MODE=garbage          -> READ_ONLY (fails closed, no crash)
#   4. MODE unset            -> a CREATE/DROP/DELETE is rejected (READ_ONLY validation active)
#   5. MODE=READ_WRITE       -> /api/mode reports READ_WRITE (operator raise-path intact)
#   6. KUZU_QUERY_SIZE_LIMIT unset -> broad MATCH capped at 10000 rows
#   7. KUZU_QUERY_SIZE_LIMIT=0/neg -> falls back to 10000 (not unbounded)
#   8. KUZU_QUERY_SIZE_LIMIT=50000 -> operator raise-path works (cap honored above default)
#   9. KUZU_QUERY_TIMEOUT unset -> startup log shows "Query timeout: 30000 ms"
#
# When run against an instance that ITSELF booted with these unset, the existing
# test_access_mode (mode==READ_ONLY) and test_resource_guards (10000-row cap)
# already exercise cases 1 and 6 — so a CI job that starts the server with no
# MODE/limit env and runs this suite validates the fail-closed defaults directly.

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
# (which keys on its own XFF, 203.0.113.30). It therefore does NOT
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

# --- TASK-105: resource guards (DoS) ---
# Confirmed live against the shipping READ_ONLY server during the TASK-105
# adversarial sweep. These lock in the guardrails that bound a single
# unauthenticated request's CPU/memory/response cost.
test_resource_guards() {
    print_header "Testing Resource Guards (DoS bounds — TASK-105)"

    # Per-section rate-limit key so the nested-DoS and cartesian probes below run
    # on a query-rate-limit bucket and row-budget key no other section touches.
    # (The oversized-body probe does not strictly need it — express.json 413s at
    # app level, before the router's limiters — but sends it for uniformity.)
    # TEST-NET-3 (RFC 5737), unroutable.
    local SECTION_XFF="203.0.113.40"

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
        -H "X-Forwarded-For: ${SECTION_XFF}" \
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
        -H "X-Forwarded-For: ${SECTION_XFF}" \
        --data-binary '{"query":"MATCH (a),(b) RETURN a.id, b.id"}' | jq -r '.rows | length' 2>/dev/null)
    # rows must be >0 as well as <=10000: a 429 (e.g. a leftover row-budget debit
    # from a previous run against the same process) has no .rows, and jq maps
    # that to 0 — without the lower bound the cap check would pass vacuously.
    if [ -n "$rows" ] && [ "$rows" != "null" ] && [ "$rows" -gt 0 ] && [ "$rows" -le 10000 ]; then
        print_pass "Result capped at ${rows} rows (<= 10000)"
    else
        print_fail "Result-size cap not verified (rows=$rows; expected 1..10000)"
    fi

    # 3. JSON body-size limit: a ~2MB body (comfortably over the default 1mb
    #    JSON_BODY_LIMIT) must be rejected with 413 by the app-level express.json,
    #    which short-circuits on the byte limit before the router — i.e. ahead of
    #    the validator, the query rate limiter, and the row budget. The oversized
    #    bytes live inside the JSON string value (a Cypher line comment), keeping
    #    the payload valid JSON that only trips the size cap.
    #
    #    IMPORTANT: the payload is streamed into curl via a pipe, NOT built as a
    #    shell argument. A ~2MB string passed as an argv value (e.g. jq --arg q
    #    "<2MB>") overflows ARG_MAX and jq/curl silently receive a truncated or
    #    empty body — the server then answers 403/empty-body, masking the 413.
    #    Building the JSON with printf|tr keeps it off the command line entirely.
    print_test "Oversized JSON body rejected (413)"
    # `|| true`: if the server resets the connection while curl is still mid-
    # upload of the 2MB body (a 413 race), curl exits 55/56; -w has usually
    # already captured the status by then, but without the guard `set -e` would
    # abort the entire suite on that flake instead of failing this one test.
    local bigcode
    bigcode=$( { printf '{"query":"MATCH (n) RETURN n //'; \
                 head -c 2000000 /dev/zero | tr '\0' 'A'; \
                 printf '"}'; } \
        | curl -s -o /dev/null -w "%{http_code}" -X POST "$SERVER_URL/api/cypher" \
            -H "Content-Type: application/json" \
            -H "X-Forwarded-For: ${SECTION_XFF}" --data-binary @-) || true
    if [ "$bigcode" = "413" ]; then
        print_pass "Oversized body rejected with HTTP 413"
    else
        print_fail "Oversized body not rejected (got HTTP $bigcode, expected 413)"
    fi
}

# The upstream "datasets" browser feature (Datasets.js + /api/datasets/*) was
# pruned from the Horkos fork (TASK-123) — it was inert in the public READ_ONLY
# deployment and carried two attack-surface routes: /:dataset/copy (unvalidated
# Cypher exec) and /:dataset/files/:file (an unguarded readdir that crashed the
# whole process — the TASK-105/131 finding). These assertions lock in that the
# routes are gone (404) while the retained API surface still responds.
test_pruned_routes() {
    print_header "Testing Pruned Upstream Routes Return 404 (TASK-123)"

    # Removed datasets routes must 404 (router unmounted).
    local removed=(
        "/api/datasets"
        "/api/datasets/x/files/probe"
        "/api/datasets/x/copy"
    )
    local path code
    for path in "${removed[@]}"; do
        print_test "GET $path returns 404 (route pruned)"
        code=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL$path")
        if [ "$code" = "404" ]; then
            print_pass "$path -> 404"
        else
            print_fail "$path returned $code (expected 404 — datasets router should be gone)"
        fi
    done

    # Retained public routes must still respond.
    print_test "GET /api/mode still 200 (retained)"
    code=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/api/mode")
    [ "$code" = "200" ] && print_pass "/api/mode -> 200" || print_fail "/api/mode returned $code (expected 200)"

    print_test "GET /api/schema still 200 (retained)"
    code=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/api/schema")
    [ "$code" = "200" ] && print_pass "/api/schema -> 200" || print_fail "/api/schema returned $code (expected 200)"

    # In READ_ONLY, the RW-only routes must not be mounted (404).
    print_test "POST /api/reset returns 404 in READ_ONLY (RW-gated)"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SERVER_URL/api/reset")
    [ "$code" = "404" ] && print_pass "/api/reset -> 404 in READ_ONLY" || print_fail "/api/reset returned $code (expected 404 in READ_ONLY)"
}
# --- end TASK-105 / TASK-123 ---

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
    test_row_budget  # per-IP cumulative row budget (anti-bulk-scrape); requires a tiny QUERY_ROW_BUDGET — see script header
    test_xff_spoofing  # TASK-102: uses its own fresh per-IP bucket (right-most XFF 10.0.0.1); independent of test_rate_limiting's budget
    test_security_headers  # TASK-100: security-headers presence check
    test_session_storage
    test_resource_guards  # TASK-105: nesting-depth DoS cap, result-size cap, body-size 413
    test_pruned_routes  # TASK-123: removed datasets routes 404; retained routes still respond
    print_summary
}

# Run main function
main "$@"
