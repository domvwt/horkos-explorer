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
           --rm kuzudb/explorer:latest
```

By mounting local database files to Docker via `-v {path to the directory containing the database file}` and `-e KUZU_FILE={database file name}`, the changes done in the UI will persist to the local database files after the UI is shutdown. If the directory is mounted but the `KUZU_FILE` environment variable is not set, Kuzu Explorer will look for a file named `database.kz` in the mounted directory or create a new database file named `database.kz` in the mounted directory if it does not exist.

The `--rm` flag tells docker that the container should automatically be removed after we close docker.

### Option 2: Start with an empty database with example data

You can also launch Kuzu Explorer without specifying an existing database. Kuzu Explorer comes with
bundled datasets that you can use to explore the basic functionalities of Kuzu.
This is simply done by removing the `-v` flag in the example above. If no database path is specified
with `-v`, the server will be started with an empty database.

```bash
docker run -p 8000:8000 --rm kuzudb/explorer:latest
```

Click on the `Datasets` tab on the top right corner and then: (i) you can select one of the bundled dataset
of your choice from the drow-down menu; (ii) load it into Kuzu by clicking the "Load Dataset" button; and (iii)
finally use Kuzu Explorer to explore it.

### Additional launch configurations

#### Access mode

By default, Horkos Explorer is launched in read-only, stateless mode (`MODE=READ_ONLY` and `DISABLE_SESSION_DB=true`): you can issue read queries and visualize the results, but you cannot run write queries, modify the schema, or persist session state server-side. This is the safe default for public deployments and does not require any operator-supplied environment variables.

If you want to launch Horkos Explorer in read-write mode, you can opt in by setting the `MODE` environment variable to `READ_WRITE` as follows.

```bash
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           -e MODE=READ_WRITE \
           --rm kuzudb/explorer:latest
```

#### Buffer pool size

By default, Kuzu Explorer is launched with a maximum buffer pool size of 80% of the available memory. If you want to launch Kuzu Explorer with a different buffer pool size, you can do so by setting the `KUZU_BUFFER_POOL_SIZE` environment variable to the desired value in bytes as follows.

For example, to launch Kuzu Explorer with a buffer pool size of 1GB, you can run the following command.

```bash
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           -e KUZU_BUFFER_POOL_SIZE=1073741824 \
           --rm kuzudb/explorer:latest
```

#### In-memory mode

By default, Kuzu Explorer is launched in disk-based mode. If you want to launch Kuzu Explorer in in-memory mode, you can do so by setting the `KUZU_IN_MEMORY` environment variable to `true` as follows.

```bash
docker run -p 8000:8000 \
           -e KUZU_IN_MEMORY=true \
           --rm kuzudb/explorer:latest
```

In in-memory mode, the database is stored in memory and all changes are lost when the server is shut down even if a database directory is mounted. Also, read-only access mode is not supported in in-memory mode.

#### WebAssembly mode

In WebAssembly mode, Kuzu Explorer is launched with `kuzu-wasm`, which runs all the queries directly in browser. If you want to launch Kuzu Explorer in WebAssembly mode, you can do so by setting the `KUZU_WASM` environment variable to `true` as follows.

```bash
docker run -p 8000:8000 \
           -e KUZU_WASM=true \
           --rm kuzudb/explorer:latest
```

In WebAssembly mode, the database is stored in the current browser session and all changes are lost when the browser tab is closed or when the tab is refreshed. All other configuration parameters are ignored in WebAssembly mode.

#### Dev builds

If you want to launch Kuzu Explorer with the latest development build of Kuzu, you can do so by using the `dev` tag instead of `latest`.

```bash
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           --rm kuzudb/explorer:dev
```

The `dev` tag is updated daily, approximately two hours after the latest dev build of Kuzu is released.

### Updating Kuzu Explorer

When a new version of Kuzu Explorer is released after the initial launch, re-launching the container WILL NOT automatically update the local image to the latest version. To update the local image to the latest version, you can run the following command.

```bash
docker pull kuzudb/explorer:latest
```

After pulling the latest image, you can re-launch the container with the same command as before.

### Launch with Podman

If you are using [Podman](https://podman.io/) instead of Docker, you can launch Kuzu Explorer by replacing `docker` with `podman` in the commands above. However, note that by default Podman maps the default user account to the `root` user in the container. This may cause permission issues when mounting local database files to the container. To avoid this, you can use the `--userns=keep-id` flag to keep the user ID of the current user inside the container, or enable `:U` option for each volume to change the owner and group of the source volume to the current user.

For example:

```bash
podman run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database:U \
           -e KUZU_FILE={database file name} \
           --rm kuzudb/explorer:latest
```

or,

```bash
podman run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           --userns=keep-id \
           --rm kuzudb/explorer:latest
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
- [JDK 11+](https://jdk.java.net/11/)
- [Toolchain for building Kuzu](https://docs.kuzudb.com/developer-guide/)
- [Git](https://git-scm.com/)

### Environment setup

#### Install Node.js dependencies

```bash
npm i
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

#### Fetch datasets

```bash
npm run fetch-datasets
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

**Prerequisites:**
- Server must be running with security configuration:
  ```bash
  export MODE=READ_ONLY
  export DISABLE_SESSION_DB=true
  export TRUST_PROXY=true
  npm run serve
  ```
- `jq` must be installed: `sudo apt install jq`

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
npm install monaco-editor@0.39.0
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
docker build -t kuzudb/explorer:latest .
docker run -p 8000:8000 \
           -v {path to the directory containing the database file}:/database \
           -e KUZU_FILE={database file name} \
           --rm kuzudb/explorer:latest
```

## Deployment

A [GitHub actions pipeline](.github/workflows/build-and-deploy.yml) has been configured to automatically build and deploy
the Docker image to [Docker Hub](https://hub.docker.com/) upon pushing to the master branch. The pipeline will build images
for both `amd64` and `arm64` platforms.

## Contributing

We welcome contributions to Kuzu Explorer. By contributing to Kuzu Explorer, you agree that your contributions will be licensed under the [MIT License](LICENSE).
