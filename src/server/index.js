const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
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

// Trust proxy configuration (security-critical for rate limiting)
//
// Express uses the `trust proxy` setting to derive req.ip from the
// X-Forwarded-For (XFF) header, and express-rate-limit keys per-IP buckets on
// req.ip. Setting `trust proxy` to boolean `true` trusts the ENTIRE XFF chain,
// which makes Express take the LEFT-MOST (client-supplied) XFF entry as req.ip.
// A malicious client can then rotate a fake XFF value on every request,
// presenting a new "IP" each time and completely bypassing the per-IP rate
// limits (the primary DoS/scraping control). express-rate-limit explicitly
// warns against a permissive trust-proxy for this reason.
//
// The safe configuration is to trust a SPECIFIC number of proxy hops. This
// deployment is designed to sit behind exactly ONE trusted reverse proxy
// (nginx) that appends the real client IP to XFF. Trusting one hop makes
// Express use the RIGHT-MOST XFF entry (the value written by our trusted
// nginx), so any client-supplied left entries are ignored and cannot rotate
// req.ip. The app MUST NOT be exposed directly to the internet.
//
// Env semantics (TRUST_PROXY / TRUST_PROXY_HOPS):
//   - TRUST_PROXY unset            -> trust TRUST_PROXY_HOPS hops (default 1)
//   - TRUST_PROXY=true / on        -> trust TRUST_PROXY_HOPS hops (default 1).
//                                     No longer means "trust the whole chain" --
//                                     it is normalised to a finite hop count to
//                                     prevent XFF spoofing.
//   - TRUST_PROXY=<n> (numeric)    -> trust exactly N hops (TRUST_PROXY_HOPS is
//                                     ignored in this case)
//   - TRUST_PROXY=false / 0 / off  -> disable; req.ip is the raw socket address
//                                     (use when app is directly exposed with no
//                                     proxy in front)
//
// The hop count is clamped to a small ceiling (MAX_TRUST_PROXY_HOPS): a count
// far exceeding the real proxy chain makes proxy-addr walk left to the
// client-supplied XFF entry, re-opening the exact spoofing bypass this closes.
const MAX_TRUST_PROXY_HOPS = 10;
const rawTrustProxy = (process.env.TRUST_PROXY || "").trim().toLowerCase();
const trustProxyHops = Number.isInteger(parseInt(process.env.TRUST_PROXY_HOPS, 10))
  ? parseInt(process.env.TRUST_PROXY_HOPS, 10)
  : 1; // Default: a single trusted reverse proxy (nginx) directly in front

let trustProxySetting;
if (rawTrustProxy === "false" || rawTrustProxy === "0" || rawTrustProxy === "off") {
  trustProxySetting = false; // Explicitly disabled
} else if (/^\d+$/.test(rawTrustProxy)) {
  trustProxySetting = parseInt(rawTrustProxy, 10); // Explicit numeric hop count
} else {
  if (rawTrustProxy !== "" && rawTrustProxy !== "true" && rawTrustProxy !== "on") {
    // m-B: an unrecognised value (e.g. "flase" typo) must not silently pass.
    logger.warn(`TRUST_PROXY value "${process.env.TRUST_PROXY}" is not recognised (expected true/on/false/off/0 or a hop count); falling back to the default of ${trustProxyHops} hop(s)`);
  }
  // Unset, "true", "on", or an unrecognised value -> finite hop count.
  // Never boolean true (which would trust the whole spoofable XFF chain).
  trustProxySetting = trustProxyHops;
}

// m-A: clamp an unreasonable hop count so it cannot walk to the client-supplied
// left-most XFF entry and re-open the spoofing bypass. Also floor a negative
// count (e.g. a bad TRUST_PROXY_HOPS) at 0, which Express treats as "trust none".
if (typeof trustProxySetting === "number") {
  if (trustProxySetting > MAX_TRUST_PROXY_HOPS) {
    logger.warn(`Trust proxy hop count ${trustProxySetting} exceeds the maximum of ${MAX_TRUST_PROXY_HOPS}; clamping to ${MAX_TRUST_PROXY_HOPS} to prevent X-Forwarded-For spoofing`);
    trustProxySetting = MAX_TRUST_PROXY_HOPS;
  } else if (trustProxySetting < 0) {
    logger.warn(`Trust proxy hop count ${trustProxySetting} is negative; treating as 0 (trust no proxy)`);
    trustProxySetting = 0;
  }
}

// m-C: 0 hops trusts nothing (same effect as disabled); treat it as the disabled
// branch so the log line is accurate rather than claiming a proxy is trusted.
if (trustProxySetting === false || trustProxySetting === 0) {
  logger.info("Trust proxy disabled - req.ip is the direct socket address (do not expose behind a proxy that sets X-Forwarded-For)");
} else {
  app.set('trust proxy', trustProxySetting);
  logger.info(`Trust proxy set to ${trustProxySetting} hop(s) - using the right-most X-Forwarded-For entry from the trusted proxy for client IP (rate limiting is spoofing-resistant)`);
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

// Security headers (defence-in-depth via helmet).
//
// research-notes/README.md assumes these headers arrive "at the nginx level",
// but that is an unenforced assumption: if the reverse proxy is misconfigured
// or bypassed, the app would otherwise ship zero header hardening. Since this
// is a PUBLIC, read-only deployment serving real personal data, we set the
// headers at the APPLICATION layer too, so hardening is present regardless of
// the proxy in front.
//
// CSP enforce-vs-report decision:
//   A too-strict CSP silently breaks the query UI (Monaco editor Web Workers,
//   G6 canvas, Bootstrap inline styles, DuckDB/Kuzu WASM). Because we cannot
//   safely confirm the policy under enforcement without booting the full dev
//   server and driving the browser, the CSP DEFAULTS TO Report-Only mode so
//   the header is emitted (defence-in-depth / telemetry) without risking a
//   broken UI in production. An operator who has validated the app can flip to
//   enforcing mode by setting CSP_REPORT_ONLY=false. All OTHER headers (HSTS,
//   X-Frame-Options, X-Content-Type-Options, Referrer-Policy) are low-risk and
//   are always ENFORCED.
const CSP_REPORT_ONLY = process.env.CSP_REPORT_ONLY
  ? process.env.CSP_REPORT_ONLY.toLowerCase() !== "false"
  : true; // Default: report-only, so a mis-derived CSP cannot break the UI.

app.use(helmet({
  contentSecurityPolicy: {
    // When reportOnly is true, helmet emits Content-Security-Policy-Report-Only
    // (browser reports violations but does NOT block). When false, it emits the
    // enforcing Content-Security-Policy header.
    reportOnly: CSP_REPORT_ONLY,
    // useDefaults:false so we ship EXACTLY the directives below (helmet's
    // defaults include e.g. block-all-mixed-content / upgrade-insecure-requests
    // and a stricter script-src that would break WASM). Every directive beyond
    // default-src is justified inline against actual frontend usage.
    useDefaults: false,
    directives: {
      // Baseline: only same-origin resources unless a directive widens it.
      defaultSrc: ["'self'"],
      // Scripts are served same-origin (webpack bundles + lazily-loaded chunks,
      // Monaco worker files under js/). 'wasm-unsafe-eval' is REQUIRED: browsers
      // gate WebAssembly compilation (DuckDB WASM src/utils/DuckDB.js, Kuzu WASM
      // src/utils/KuzuWasm.js) behind either 'wasm-unsafe-eval' or the far
      // broader 'unsafe-eval'. We deliberately grant only 'wasm-unsafe-eval'
      // and NOT 'unsafe-eval' — no application code calls eval()/new Function().
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      // Web Workers: Monaco editor and DuckDB (new Worker(...) in DuckDB.js) and
      // the Kuzu WASM worker load from same-origin js/ files; blob: is included
      // because Monaco/webpack worker bootstrapping can wrap workers in blob URLs.
      workerSrc: ["'self'", "blob:"],
      // Bootstrap and Monaco inject inline <style>/style attributes at runtime;
      // 'unsafe-inline' for styles is unavoidable for Vue+Bootstrap+Monaco apps.
      styleSrc: ["'self'", "'unsafe-inline'"],
      // FontAwesome / bundled fonts are same-origin; data: covers inline font
      // data URIs some toolkits emit.
      fontSrc: ["'self'", "data:"],
      // Icons/favicons/canvas-derived images are same-origin; data: covers
      // inline SVG/PNG data URIs used by G6 and Bootstrap; blob: covers a
      // future canvas.toBlob()/toDataURL graph-image export (G6) so enforcing
      // the policy later does not silently break a "download graph" feature.
      imgSrc: ["'self'", "data:", "blob:"],
      // XHR/fetch/WebSocket targets: only the app's own API is contacted.
      connectSrc: ["'self'"],
      // No <object>/<embed>/<applet> — eliminate a legacy plugin attack surface.
      objectSrc: ["'none'"],
      // Anti-clickjacking: forbid the app being framed anywhere (pairs with the
      // X-Frame-Options header helmet also sets for legacy browsers).
      frameAncestors: ["'none'"],
      // Restrict <base href> so injected markup cannot repoint relative URLs.
      baseUri: ["'self'"],
      // Forms may only POST back to same-origin (the query API).
      formAction: ["'self'"],
    },
  },
  // HSTS: helmet's default (max-age 365 days = 31536000s, includeSubDomains).
  // The app may be served over plain HTTP behind nginx-terminated TLS; that is
  // fine because browsers ignore Strict-Transport-Security received over HTTP
  // and only honour it over HTTPS, so this is safe to always enable.
  // The remaining defaults are enforced as-is: X-Content-Type-Options: nosniff,
  // Referrer-Policy: no-referrer, and X-Frame-Options: SAMEORIGIN (the CSP
  // frame-ancestors 'none' above is the primary, stronger anti-clickjacking
  // control in modern browsers). Helmet 8 also emits Cross-Origin-Opener-Policy
  // and Cross-Origin-Resource-Policy (both same-origin) and Origin-Agent-Cluster;
  // these are safe here because the app and all its resources are same-origin and
  // it never takes a cross-origin-isolated / SharedArrayBuffer path.
}));
logger.info(
  `Security headers enabled (helmet); CSP mode: ${CSP_REPORT_ONLY ? "report-only" : "enforce"}`
);

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
