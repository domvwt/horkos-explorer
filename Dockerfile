# syntax=docker/dockerfile:1

# =============================================================================
# Builder stage
# -----------------------------------------------------------------------------
# Installs the full toolchain (JDK for grammar generation, dev + prod node
# deps) and produces the built frontend (dist/) plus a pruned, production-only
# node_modules. Nothing from this stage's toolchain ships in the runtime image
# except the artifacts explicitly COPY --from=builder'd below.
# =============================================================================
FROM node:20-bookworm-slim AS builder

ARG SKIP_GRAMMAR=false
ARG SKIP_BUILD_APP=false

ENV DEBIAN_FRONTEND=noninteractive
RUN echo "SKIP_GRAMMAR: $SKIP_GRAMMAR"
RUN echo "SKIP_BUILD_APP: $SKIP_BUILD_APP"

# libatomic1: runtime dep of the kuzu native addon (kuzujs.node).
RUN apt-get update && apt-get install -y libatomic1

# openjdk-17: only needed by `generate-grammar-prod` (antlr4ng-cli runs the
# ANTLR jar). Skipped when grammar generation is skipped so no JDK is pulled.
RUN if [ "$SKIP_GRAMMAR" != "true" ] ; then apt-get update && apt-get install -y openjdk-17-jdk ; else echo "Skipping openjdk installation as grammar generation is skipped" ; fi

# Install pnpm globally as root (the `node` user cannot write to
# /usr/local/lib/node_modules). Matches the repo's documented
# `npm install -g pnpm`.
RUN npm install -g pnpm

# Copy app source into the build tree.
COPY . /home/node/app
RUN chown -R node:node /home/node/app

# Switch to node user for the install/build (matches runtime user).
USER node
WORKDIR /home/node/app

# Install deps, generate grammar, and drop kuzu's per-platform prebuilt copies
# and vendored source (the active native addon is node_modules/kuzu/kuzujs.node
# at the package root, which is NOT under prebuilt/ or kuzu-source/, so it
# survives this rm). Done in one layer to keep the builder image lean.
RUN pnpm install --frozen-lockfile &&\
    if [ "$SKIP_GRAMMAR" != "true" ] ; then npm run generate-grammar-prod ; else echo "Skipping grammar generation" ; fi &&\
    rm -rf node_modules/kuzu/prebuilt node_modules/kuzu/kuzu-source

# Build the frontend bundle into dist/. `mkdir -p dist` first so the runtime
# stage's `COPY .../dist` always has a directory to copy even on a
# SKIP_BUILD_APP=true probe build (a real build fills it; express.static over an
# empty dist simply 404s static assets and the server still boots).
RUN mkdir -p dist &&\
    if [ "$SKIP_BUILD_APP" != "true" ] ; then npm run build ; else echo "Skipping build" ; fi

# Prune dev-only dependencies AFTER the build has consumed them, leaving a
# production-only node_modules to copy into the runtime stage.
#
# `pnpm prune --prod` (not a fresh `pnpm install --prod`) is deliberate: prune
# only removes dev-only packages from the existing tree and does NOT re-run any
# package's install/postinstall script. kuzu has a postinstall (install.js)
# that copies prebuilt/kuzujs-<platform>-<arch>.node -> kuzujs.node and needs
# both prebuilt/ and kuzu-source/ present; a fresh `--prod` install would
# re-trigger it, find the (already-removed) prebuilt gone, and fall into the
# ~10-minute build-from-source path. Prune sidesteps that entirely: the
# already-built kuzujs.node is preserved and the rm above stays effective.
RUN pnpm prune --prod

# =============================================================================
# Runtime stage
# -----------------------------------------------------------------------------
# A minimal production image: no JDK, no devDependencies (no webpack /
# @vue/cli-service), only the built app plus production node_modules.
# =============================================================================
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# libatomic1: runtime dep of the kuzu native addon. No JDK here.
RUN apt-get update && apt-get install -y libatomic1 && rm -rf /var/lib/apt/lists/*

# Data/database mount points, owned by the unprivileged node user. The app
# expects a Kuzu database to be bind-mounted at /database at runtime.
RUN mkdir -p /database /data && chown -R node:node /database /data

WORKDIR /home/node/app

# Copy only what the server needs at runtime, all owned by node:
#   - package.json: read by Node for module resolution / metadata.
#   - node_modules: production-only tree from the builder (pnpm's .pnpm store
#     symlinks are relative, so a full-directory COPY preserves them). Includes
#     the built kuzu native addon (kuzujs.node).
#   - dist/: the built frontend served as static assets.
#   - src/: the server code. Only src/server is required at runtime (its
#     ../utils requires resolve to src/server/utils); the full src tree is
#     copied for simplicity.
COPY --from=builder --chown=node:node /home/node/app/package.json ./package.json
COPY --from=builder --chown=node:node /home/node/app/node_modules ./node_modules
COPY --from=builder --chown=node:node /home/node/app/dist ./dist
COPY --from=builder --chown=node:node /home/node/app/src ./src

USER node

# Expose port
EXPOSE 8000

# Set environment variables
# MODE and DISABLE_SESSION_DB default to safe (read-only, stateless) settings.
# Operators must explicitly opt in to write mode, e.g. `-e MODE=READ_WRITE`.
ENV NODE_ENV=production
ENV PORT=8000
ENV KUZU_DIR=/database
ENV MODE=READ_ONLY
ENV DISABLE_SESSION_DB=true
# Default DoS guardrails for the public /api/cypher endpoint. Both are
# operator-overridable at runtime (e.g. `-e KUZU_QUERY_TIMEOUT=60000`).
# KUZU_QUERY_TIMEOUT: per-query wall-clock bound (ms) applied to every pooled
#   connection, so a single expensive query cannot run indefinitely.
# KUZU_QUERY_SIZE_LIMIT: max result rows returned per query, so a broad
#   MATCH...RETURN cannot stream the entire graph in one response.
ENV KUZU_QUERY_TIMEOUT=30000
ENV KUZU_QUERY_SIZE_LIMIT=10000

# Ship the Content-Security-Policy in enforcing mode. The derived policy was
# validated against the real frontend (Monaco workers, Bootstrap inline
# styles, G6 data:/blob: images) with no violations, so the browser should
# enforce it rather than only report. Set CSP_REPORT_ONLY=true
# to fall back to report-only if a future frontend change needs re-validating.
ENV CSP_REPORT_ONLY=false

# Container-level liveness probe. Uses Node's built-in fetch (Node 18+) so no
# curl/wget is needed in the image. Reads PORT from the environment so an
# operator PORT override does not break the probe. The /health route is mounted
# before the /api router and never touches Kuzu/DuckDB, so this is a pure
# liveness check. Also reads BASE_URL (src/server/utils/BaseURL.js, default
# "/") since index.js mounts the route at `${baseUrl}health`, not a hardcoded
# root path - an operator re-rooting the app with BASE_URL would otherwise
# leave this probe checking a path that no longer exists.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "const p=process.env.PORT||8000; const b=process.env.BASE_URL||'/'; fetch('http://127.0.0.1:'+p+b+'health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run app
ENTRYPOINT ["node", "src/server/index.js"]
