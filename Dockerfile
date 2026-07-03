FROM node:20-bookworm-slim

ARG SKIP_GRAMMAR=false
ARG SKIP_BUILD_APP=false
ARG SKIP_DATASETS=false

ENV DEBIAN_FRONTEND=noninteractive
RUN echo "SKIP_GRAMMAR: $SKIP_GRAMMAR"
RUN echo "SKIP_BUILD_APP: $SKIP_BUILD_APP"
RUN echo "SKIP_DATASETS: $SKIP_DATASETS"
RUN apt-get update && apt-get install -y libatomic1

# Install dependencies
RUN if [ "$SKIP_GRAMMAR" != "true" ] ; then apt-get update && apt-get install -y openjdk-17-jdk ; else echo "Skipping openjdk installation as grammar generation is skipped" ; fi
RUN if [ "$SKIP_DATASETS" != "true" ] ; then apt-get update && apt-get install -y git ; else echo "Skipping git installation as dataset fetch is skipped" ; fi
# Copy app
COPY . /home/node/app
RUN chown -R node:node /home/node/app

# Make data and database directories
RUN mkdir -p /database
RUN mkdir -p /data
RUN chown -R node:node /database
RUN chown -R node:node /data

# Switch to node user
USER node

# Set working directory
WORKDIR /home/node/app

# Install pnpm
RUN npm install -g pnpm

# Install dependencies, generate grammar, and reduce size of kuzu node module
# Done in one step to reduce image size
RUN pnpm install --frozen-lockfile &&\
    if [ "$SKIP_GRAMMAR" != "true" ] ; then npm run generate-grammar-prod ; else echo "Skipping grammar generation" ; fi &&\
    rm -rf node_modules/kuzu/prebuilt node_modules/kuzu/kuzu-source

# Fetch datasets
RUN if [ "$SKIP_DATASETS" != "true" ] ; then npm run fetch-datasets ; else echo "Skipping dataset fetch" ; fi

# Build app
RUN if [ "$SKIP_BUILD_APP" != "true" ] ; then npm run build ; else echo "Skipping build" ; fi

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

# Run app
ENTRYPOINT ["node", "src/server/index.js"]
