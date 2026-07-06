const express = require("express");
const cors = require("cors");
const api = require("./API");
const path = require("path");
const process = require("process");
const database = require("./utils/Database");
const duckdb = require("./utils/DuckDB");
const logger = require("./utils/Logger");
const baseUrl = require("./utils/BaseURL");
const applyAppSecurity = require("./middleware/AppSecurity");

// CORS configuration
// Supports two modes:
// 1. CROSS_ORIGIN=true - Enable CORS for all origins (legacy, not recommended for production)
// 2. ALLOWED_ORIGINS=domain1.com,domain2.com - Whitelist specific origins (recommended)
const CROSS_ORIGIN = process.env.CROSS_ORIGIN
  ? process.env.CROSS_ORIGIN.toLowerCase() === "true"
  : false;

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

// Last-resort safety net: any promise rejection that escapes a route handler
// or async callback would, under Node's default, terminate the process (and,
// on Express 4.x, leave the client hanging). Log it and keep serving so one
// unguarded async path cannot take the whole server down. Individual handlers
// still catch their own errors and send a proper response (see State.js et al.).
process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : reason;
  logger.error(`Unhandled promise rejection (ignored to keep server alive): ${detail}`);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, exiting");
  duckdb.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, exiting");
  duckdb.close();
  process.exit(0);
});

const app = express();

// Apply CORS configuration
if (ALLOWED_ORIGINS && ALLOWED_ORIGINS.length > 0) {
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: false,
    methods: ['GET', 'POST', 'DELETE']
  }));
  logger.info(`CORS enabled for origins: ${ALLOWED_ORIGINS.join(', ')}`);
} else if (CROSS_ORIGIN) {
  app.use(cors());
  logger.info("CORS enabled for all origins");
}

// App-level security hardening (trust-proxy normalisation, helmet security
// headers, X-Robots-Tag). Shared with the webpack dev server (Configure.js) so
// dev and prod mount identical app-level hardening; see middleware/AppSecurity.js
// for the full rationale (CSP enforce-vs-report, trust-proxy hop clamping, etc.).
applyAppSecurity(app);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8000;
// JSON request-body cap. This is a DoS guardrail, not a data path: the largest
// legitimate JSON body is a Cypher query (already capped at 50KB by
// QueryValidator) or an import plan config (small). Bulk CSV/Parquet uploads for
// the importer go through multer's multipart/disk handling (src/server/Import.js)
// and do NOT pass through this parser, so a small limit here does not break
// import. Operators can override via the JSON_BODY_LIMIT env var if needed.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(`${baseUrl}api`, api);
const distPath = path.join(__dirname, "..", "..", "dist");
app.use(`${baseUrl}`, express.static(distPath, { maxAge: "30d" }));

const isWasmMode = process.env.KUZU_WASM &&
  process.env.KUZU_WASM.toLowerCase() === "true";

// Initialize DuckDB for autocomplete (optional - gracefully degrades if not configured)
duckdb.init();

if (!isWasmMode) {
  database.getDbVersion()
    .then((res) => {
      const version = res.version;
      const storageVersion = res.storageVersion;
      const isInitialDatabaseEmpty = database.isInitialDatabaseEmpty;
      logger.info("Version of Kuzu: " + version);
      logger.info("Storage version of Kuzu: " + storageVersion);
      if (!isInitialDatabaseEmpty && version.includes("dev")) {
        logger.warn("You are running a dev build of Kuzu Explorer. Please make sure that the database files opened are created by the same version of Kuzu");
      }
      app.listen(PORT, () => {
        logger.info("Deployed server started on port: " + PORT);
      });
    })
    .catch((err) => {
      logger.error("Error getting version of Kuzu: " + err);
    });
} else {
  app.listen(PORT, () => {
    logger.info("Deployed server started on port: " + PORT);
  });
}
