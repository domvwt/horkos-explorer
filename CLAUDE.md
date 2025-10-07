# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Horkos Explorer** is a fork of [Kuzu Explorer](https://github.com/kuzudb/explorer) customized for the [Horkos OSINT toolkit](https://github.com/domvwt/horkos). It provides a browser-based interface for exploring graph databases built with Kuzu, with a focus on:

- **Public deployment safety**: Read-only mode with query validation
- **Multi-user support**: Stateless architecture for concurrent users
- **Investigation workflow**: Tailored for financial crime investigations and entity resolution
- **External integration**: Quick access to external resources (Companies House, Google, Wikipedia, Maps)

See [`research-notes/README.md`](research-notes/README.md) for detailed architecture research, security analysis, and implementation roadmap.

## Development Environment Setup

### Prerequisites

- **Node.js v20**: Use nvm to switch to the correct version
- **JDK 11+**: Required for ANTLR grammar generation
- **Git**: For submodule management

### Initial Setup

```bash
# Install Node.js dependencies
npm i

# Download and compile Kuzu from source (required, ~10 minute build)
git submodule update --init --recursive
npm run build-kuzu

# Generate Cypher grammar files (requires Java)
npm run generate-grammar

# Fetch example datasets
npm run fetch-datasets
```

### Environment Variables

Set these before running the dev server:

```bash
# Required for grammar generation
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH=$JAVA_HOME/bin:$PATH

# Database configuration
export MODE=READ_ONLY                    # Force read-only mode (recommended)
export KUZU_DIR=/path/to/database/dir    # Directory containing .kuzu database
export KUZU_FILE=database_name.kuzu      # Database filename

# Optional configurations
export KUZU_BUFFER_POOL_SIZE=1073741824  # 1GB buffer (default: 80% of RAM)
export KUZU_QUERY_TIMEOUT=30000          # Query timeout in ms
export KUZU_NUM_CONNECTIONS=4            # Connection pool size

# Security configuration for public deployments
export DISABLE_SESSION_DB=true           # Disable server-side session storage (recommended for public deployments)
                                          # When enabled, query history and settings are stored only in browser localStorage
export TRUST_PROXY=true                  # Trust X-Forwarded-For header when behind nginx/reverse proxy (default: true)
                                          # Required for rate limiting to work correctly with real client IPs

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

```bash
# Build Docker image
docker build -t kuzudb/explorer:latest .

# Run Docker container with database mount
docker run -p 8000:8000 \
  -v /path/to/database:/database \
  -e KUZU_FILE=database.kuzu \
  -e MODE=READ_ONLY \
  --rm kuzudb/explorer:latest
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
│   ├── SchemaView/         # Schema visualization/editing
│   ├── ImporterView/       # CSV data import (hidden in READ_ONLY)
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
    ├── ModeStore.js        # Access mode (READ_ONLY, READ_WRITE, DEMO, WASM)
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
- **WebAssembly**: DuckDB and Kuzu WASM files copied to `dist/js/`

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

## Security Considerations

**CRITICAL for public deployment** (see `research-notes/README.md` for full details):

1. **Session Storage**: Set `DISABLE_SESSION_DB=true` to disable server-side session storage (shared across all users). When disabled, query history and settings are stored only in browser `localStorage`, providing proper multi-user isolation.
2. **Query Validation**: Currently relies on Kuzu to reject writes in READ_ONLY mode - SHOULD add server-side validation to reject `CREATE`, `DROP`, `DELETE`, etc. before execution
3. **Schema Editor**: Must be hidden in READ_ONLY mode (check `MainLayout.vue`)
4. **Rate Limiting**: Add Express rate limiting middleware for public deployments
5. **CORS**: Configure `ALLOWED_ORIGINS` environment variable for production

## Horkos Graph Schema

The Horkos database contains entity resolution results from UK corporate data sources (Companies House, PSC Register, ICIJ Offshore Leaks).

### Node Types

**Person**
- `id` (STRING, PRIMARY KEY): Cluster ID from entity resolution
- `name` (STRING): Resolved canonical name
- `birth_date` (DATE): Date of birth
- `birth_year` (INT64): Birth year
- `birth_month` (INT64): Birth month
- `nationality` (STRING): Nationality code
- `source_records` (STRING[]): Array of source record IDs (e.g., `["psc_rec_123", "icij_rec_456"]`)

**Company**
- `id` (STRING, PRIMARY KEY): Cluster ID
- `name` (STRING): Company name
- `company_number` (STRING): Official registration number
- `jurisdiction` (STRING): Jurisdiction code (e.g., "GB", "CYM")
- `status` (STRING): Company status (active, dissolved, etc.)
- `incorporation_date` (DATE): Date of incorporation
- `source_records` (STRING[]): Source record IDs (e.g., `["ch_rec_789"]`)

**Address**
- `id` (STRING, PRIMARY KEY): Cluster ID
- `full` (STRING): Full normalized address
- `post_code` (STRING): Postcode
- `city` (STRING): City name
- `country` (STRING): Country code
- `source_records` (STRING[]): Source record IDs

### Edge Types

**CorporateOwnership** (Company → Company)
- `percentage` (DOUBLE): Ownership percentage

**PersonOwnership** (Person → Company)
- `percentage` (DOUBLE): Ownership percentage

**Directorship** (Person → Company)
- `roles` (STRING[]): Director roles (e.g., `["director", "secretary"]`)

**RegisteredAddress** (Company → Address)
- Simple edge, no properties

**ResidentialAddress** (Person → Address)
- Simple edge, no properties

### Provenance

All entities include `source_records` arrays containing record IDs from the source systems:
- `ch_rec_*`: Companies House
- `psc_rec_*`: PSC (Persons with Significant Control) Register
- `icij_rec_*`: ICIJ Offshore Leaks Database

This enables tracing back to original data sources for validation.

## Testing Database

Development testing uses `horkos_dev_pl_graph.kuzu`:
- **Size**: 48MB (PL postcode area)
- **Contents**: ~25K companies, persons, addresses
- **Schema**: See "Horkos Graph Schema" section above
- **Location**: Set via `KUZU_DIR` and `KUZU_FILE` env vars

## Deployment

GitHub Actions pipeline (`.github/workflows/build-and-deploy.yml`) automatically builds and deploys Docker images to Docker Hub on push to master branch. Builds for both `amd64` and `arm64` platforms.
