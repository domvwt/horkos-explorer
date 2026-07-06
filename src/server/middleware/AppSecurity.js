const helmet = require("helmet");
const logger = require("../utils/Logger");

/**
 * App-level security hardening (shared between prod and dev entry points).
 *
 * Mounts, in order, the middleware that must behave identically under both the
 * production server (index.js) and the webpack dev server (Configure.js):
 *   1. trust-proxy normalisation + clamp (so req.ip — and every rate-limit /
 *      row-budget key derived from it — resolves the same way in dev and prod)
 *   2. helmet security headers (CSP + HSTS + the rest), defence-in-depth
 *   3. the X-Robots-Tag anti-indexing header
 *
 * Per-route security (rate limiters, QueryValidator, RowBudget) is NOT here: it
 * already runs under both entry points via the shared ./API router. Only this
 * app-level hardening previously diverged between the two entry points.
 *
 * Callers keep their own body-parser cap (express.json) and router mount AFTER
 * calling this; trust-proxy is set here first so anything that keys on req.ip
 * sees the normalised value.
 *
 * @param {import('express').Express} app - the Express app to harden.
 */
function applyAppSecurity(app) {
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

  // Anti-indexing: this is a public deployment over real personal data. Tag every
  // response (HTML pages, static assets, and JSON API responses alike) so search
  // engines and the Internet Archive neither index nor cache/persist any content.
  // Paired with public/robots.txt (Disallow: /), this defends both crawl entry
  // points and any URL discovered out-of-band.
  app.use((req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, noarchive");
    next();
  });
}

module.exports = applyAppSecurity;
