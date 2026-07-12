const { ipKeyGenerator } = require("express-rate-limit");
const logger = require("../utils/Logger");
const MODES = require("../utils/Constants").MODES;

/**
 * Per-IP Row Budget
 *
 * Anti-bulk-scrape control for /api/cypher. The result-size cap in Cypher.js
 * bounds a SINGLE response (KUZU_QUERY_SIZE_LIMIT rows) and the query rate
 * limiter bounds the number of REQUESTS per window, but neither bounds the
 * CUMULATIVE volume one client can paginate out across many requests. A query
 * such as `... ORDER BY p.id SKIP $n LIMIT 10000`, repeated at the request rate
 * limit, drains hundreds of thousands of rows/minute from one IP while staying
 * inside both existing controls.
 *
 * This module maintains a cross-request, per-IP budget of rows shipped within a
 * fixed time window. Cypher.js pre-checks the budget before touching the
 * connection pool and debits the ACTUAL number of rows shipped (post-cap) on the
 * success path. When the budget is exhausted the request is rejected with a 429
 * until the window resets.
 *
 * SCOPE / CONSTRAINTS:
 *   - Admit-then-debit: the budget is checked before the query runs and debited
 *     after, so a single request can overshoot by at most (querySizeLimit - 1)
 *     rows. Worst-case cumulative total = budget + querySizeLimit - 1.
 *   - In-process, single-replica: state lives in this process's memory and is
 *     lost on restart. Multiple replicas each hold an independent budget; a
 *     multi-replica deployment would need a shared store or IP-sticky routing to
 *     bound the aggregate. This mirrors the express-rate-limit MemoryStore.
 *
 * KEY DERIVATION:
 *   The key is derived with express-rate-limit's ipKeyGenerator(req.ip). req.ip
 *   is already trust-proxy-normalised (right-most X-Forwarded-For entry written
 *   by the trusted nginx — see index.js), so it is the SAME spoofing-resistant
 *   IP resolution the rate limiter uses; a client cannot reset its budget by
 *   rotating a spoofed left-most XFF. ipKeyGenerator additionally applies the
 *   default IPv6 /56 subnet mask, so an IPv6 client cannot rotate addresses
 *   inside its prefix to reset the budget. Never key on raw header values.
 */

// Fail-closed defaults: if QUERY_ROW_BUDGET / QUERY_ROW_BUDGET_WINDOW_MS are
// unset or invalid (non-numeric / zero / negative) they fall back to a safe
// finite bound — NEVER "disabled" — so a misconfigured env var cannot silently
// remove the control. Same convention as KUZU_QUERY_SIZE_LIMIT in Cypher.js.
//
// The dev default is relaxed by 100x (mirroring RateLimit.js) so hot-reload
// development never trips the budget. NODE_ENV=production in the shipped image
// (Dockerfile) means the prod default applies in deployment.
const isDevelopment = process.env.NODE_ENV === "development";
const DEFAULT_ROW_BUDGET = isDevelopment ? 10000000 : 100000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

function parsePositiveInt(raw, fallback) {
  const parsed = parseInt(raw, 10);
  // Treat unset / non-numeric / zero / negative as invalid and fall back to the
  // safe default, so the budget always enforces a finite bound.
  return !isNaN(parsed) && parsed > 0 ? parsed : fallback;
}

const rowBudget = parsePositiveInt(process.env.QUERY_ROW_BUDGET, DEFAULT_ROW_BUDGET);
const windowMs = parsePositiveInt(
  process.env.QUERY_ROW_BUDGET_WINDOW_MS,
  DEFAULT_WINDOW_MS
);

// Bound memory against a wide botnet: cap the number of tracked keys. On
// overflow, evict the entry with the oldest windowStart first (closest to
// resetting anyway). 100k keys is generous for a single-replica deployment.
const MAX_ENTRIES = 100000;

// How often to sweep expired entries. .unref() so the timer never keeps the
// process alive on its own.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

if (process.env.NODE_ENV !== "test") {
  logger.info("Row budget configuration:");
  logger.info(`  Row budget: ${rowBudget} rows per ${windowMs / 1000}s per IP`);
}

// key -> { used, windowStart }
const store = new Map();

/**
 * Derive the per-IP budget key from req.ip using the same spoofing-resistant
 * resolution as express-rate-limit (right-most trusted XFF + IPv6 /56 mask).
 * @param {import('express').Request} req
 * @returns {string}
 */
function keyForRequest(req) {
  return ipKeyGenerator(req.ip);
}

/**
 * Fetch a live entry for `key`, applying a lazy fixed-window reset: if the
 * entry's window has fully elapsed it is treated as fresh (used=0). Returns null
 * if there is no live entry (never seen, or expired and not yet re-created).
 * @param {string} key
 * @param {number} now
 * @returns {{used:number, windowStart:number}|null}
 */
function liveEntry(key, now) {
  const entry = store.get(key);
  if (!entry) {
    return null;
  }
  if (now - entry.windowStart >= windowMs) {
    // Window elapsed: the old counter is stale. Reset in place so the caller
    // sees a fresh budget.
    entry.used = 0;
    entry.windowStart = now;
  }
  return entry;
}

/**
 * O(1) admission check. Does NOT mutate the budget — call debit() after the
 * query succeeds to record rows actually shipped.
 * @param {string} key
 * @returns {{allowed:boolean, retryAfterMs:number}} retryAfterMs is 0 when
 *   allowed, otherwise the ms until the current window resets.
 */
function check(key) {
  const now = Date.now();
  const entry = liveEntry(key, now);
  if (!entry || entry.used < rowBudget) {
    return { allowed: true, retryAfterMs: 0 };
  }
  const retryAfterMs = Math.max(0, entry.windowStart + windowMs - now);
  return { allowed: false, retryAfterMs };
}

/**
 * O(1) debit of `rows` rows against `key`, creating or updating the entry. A
 * non-positive `rows` is a no-op (errored/timed-out queries debit nothing).
 * @param {string} key
 * @param {number} rows
 */
function debit(key, rows) {
  if (!Number.isFinite(rows) || rows <= 0) {
    return;
  }
  const now = Date.now();
  let entry = liveEntry(key, now);
  if (!entry) {
    // New key. Enforce the max-entries cap first so the store stays bounded.
    if (store.size >= MAX_ENTRIES) {
      evictOldest();
    }
    entry = { used: 0, windowStart: now };
    store.set(key, entry);
  }
  entry.used += rows;
}

/**
 * Evict the single entry with the oldest windowStart (closest to resetting).
 * O(n) but only runs on overflow of the MAX_ENTRIES cap.
 */
function evictOldest() {
  let oldestKey = null;
  let oldestStart = Infinity;
  for (const [k, entry] of store) {
    if (entry.windowStart < oldestStart) {
      oldestStart = entry.windowStart;
      oldestKey = k;
    }
  }
  if (oldestKey !== null) {
    store.delete(oldestKey);
  }
}

/**
 * Delete entries whose window has fully elapsed. Runs on the hourly sweep to
 * reclaim memory from IPs that have gone quiet.
 */
function sweepExpired() {
  const now = Date.now();
  for (const [k, entry] of store) {
    if (now - entry.windowStart >= windowMs) {
      store.delete(k);
    }
  }
}

/**
 * Mode gating: enforce the budget for EVERY mode except the explicit local-dev
 * READ_WRITE. An unset / typo / garbage mode falls through to enforcement, so
 * a mis-set MODE on a live backend cannot disable the anti-scrape control. Same
 * fail-closed pattern as QueryValidator.validateQuery.
 * @param {string} mode
 * @returns {boolean} true if the budget should be enforced for this mode.
 */
function isEnforced(mode) {
  return mode !== MODES.READ_WRITE;
}

const sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
// Never hold the process open just for the hygiene sweep.
if (typeof sweepTimer.unref === "function") {
  sweepTimer.unref();
}

module.exports = {
  check,
  debit,
  keyForRequest,
  isEnforced,
  // Exposed for tests / observability. Mutating these directly is not part of
  // the supported API.
  rowBudget,
  windowMs,
  MAX_ENTRIES,
  _store: store,
  _sweepExpired: sweepExpired,
};
