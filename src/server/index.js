const express = require("express");
const cors = require("cors");
const compression = require("compression");
const api = require("./API");
const path = require("path");
const process = require("process");
const database = require("./utils/Database");
const duckdb = require("./utils/DuckDB");
const logger = require("./utils/Logger");
const baseUrl = require("./utils/BaseURL");
const applyAppSecurity = require("./middleware/AppSecurity");
const globalErrorHandler = require("./middleware/ErrorHandler");
const { setStaticCacheHeaders } = require("./utils/staticCache");

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

// Keep-alive tuning for every app.listen() call below. headersTimeout MUST
// exceed keepAliveTimeout (Node requirement: a connection reused within the
// keep-alive window still needs room to send its next request's headers
// before the stricter headers timeout would fire on it).
function applyKeepAlive(server) {
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return server;
}

// Apply CORS configuration
if (ALLOWED_ORIGINS && ALLOWED_ORIGINS.length > 0) {
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        const corsError = new Error('Not allowed by CORS');
        // Marker property so the global error handler can map this to 403
        // without matching on message text (see middleware/ErrorHandler.js).
        corsError.isCorsRejection = true;
        callback(corsError);
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

// Compress response bodies (gzip/brotli per Accept-Encoding) before routes and
// static files, so both API JSON and static assets benefit. Default filter
// (skips already-compressed/small responses) and threshold are fine here.
app.use(compression());

// Liveness probe: mounted directly on the app, BEFORE the /api router, so it
// never passes through any rate limiter and never touches Kuzu/DuckDB - a
// probe that depended on the DB or a limiter could itself be starved or used
// to infer DB health from outside.
app.get(`${baseUrl}health`, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8000;
// JSON request-body cap. This is a DoS guardrail, not a data path: the largest
// legitimate JSON body is a Cypher query (already capped at 50KB by
// QueryValidator). Operators can override via the JSON_BODY_LIMIT env var if
// needed.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(`${baseUrl}api`, api);
const distPath = path.join(__dirname, "..", "..", "dist");
// Cache-Control is split by asset kind (see utils/staticCache.js): HTML is
// always revalidated, webpack content-hashed js/css are cached for a year,
// everything else (fonts/unhashed files) gets a short ceiling. maxAge:0
// is the base so setStaticCacheHeaders is the single source of truth for the
// actual Cache-Control value; ETags stay on (express.static default).
app.use(`${baseUrl}`, express.static(distPath, {
  maxAge: 0,
  setHeaders: setStaticCacheHeaders,
}));

// Global JSON error handler. Must be mounted LAST (after the /api router and
// static middleware) so it catches errors from every route/middleware above,
// including body-parser failures and the CORS rejection wired above.
app.use(globalErrorHandler);

// Initialize DuckDB for autocomplete (optional - gracefully degrades if not configured)
duckdb.init();

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
    applyKeepAlive(app.listen(PORT, () => {
      logger.info("Deployed server started on port: " + PORT);
    }));
  })
  .catch((err) => {
    logger.error("Error getting version of Kuzu: " + err);
  });
