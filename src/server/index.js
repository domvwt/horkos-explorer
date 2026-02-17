const express = require("express");
const cors = require("cors");
const api = require("./API");
const path = require("path");
const process = require("process");
const database = require("./utils/Database");
const duckdb = require("./utils/DuckDB");
const logger = require("./utils/Logger");
const baseUrl = require("./utils/BaseURL");

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

// Trust proxy for rate limiting when behind nginx/reverse proxy
// This enables req.ip to contain the real client IP from X-Forwarded-For header
const trustProxy = process.env.TRUST_PROXY
  ? process.env.TRUST_PROXY.toLowerCase() === "true"
  : true; // Default to true for production deployments

if (trustProxy) {
  app.set('trust proxy', true);
  logger.info("Trust proxy enabled - will use X-Forwarded-For for client IP");
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
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8000;
app.use(express.json({ limit: "128mb" }));
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
