# Horkos Explorer

> **Note:** This is a fork of [Kuzu Explorer](https://github.com/kuzudb/explorer) customized for the [Horkos OSINT toolkit](https://github.com/domvwt/horkos).
>
> **Research & Planning Documentation:** See [`research-notes/README.md`](research-notes/README.md) for architecture research, security analysis, and implementation roadmap.

Browser-based user interface for the [Kuzu](https://github.com/kuzudb/kuzu) graph database.

<img src="src/assets/explorer-graph-view.png">


## Get started

Kuzu Explorer is a web application that is launched from a deployed Docker image.
Please refer to the [Docker documentation](https://docs.docker.com/get-docker/) for details on how to install and use Docker.

Below we show two different ways to launch Kuzu Explorer. Each of these options make
Kuzu Explorer accessible on [http://localhost:8000](http://localhost:8000). If the launching is successful, you should see the logs similar to the following in your shell:

```
Access mode: READ_ONLY
Version of Kuzu: v0.0.11
Deployed server started on port: 8000
```

### Option 1: Using an existing database

To access an existing Kuzu database, you can mount its path to the `/database` directory as follows:

```bash
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           --rm ghcr.io/domvwt/explorer:latest
```

By mounting local database files to Docker via `-v {path to the directory containing the database file}` and `-e KUZU_FILE={database file name}`, the changes done in the UI will persist to the local database files after the UI is shutdown. If the directory is mounted but the `KUZU_FILE` environment variable is not set, Kuzu Explorer will look for a file named `database.kz` in the mounted directory or create a new database file named `database.kz` in the mounted directory if it does not exist.

The `--rm` flag tells docker that the container should automatically be removed after we close docker.

### Option 2: Start with an empty database

You can also launch Horkos Explorer without specifying an existing database.
This is simply done by removing the `-v` flag in the example above. If no database path is specified
with `-v`, the server will be started with an empty database.

```bash
docker run -p 8000:8000 --rm ghcr.io/domvwt/explorer:latest
```

### Additional launch configurations

#### Access mode

By default, Horkos Explorer is launched in read-only, stateless mode (`MODE=READ_ONLY` and `DISABLE_SESSION_DB=true`): you can issue read queries and visualize the results, but you cannot run write queries, modify the schema, or persist session state server-side. This is the safe default for public deployments and does not require any operator-supplied environment variables.

If you want to launch Horkos Explorer in read-write mode, you can opt in by setting the `MODE` environment variable to `READ_WRITE` as follows.

```bash
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           -e MODE=READ_WRITE \
           --rm ghcr.io/domvwt/explorer:latest
```

#### Resource guardrails (public deployments)

The production Docker image ships with default resource bounds so an unauthenticated user cannot run unbounded queries (DoS) or bulk-exfiltrate the graph. All are operator-overridable via environment variables:

| Guardrail | Env var | Default | Effect |
| --- | --- | --- | --- |
| Query timeout | `KUZU_QUERY_TIMEOUT` | `30000` (30s) | Per-query wall-clock bound applied to every pooled connection; no single query runs indefinitely. |
| Result-size cap | `KUZU_QUERY_SIZE_LIMIT` | `10000` | Max result rows returned per `/api/cypher` query; a broad `MATCH ... RETURN` cannot stream the whole graph. |
| Request-body limit | `JSON_BODY_LIMIT` | `1mb` | Max JSON request-body size. CSV/Parquet import uploads use multipart streaming and are **not** limited by this. |

The interactive query response is hard-bounded to `KUZU_QUERY_SIZE_LIMIT` rows; there is no separate bulk-export endpoint in the read-only image. Operators needing larger exports should run Kuzu tooling directly against the database file rather than raising the UI cap.

#### Buffer pool size

By default, Kuzu Explorer is launched with a maximum buffer pool size of 80% of the available memory. If you want to launch Kuzu Explorer with a different buffer pool size, you can do so by setting the `KUZU_BUFFER_POOL_SIZE` environment variable to the desired value in bytes as follows.

For example, to launch Kuzu Explorer with a buffer pool size of 1GB, you can run the following command.

```bash
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           -e KUZU_BUFFER_POOL_SIZE=1073741824 \
           --rm ghcr.io/domvwt/explorer:latest
```

#### In-memory mode

By default, Kuzu Explorer is launched in disk-based mode. If you want to launch Kuzu Explorer in in-memory mode, you can do so by setting the `KUZU_IN_MEMORY` environment variable to `true` as follows.

```bash
docker run -p 8000:8000 \
           -e KUZU_IN_MEMORY=true \
           --rm ghcr.io/domvwt/explorer:latest
```

In in-memory mode, the database is stored in memory and all changes are lost when the server is shut down even if a database directory is mounted. Also, read-only access mode is not supported in in-memory mode.

#### WebAssembly mode

In WebAssembly mode, Kuzu Explorer is launched with `kuzu-wasm`, which runs all the queries directly in browser. If you want to launch Kuzu Explorer in WebAssembly mode, you can do so by setting the `KUZU_WASM` environment variable to `true` as follows.

```bash
docker run -p 8000:8000 \
           -e KUZU_WASM=true \
           --rm ghcr.io/domvwt/explorer:latest
```

In WebAssembly mode, the database is stored in the current browser session and all changes are lost when the browser tab is closed or when the tab is refreshed. All other configuration parameters are ignored in WebAssembly mode.

#### Dev builds

If you want to launch Kuzu Explorer with the latest development build of Kuzu, you can do so by using the `dev` tag instead of `latest`.

```bash
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           --rm ghcr.io/domvwt/explorer:dev
```

The `dev` tag is updated daily, approximately two hours after the latest dev build of Kuzu is released.

#### Security headers

As defence-in-depth, the Express app mounts [`helmet`](https://helmetjs.github.io/) to emit HTTP security headers at the application layer, so hardening is present even if a reverse proxy (nginx) in front is bypassed or misconfigured. The following headers are set:

- `X-Content-Type-Options: nosniff` — blocks MIME-sniffing.
- `X-Frame-Options` and CSP `frame-ancestors 'none'` — anti-clickjacking.
- `Referrer-Policy` — limits referrer leakage.
- `Strict-Transport-Security` (HSTS) — safe behind nginx-terminated TLS even when the app is served over plain HTTP, because browsers only honour HSTS received over HTTPS.
- `Content-Security-Policy` — restricts resource loading to what the frontend actually needs (same-origin scripts plus `wasm-unsafe-eval` for the DuckDB/Kuzu WASM modules, same-origin/blob Web Workers for Monaco/DuckDB, inline styles for Bootstrap/Monaco).

The production image ships the CSP in **enforcing** mode (`CSP_REPORT_ONLY=false`),
controlled by the `CSP_REPORT_ONLY` environment variable. The policy was validated
against the real frontend (Monaco editor + workers, DuckDB/Kuzu WASM, Bootstrap
inline styles, G6 graph) with no violations, so the browser blocks anything the
policy forbids rather than only reporting it. (The in-code default when the variable
is unset is report-only, so a bare `node` run outside the image is fail-safe.)

```bash
# Default image: CSP enforced.
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           --rm ghcr.io/domvwt/explorer:latest

# Fall back to report-only if a frontend change needs re-validating: the browser
# reports CSP violations to the console but does NOT block, so a mis-derived
# policy cannot break the query UI while you check it.
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           -e CSP_REPORT_ONLY=true \
           --rm ghcr.io/domvwt/explorer:latest
```

All the other security headers (HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) are always enforced regardless of `CSP_REPORT_ONLY`.

### Updating Kuzu Explorer

When a new version of Kuzu Explorer is released after the initial launch, re-launching the container WILL NOT automatically update the local image to the latest version. To update the local image to the latest version, you can run the following command.

```bash
docker pull ghcr.io/domvwt/explorer:latest
```

After pulling the latest image, you can re-launch the container with the same command as before.

### Launch with Podman

If you are using [Podman](https://podman.io/) instead of Docker, you can launch Kuzu Explorer by replacing `docker` with `podman` in the commands above. However, note that by default Podman maps the default user account to the `root` user in the container. This may cause permission issues when mounting local database files to the container. To avoid this, you can use the `--userns=keep-id` flag to keep the user ID of the current user inside the container, or enable `:U` option for each volume to change the owner and group of the source volume to the current user.

For example:

```bash
podman run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database:U \
           -e KUZU_FILE={database file name} \
           --rm ghcr.io/domvwt/explorer:latest
```

or,

```bash
podman run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           --userns=keep-id \
           --rm ghcr.io/domvwt/explorer:latest
```

Please refer to the official Podman docs for [mounting external volumes](https://docs.podman.io/en/latest/markdown/podman-run.1.html#mounting-external-volumes) and [user namespace mode](https://https://docs.podman.io/en/latest/markdown/podman-run.1.html#userns-mode) for more information.

## Documentation

For more information regarding launching and using Kuzu Explorer, please refer to the [documentation](https://docs.kuzudb.com).

## Development (with Kuzu compiled from source)

### Stack

- Server
  - [Node.js](https://nodejs.org)
  - [Express.js](https://expressjs.com/)
  - [Kuzu](https://kuzudb.com)
- Client
  - [Vue 3](https://vuejs.org/)
  - [Bootstrap 5](https://getbootstrap.com/docs/5.0/)
  - [Monaco Editor](https://microsoft.github.io/monaco-editor/)
  - [G6](https://github.com/antvis/G6)

### Prerequisite

- [Node.js v20](https://nodejs.org/dist/latest-v20.x/)
- [pnpm](https://pnpm.io/) (this repo uses pnpm as its package manager: `npm install -g pnpm`)
- [JDK 11+](https://jdk.java.net/11/)
- [Toolchain for building Kuzu](https://docs.kuzudb.com/developer-guide/)
- [Git](https://git-scm.com/)

### Environment setup

#### Install Node.js dependencies

```bash
pnpm install
```

#### Download and compile Kuzu

```bash
git submodule update --init --recursive
npm run build-kuzu
```

#### Generate grammar files

```bash
npm run generate-grammar
```

### Run development server (with hot-reloading)

```bash
# Set environment variables
export MODE=READ_ONLY                           # Force read-only mode
export KUZU_DIR=/path/to/database/directory     # Directory containing .kuzu file
export KUZU_FILE=database.kuzu                  # Database filename

# Required for grammar generation
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH=$JAVA_HOME/bin:$PATH

# Switch to Node.js v20 (if using nvm)
source ~/.nvm/nvm.sh && nvm use 20

# Start server
npm run serve
```

**Quick start:** Use the convenience script:
```bash
./scripts/start-dev.sh /path/to/database.kuzu
```

### Check code style with ESLint

```
npm run eslint
```

Include `-fix` for automatic correction of fixable styles.

```
npm run eslint-fix
```

### Security Testing

Run the comprehensive security test suite to validate security features:

```bash
npm run test-security
```

This tests:
- Query validation (blocks CREATE, DROP, DELETE, etc. in READ_ONLY mode)
- Multi-statement query protection
- Comment bypass prevention
- Rate limiting (30 queries/min default)
- Session storage isolation (when DISABLE_SESSION_DB=true)
- Security headers presence (helmet: CSP, HSTS, X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy)

**Prerequisites:**
- Server must be running with security configuration:
  ```bash
  export MODE=READ_ONLY
  export DISABLE_SESSION_DB=true
  export TRUST_PROXY=1                     # trust exactly one reverse-proxy hop (default)
  export QUERY_RATE_LIMIT_MAX_REQUESTS=30  # deterministic limit for the XFF-spoofing test
  npm run serve
  ```
  Note: `npm run serve` sets `NODE_ENV=development`, which relaxes the query rate
  limit to 500/min. The XFF-spoofing test reads the effective limit from the
  `RateLimit-Limit` header and will SKIP (not fail) if the limit is impractically
  large, so setting `QUERY_RATE_LIMIT_MAX_REQUESTS=30` keeps that test fast and
  deterministic.
- `jq` must be installed: `sudo apt install jq`

> **Security note on `TRUST_PROXY`.** This app derives the client IP for
> per-IP rate limiting from the `X-Forwarded-For` (XFF) header. `TRUST_PROXY`
> is the number of reverse-proxy hops to trust and is **always normalised to a
> finite hop count** (never "trust the whole chain"). The default of `1` trusts
> exactly one hop — the nginx directly in front — so Express uses the
> right-most XFF entry set by that trusted proxy and a client cannot rotate a
> spoofed left-most XFF value to bypass rate limits. Use `TRUST_PROXY=false` to
> disable trust entirely (`req.ip` becomes the raw socket address). **The app
> must sit behind exactly the trusted proxy and must not be exposed directly to
> the internet.**

## Troubleshooting

### Kuzu Submodule Initialization Hangs

If `git submodule update --init --recursive` times out or takes too long:

```bash
# Clean and use shallow clone instead
git submodule deinit -f kuzu
rm -rf .git/modules/kuzu
git submodule update --init --depth 1
```

### Monaco Editor Font Issues

**Problem:** Webpack error about missing `codicon.ttf`

**Solution:** The project pins `monaco-editor@0.39.0` in package.json. If you see font errors:

```bash
pnpm add monaco-editor@0.39.0
```

**Note:** Do NOT upgrade monaco-editor to v0.41.0+ as it removes embedded fonts.

### Java Version Issues

**Problem:** ANTLR grammar generation fails with "UnsupportedClassVersionError"

**Solution:** Use Java 21 (not just JDK 11+):

```bash
# Check Java version
java -version

# If needed, set Java 21
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH=$JAVA_HOME/bin:$PATH
```

### SQLite3 Binding Errors

**Problem:** "Cannot find module 'node_sqlite3.node'" after switching Node.js versions

**Solution:** Rebuild SQLite3 for your current Node version:

```bash
source ~/.nvm/nvm.sh && nvm use 20
npm rebuild sqlite3
```

### Node.js Version Issues

This project requires **Node.js v20**. If you encounter module loading errors:

```bash
# Check current version
node --version

# Switch to v20 (using nvm)
nvm install 20
nvm use 20
```

## Legal / go-live checklist (required before public deploy)

The public deployment must present a complete UK GDPR **Article 14 privacy notice** (the `/privacy` page, reachable
from the header) and a per-result data-quality disclaimer. The deploy-time values for that notice live in **one place**:
the `LEGAL` block in **`src/config/legal.config.js`**.

Before a production build, complete every value still marked `[SET AT DEPLOY]`:

| `LEGAL` key        | What to set                                              | Art. 14 basis            |
| ------------------ | ------------------------------------------------------- | ------------------------ |
| `OPERATOR_NAME`    | Controller's real legal identity (person or company)    | 14(1)(a)                 |
| `CONTACT_EMAIL`    | Working contact inbox for data-subject / error requests | 14(1)(a)/(b)             |
| `HOSTING_PROVIDER` | Hosting processor's name                                | 14(1)(e)                 |
| `HOSTING_REGION`   | Hosting region **+ transfer basis if outside the UK**   | 14(1)(f)                 |
| `EFFECTIVE_DATE`   | The notice's effective date                             | —                        |
| `REFRESH_CADENCE`  | How often the data copy is refreshed (e.g. monthly)     | 14(2)(a)                 |

> **A production build (`npm run build`) hard-fails** if any of these still holds a `[SET AT DEPLOY]` placeholder or the
> contact email is malformed — the guard in `vue.config.js` refuses to produce a bundle, so an incomplete legal notice
> can never be shipped. Development (`npm run serve`) is unaffected.

`LAST_REVIEWED` in the same `LEGAL` block holds a real date ("Last reviewed: …" on the notice) rather than a
`[SET AT DEPLOY]` placeholder, so it is **not** enforced by the guard. Review and update it by hand whenever the notice
is materially changed, so the rendered date does not silently go stale.

## Build and serve for production

### Run production server locally

```bash
npm run build
env KUZU_DIR={directory containing kuzu database} KUZU_FILE={database file name} npm run serve-prod
```

### Run production server with Docker

```
docker build -t ghcr.io/domvwt/explorer:latest .
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           --rm ghcr.io/domvwt/explorer:latest
```

## Deployment

A [GitHub actions pipeline](.github/workflows/build-and-deploy.yml) has been configured to automatically build and deploy
the Docker image to [Docker Hub](https://hub.docker.com/) upon pushing to the master branch. The pipeline will build images
for both `amd64` and `arm64` platforms.

## Contributing

We welcome contributions to Kuzu Explorer. By contributing to Kuzu Explorer, you agree that your contributions will be licensed under the [MIT License](LICENSE).
