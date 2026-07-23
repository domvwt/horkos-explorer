# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Horkos Explorer** is a fork of [Kuzu Explorer](https://github.com/kuzudb/explorer) customized for the [Horkos OSINT toolkit](https://github.com/domvwt/horkos). It provides a browser-based interface for exploring graph databases built with Kuzu, with a focus on:

- **Public deployment safety**: Read-only mode with query validation
- **Multi-user support**: Stateless architecture for concurrent users
- **Investigation workflow**: Tailored for corporate-transparency investigation and research workflows
- **External integration**: Quick access to external resources (Companies House, Google, Wikipedia, Maps)

See [`research-notes/README.md`](research-notes/README.md) for detailed architecture research, security analysis, and implementation roadmap.

## Development Environment Setup

### Prerequisites

- **Node.js v20**: Use nvm to switch to the correct version
- **pnpm**: This repo uses pnpm as its package manager (`npm install -g pnpm`)
- **JDK 11+**: Required for ANTLR grammar generation
- **Git**: For submodule management

### Initial Setup

```bash
# Install Node.js dependencies
pnpm install

# Download and compile Kuzu from source (required, ~10 minute build)
git submodule update --init --recursive
npm run build-kuzu

# Generate Cypher grammar files (requires Java)
npm run generate-grammar
```

### Environment Variables

Set these before running the dev server:

```bash
# Required for grammar generation
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH=$JAVA_HOME/bin:$PATH

# Database configuration
export MODE=READ_ONLY                                         # Access mode. If MODE is unset/empty or unrecognised, the
                                                             # server fails closed to READ_ONLY (safe default). To enable
                                                             # writes (Cypher writes through the editor) you MUST set
                                                             # MODE=READ_WRITE explicitly; a bare run is read-only.
export KUZU_DIR=/home/domvwt/projects/horkos/data            # Directory containing .kuzu database
export KUZU_FILE=horkos_dev_sl.kuzu                          # Database filename (use dev database for development)

# Optional configurations
export DUCKDB_FILE=/home/domvwt/projects/horkos/data/horkos_dev_sl.duckdb  # DuckDB file with search.* tables - enables /api/suggest
                                          # autocomplete (ranked FTS + LIKE hybrid; omit to disable). DUCKDB_PATH is a legacy alias.
export KUZU_BUFFER_POOL_SIZE=1073741824  # 1GB buffer (default: 80% of RAM)
export KUZU_QUERY_TIMEOUT=30000          # Per-query wall-clock timeout in ms (production image default: 30000).
                                          # Applied to every pooled connection; unbounded if unset.
export KUZU_QUERY_SIZE_LIMIT=10000       # Max result rows returned per /api/cypher query (production image default: 10000).
                                          # Bounds response size so a broad MATCH...RETURN cannot stream the whole graph; unbounded if unset.
export QUERY_ROW_BUDGET=100000           # Cumulative rows one IP may ship from /api/cypher per window (default: 100000;
                                          # relaxed to 10000000 when NODE_ENV=development so hot-reload dev never trips it).
                                          # Bounds bulk scraping: KUZU_QUERY_SIZE_LIMIT caps ONE response and the query rate
                                          # limit caps request COUNT, but neither bounds how much of the corpus one client can
                                          # paginate out across requests. Fail-closed: unset/invalid/<=0 falls back to the
                                          # default, NEVER disabled. Enforced for every mode except MODE=READ_WRITE.
export QUERY_ROW_BUDGET_WINDOW_MS=86400000  # Row-budget window in ms (default: 86400000 = 24h). Fixed window, resets on elapse.
export KUZU_NUM_CONNECTIONS=4            # Connection pool size
export JSON_BODY_LIMIT=1mb               # Max JSON request-body size (default: 1mb), applied to all JSON bodies (queries).

# Security configuration for public deployments
export DISABLE_SESSION_DB=true           # Disable server-side session storage (recommended for public deployments)
                                          # When enabled, query history and settings are stored only in browser localStorage
export TRUST_PROXY=1                      # How many reverse-proxy hops to trust for X-Forwarded-For (default: 1).
                                          # SECURITY: the value is always normalised to a finite hop COUNT, never boolean
                                          # "trust the whole chain". Trusting exactly 1 hop makes Express use the
                                          # RIGHT-MOST XFF entry (written by the trusted nginx), so a client cannot rotate
                                          # a spoofed left-most XFF to bypass the per-IP rate limits.
                                          #   - unset / true / on -> trust TRUST_PROXY_HOPS hops (default 1)
                                          #   - <n> (numeric)     -> trust exactly N hops (TRUST_PROXY_HOPS ignored)
                                          #   - false / 0 / off   -> disable; req.ip is the raw socket address
                                          # A hop count above 10 is clamped to 10 (a huge count would let a client spoof req.ip).
                                          # The app MUST sit behind exactly the trusted proxy and MUST NOT be exposed directly.
export TRUST_PROXY_HOPS=1                 # Explicit hop count used when TRUST_PROXY is unset/true (default: 1)

# Security headers (helmet)
export CSP_REPORT_ONLY=false             # CSP enforce-vs-report mode. In-code default when UNSET is true
                                          # (report-only) so a bare node run is fail-safe; the production
                                          # Docker image sets this to false to ship the CSP ENFORCING, since
                                          # the policy was validated against the real frontend (Monaco/G6/
                                          # Bootstrap) with no violations. When true, the CSP is emitted as
                                          # report-only (browser reports violations but does not block) — use
                                          # that to re-validate after a frontend change. All other helmet
                                          # headers (HSTS, X-Frame-Options, X-Content-Type-Options,
                                          # Referrer-Policy) are always enforced regardless of this flag.

# Rate limiting configuration (optional, defaults shown)
export RATE_LIMIT_WINDOW_MS=60000        # Time window in ms (default: 60000 = 1 minute)
export RATE_LIMIT_MAX_REQUESTS=60        # Max requests per window for general API endpoints
export QUERY_RATE_LIMIT_WINDOW_MS=60000  # Time window for query endpoints
export QUERY_RATE_LIMIT_MAX_REQUESTS=30  # Max queries per window (more restrictive for expensive operations)
```

## Common Development Commands

### Running the Server

```bash
# Development server with hot-reloading (runs on http://localhost:8080)
npm run serve

# Production build
npm run build

# Production server (after building)
npm run serve-prod
```

### Code Quality

```bash
# Run ESLint
npm run eslint

# Auto-fix ESLint issues
npm run eslint-fix
```

### Testing

#### Security Testing

Run the comprehensive security test suite to validate query validation, rate limiting, and session storage:

```bash
# Run all security tests (requires server to be running)
npm run test-security

# Or run directly
./scripts/test-security.sh
```

The security test suite validates:
- **Query Validation**: Blocks CREATE, DROP, DELETE, ALTER, and other write operations in READ_ONLY mode
- **Multi-Statement Protection**: Detects and blocks malicious queries in multi-statement batches
- **Comment Bypass Prevention**: Strips comments before validation to prevent bypass attempts
- **Rate Limiting**: Verifies 30 queries/min limit is enforced
- **Session Storage**: Confirms stateless operation when DISABLE_SESSION_DB=true
- **Legitimate Queries**: Ensures MATCH and read operations work correctly

**Prerequisites:**
- Server must be running (`npm run serve`)
- `jq` must be installed (`sudo apt install jq`)
- Environment variables must be set (MODE=READ_ONLY, DISABLE_SESSION_DB=true, etc.)

### Rebuilding Components

```bash
# Rebuild Kuzu from source (needed after pulling submodule updates)
npm run build-kuzu

# Regenerate Cypher grammar (needed after grammar file changes)
npm run generate-grammar

# Clean all generated files and dependencies
npm run clean
```

### Docker

The production image defaults to `MODE=READ_ONLY` and `DISABLE_SESSION_DB=true` (see the `Dockerfile`), so no operator-supplied env vars are required for a safe, stateless deployment.

```bash
# Build Docker image
docker build -t ghcr.io/domvwt/explorer:latest .

# Run Docker container with database mount (read-only, stateless by default)
docker run -p 8000:8000 \
  -v /path/to/database:/database \
  -e KUZU_FILE=database.kuzu \
  --rm ghcr.io/domvwt/explorer:latest

# Opt in to read-write mode
docker run -p 8000:8000 \
  -v /path/to/database:/database \
  -e KUZU_FILE=database.kuzu \
  -e MODE=READ_WRITE \
  --rm ghcr.io/domvwt/explorer:latest
```

## Architecture

### Stack

- **Frontend**: Vue 3 + TypeScript + Bootstrap 5
- **Backend**: Node.js + Express.js + Kuzu graph database
- **Code Editor**: Monaco Editor v0.39.0 (downgraded from v0.41.0 for font compatibility)
- **Graph Visualization**: AntV G6 v5.x
- **State Management**: Pinia

### Key Components Structure

```
src/
├── components/
│   ├── ShellView/          # Query interface
│   │   ├── CypherEditor.vue         # Monaco-based Cypher editor
│   │   ├── ResultGraph.vue          # G6 graph visualization
│   │   ├── ResultTable.vue          # Tabular results display
│   │   └── ShellCell.vue            # Combined editor + results
│   ├── SchemaView/         # Schema visualization (read-only)
│   └── MainLayout.vue      # App shell, navigation
├── server/
│   ├── index.js            # Express server entry point
│   ├── API.js              # API router
│   ├── Cypher.js           # Query execution endpoint
│   ├── Schema.js           # Schema management API
│   ├── Session.js          # User settings/history (TO BE REMOVED)
│   └── utils/
│       ├── Database.js              # Kuzu connection pool manager
│       └── SessionDatabase.js       # SQLite session storage (TO BE REMOVED)
└── store/
    ├── ModeStore.js        # Access mode (READ_ONLY, READ_WRITE)
    └── SettingsStore.js    # UI settings
```

### Database Access Patterns

The `Database.js` singleton manages a connection pool to Kuzu:

- **Connection Pool**: Round-robin allocation based on use count
- **Access Modes**: Determined by `MODE` environment variable at startup
- **Query Timeout**: Configurable via `KUZU_QUERY_TIMEOUT` (set on connection init)
- **Read-Only Mode**: Database opened in read-only mode at Kuzu level, but queries are NOT validated before execution

### State Management

- **Frontend State**: Pinia stores (`ModeStore`, `SettingsStore`)
- **Session State**: Currently uses server-side SQLite (`SessionDatabase.js`) - **MUST BE REMOVED** for stateless architecture
- **Access Mode**: Frozen at server startup based on `MODE` env var

### Build Configuration

- **Webpack**: Configured via `vue.config.js`
- **Monaco Editor**: Requires custom webpack plugin for web workers
- **Font Assets**: TTF files handled as `asset/resource` type (required for Monaco v0.39.0)
- **Monaco workers**: bundled via the Monaco webpack plugin (no WASM engines are shipped)

## Important Development Notes

### Monaco Editor Version

- **v0.39.0 is required** - DO NOT upgrade to v0.41.0+
- Newer versions removed `codicon.ttf` font file, causing missing glyph errors
- Webpack config includes TTF asset handling for this version

### Kuzu Build Requirements

- Kuzu MUST be compiled from source (npm package doesn't work directly)
- Build artifacts cached in `kuzu/build/release/`
- Requires C++ toolchain (see [Kuzu developer guide](https://docs.kuzudb.com/developer-guide/))
- Initial build takes ~10 minutes

### Development vs Production Kuzu Path

In `Database.js`:
- **Development**: Loads from `kuzu/tools/nodejs_api/build/`
- **Production**: Loads from `node_modules/kuzu`

### Access Mode Immutability

The access mode (`READ_ONLY`, `READ_WRITE`, etc.) is determined at server startup and cannot be changed at runtime without restarting the server.

## UI Style Conventions

The app aims for a minimal, quiet visual language. Every UI change must conform;
when touching a surface that predates these rules, bring it into line.

1. **Button hierarchy** — exactly three tiers, nothing else:
   - *Solid primary* (`btn-primary`): reserved for a page's single main action
     (e.g. Search). Never more than one per surface.
   - *Boxed neutral* (`btn-outline-secondary` style): genuine panel actions the
     user is expected to click in normal flow (e.g. Expand Graph).
   - *Quiet text/icon actions*: everything secondary, rare, or undoable —
     hover-highlighted text or icon, no permanent box or border.
2. **Colour budget** — the blue accent appears at most once per surface. Red is
   never a resting state: it exists only inside open menus and armed two-stage
   confirms. Semantic state colours (success/warn/danger) are not decoration.
3. **Reversible actions get undo, not friction.** If an action is one undo away
   from recovered, it is a single quiet click plus a toast that mentions undo —
   no confirm stage, no danger styling. Two-stage inline confirms (never native
   `window.confirm`/`prompt`) are reserved for genuinely unrecoverable actions
   (deleting notebooks, wiping storage).
4. **Rare actions live in menus.** Lifecycle/backup actions (rename, export,
   import, delete, wipe) belong in a small dropdown menu, not as permanently
   visible buttons. Cautionary copy travels with the action it describes
   (caption inside the menu), never as standing panel text.
5. **A disabled button is a status, not an action** — render statuses as plain
   captions instead of unclickable buttons.
6. **Chips and badges**: no text-shadow outline hacks. Entity-type colours come
   from the shared canvas palette so panels and canvas stay in sync. Render an
   entity chip with `chipStyle()` (`src/utils/ChipContrast.js`) — a light
   colour-mix wash of the entity colour over the theme background with ink that
   is mostly body-text plus a whisper of the hue, so it stays legible and
   theme-adaptive with no forced ink. Where a control must be filled with the
   raw entity colour instead (e.g. the schema editor's coloured `<select>`/name
   inputs), pick the ink with `inkForBackground()` (YIQ: dark ink on light
   fills, white on dark) rather than a fixed colour.
7. **List rows reveal actions on hover/focus-within** (unpin, share, delete);
   the resting state of a list is just its content.
8. **Section headers are micro-labels** (small uppercase, letterspaced,
   secondary colour), not bold headings with hairline rules.
9. **Light theme is design-primary**; style through the CSS tokens in
   `src/assets/global.css` so dark follows. Never hardcode greys.

## Security Considerations

**CRITICAL for public deployment** (see `research-notes/README.md` for full details):

1. **Session Storage**: The production Docker image defaults to `DISABLE_SESSION_DB=true`, disabling server-side session storage (shared across all users). When disabled, query history and settings are stored only in browser `localStorage`, providing proper multi-user isolation. Local/dev runs outside the image must set this explicitly.
2. **Query Validation**: Currently relies on Kuzu to reject writes in READ_ONLY mode - SHOULD add server-side validation to reject `CREATE`, `DROP`, `DELETE`, etc. before execution
3. **Schema Editor**: Removed entirely — the schema view is a read-only browser in every mode
4. **Rate Limiting**: Add Express rate limiting middleware for public deployments
5. **CORS**: Configure `ALLOWED_ORIGINS` environment variable for production
6. **Resource guardrails (DoS / exfiltration)**: The production Docker image ships with default resource bounds so an unauthenticated user cannot run unbounded queries or bulk-exfiltrate the graph:
   - **Query timeout**: `KUZU_QUERY_TIMEOUT=30000` (30s). Applied to every pooled connection at init (`Database.js`), so no single query runs indefinitely.
   - **Result-size cap**: `KUZU_QUERY_SIZE_LIMIT=10000` rows. Enforced in `Cypher.js` (`processSingleResult`): when a result exceeds the cap, only the first N rows are read back, bounding response size. 10000 rows is a generous ceiling for interactive graph exploration while still preventing whole-graph streaming; operators handling larger legitimate exports should raise it deliberately.
   - **Per-IP row budget (anti-bulk-scrape)**: `QUERY_ROW_BUDGET=100000` cumulative rows per `QUERY_ROW_BUDGET_WINDOW_MS=86400000` (24h) window per client IP on `/api/cypher`. Enforced by `src/server/middleware/RowBudget.js`: the result-size cap bounds a single response and the query rate limit bounds request COUNT, but neither bounds how much of the corpus one client can paginate out across requests (e.g. `... ORDER BY p.id SKIP $n LIMIT 10000` repeated at the rate limit). The budget is pre-checked before the connection pool is touched and debited with the rows *actually shipped* (post-cap) on the success path; errored/timed-out queries debit nothing. The IP key uses the same trusted-proxy resolution as the rate limiter (right-most X-Forwarded-For + IPv6 /56 mask via `express-rate-limit`'s `ipKeyGenerator`), so a spoofed left-most XFF cannot reset the budget. Defaults are fail-closed (unset/invalid/<=0 -> default, never disabled) and relaxed to 10000000 rows when `NODE_ENV=development`. Enforced for every mode except `MODE=READ_WRITE`. **Admit-then-debit** means a single request can overshoot by up to `KUZU_QUERY_SIZE_LIMIT-1` rows (worst-case cumulative total = budget + querySizeLimit - 1). The store is **in-process and single-replica**: state lives in one process's memory, so it resets on restart and each replica holds an independent budget — a multi-replica deployment would need a shared store or IP-sticky routing to bound the aggregate.
   - **Request-body limit**: JSON bodies are capped at `1mb` (`JSON_BODY_LIMIT`, `index.js`). The largest legitimate JSON body is a Cypher query (already capped at 50KB by `QueryValidator`).
   - **Max result / export size decision**: interactive `/api/cypher` responses are hard-bounded to `KUZU_QUERY_SIZE_LIMIT` rows. There is no separate bulk-export endpoint in the public read-only image; operators needing large exports should run Kuzu tooling directly against the database file rather than raising the UI cap. All three bounds are operator-overridable via the env vars above.
7. **Security Headers (helmet)**: The Express app mounts [`helmet`](https://helmetjs.github.io/) early in the middleware chain (`src/server/index.js`) as **defence-in-depth**, so header hardening is present even if the nginx proxy is bypassed or misconfigured. Headers set:
   - `X-Content-Type-Options: nosniff` (blocks MIME-sniffing) — enforced.
   - `X-Frame-Options` + CSP `frame-ancestors 'none'` (anti-clickjacking) — enforced.
   - `Referrer-Policy` — enforced.
   - `Strict-Transport-Security` (HSTS) — enforced. Safe behind nginx-terminated TLS even when the app itself is served over plain HTTP, because browsers only honour HSTS received over HTTPS.
   - **Content-Security-Policy** — see `CSP_REPORT_ONLY` below. The policy is derived from actual frontend usage: `script-src 'self'` (no eval or WASM allowances — the app never calls `eval`/`new Function`, and `'wasm-unsafe-eval'` was dropped after a report-only browser re-validation once the in-browser WASM engines were removed), `worker-src 'self' blob:` (Monaco Web Workers), `style-src 'self' 'unsafe-inline'` (Bootstrap/Monaco inline styles), `img-src`/`font-src 'self' data:`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.

   **`CSP_REPORT_ONLY` env var** (default `true`): controls only the CSP header's enforce-vs-report mode. When `true` (default), the CSP is emitted as `Content-Security-Policy-Report-Only` — the browser reports violations but does **not** block, so a mis-derived policy cannot break the query UI (Monaco, G6 graph, Bootstrap). After validating the app in a browser under the real policy, an operator can set `CSP_REPORT_ONLY=false` to switch to the enforcing `Content-Security-Policy` header. All the other headers above are always enforced regardless of this flag.

## Horkos Graph Schema

The Horkos database contains entity resolution results from UK corporate data sources (Companies House, PSC Register, ICIJ Offshore Leaks). Schema below is derived from the live `/api/schema` response — treat it as authoritative over any prose description.

### Node Types

**Person**
- `id` (STRING, PRIMARY KEY): Cluster ID from entity resolution
- `name` (STRING): Resolved canonical name
- `birth_date` (STRING): Date of birth
- `nationality` (STRING): Nationality code
- `country` (STRING): Country code
- `source_records` (STRING[]): Array of source record IDs (e.g., `["psc_rec_123", "icij_rec_456"]`)
- `record_count` (INT64): Number of source records merged into this cluster
- `source_systems` (STRING[]): Source systems contributing to this cluster
- `quality_level` (STRING): Entity resolution quality tier
- `quality_concerns` (STRING): Notes on data quality issues, if any

**Company**
- `id` (STRING, PRIMARY KEY): Cluster ID
- `name` (STRING): Company name
- `company_number` (STRING): Official registration number
- `incorporation_date` (STRING): Date of incorporation
- `status` (STRING): Company status (active, dissolved, etc.)
- `jurisdiction` (STRING): Jurisdiction code (e.g., "GB", "CYM")
- `category` (STRING): Company category/type
- `sic_codes` (STRING[]): SIC classification codes
- `dissolution_date` (STRING): Date of dissolution, if applicable
- `legal_form` (STRING): Legal form of the entity
- `source_records` (STRING[]): Source record IDs (e.g., `["ch_rec_789"]`)
- `record_count` (INT64): Number of source records merged into this cluster
- `source_systems` (STRING[]): Source systems contributing to this cluster
- `quality_level` (STRING): Entity resolution quality tier
- `quality_concerns` (STRING): Notes on data quality issues, if any

**Address**
- `id` (STRING, PRIMARY KEY): Cluster ID
- `full` (STRING): Full normalized address
- `post_code` (STRING): Postcode
- `city` (STRING): City name
- `country` (STRING): Country code
- `record_count` (INT64): Number of source records merged into this cluster
- `source_records` (STRING[]): Source record IDs
- `source_systems` (STRING[]): Source systems contributing to this cluster
- `quality_level` (STRING): Entity resolution quality tier
- `quality_concerns` (STRING): Notes on data quality issues, if any

**VirtualHub**
- `id` (STRING, PRIMARY KEY): Hub ID
- `name` (STRING): Hub display name
- `entity_type` (STRING): Type of entity the hub represents (Person/Company/Address)
- `original_cluster_id` (STRING): Cluster ID this hub was derived from

VirtualHub nodes are synthetic collision points used by the `*AmbiguousLink` edges below (e.g. shared addresses or names that entity resolution could not confidently merge or split); they are not sourced from a single corporate record.

### Edge Types

**CorporateOwnership** (Company → Company)
- `id` (STRING)
- `sources` (STRUCT[]): array of `{role, percentage, control_type, start_date, end_date, source_record, source_system}`
- `start_date` (DATE)
- `end_date` (DATE)

**PersonOwnership** (Person → Company)
- `id` (STRING)
- `sources` (STRUCT[]): array of `{role, percentage, control_type, start_date, end_date, source_record, source_system}`
- `start_date` (DATE)
- `end_date` (DATE)

**CorporateInfluence** (Company → Company)
- `id` (STRING)
- `sources` (STRUCT[]): array of `{role, percentage, control_type, start_date, end_date, source_record, source_system}`
- `start_date` (DATE)
- `end_date` (DATE)

**PersonInfluence** (Person → Company)
- `id` (STRING)
- `sources` (STRUCT[]): array of `{role, percentage, control_type, start_date, end_date, source_record, source_system}`
- `start_date` (DATE)
- `end_date` (DATE)

**RegisteredAddress** (Company → Address)
- `id` (STRING)
- `sources` (STRUCT[]): array of `{role, percentage, control_type, start_date, end_date, source_record, source_system}`
- `start_date` (DATE)
- `end_date` (DATE)

**CorrespondenceAddress** (Person → Address)
- `id` (STRING)
- `sources` (STRUCT[]): array of `{role, percentage, control_type, start_date, end_date, source_record, source_system}`
- `start_date` (DATE)
- `end_date` (DATE)

**PersonAmbiguousLink** (Person → VirtualHub)
- `id` (STRING)
- `evidence` (STRUCT[]): array of `{from_record_id, to_record_id}`

**CompanyAmbiguousLink** (Company → VirtualHub)
- `id` (STRING)
- `evidence` (STRUCT[]): array of `{from_record_id, to_record_id}`

**AddressAmbiguousLink** (Address → VirtualHub)
- `id` (STRING)
- `evidence` (STRUCT[]): array of `{from_record_id, to_record_id}`

There is no `Directorship` or `ResidentialAddress` edge table — director/officer roles and residential-address links are carried via `PersonInfluence`/`PersonOwnership` (`role` inside `sources`) and `CorrespondenceAddress` respectively.

### Provenance

Person, Company, and Address nodes all include `source_records` arrays containing record IDs from the source systems:
- `ch_rec_*`: Companies House
- `psc_rec_*`: PSC (Persons with Significant Control) Register
- `icij_rec_*`: ICIJ Offshore Leaks Database

This enables tracing back to original data sources for validation. `record_count` and `source_systems` on each node summarize how many records and which systems fed the cluster; `quality_level`/`quality_concerns` capture entity-resolution confidence.

## Testing Database

**Always use the development database for local development:**

Development testing uses `horkos_dev_sl.kuzu`:
- **Location**: `/home/domvwt/projects/horkos/data/horkos_dev_sl.kuzu`
- **Size**: ~100MB (SL = Slough postcode area)
- **Contents**: companies, persons, addresses for the Slough area
- **Schema**: See "Horkos Graph Schema" section above

Set via environment variables:
```bash
export KUZU_DIR=/home/domvwt/projects/horkos/data
export KUZU_FILE=horkos_dev_sl.kuzu
```

The full UK production pair (graph + suggest DB) lives at `/home/domvwt/projects/horkos/data/publish_trial/` as `horkos_uk_national_fresh-2026-07-23-graph.kuzu` and its matching `_suggest.duckdb` file.

## Deployment

GitHub Actions pipeline (`.github/workflows/build-and-deploy.yml`) automatically builds and deploys Docker images to Docker Hub on push to master branch. Builds for both `amd64` and `arm64` platforms.
