const { DuckDBInstance } = require("@duckdb/node-api");
const logger = require("./Logger");

// Fail-closed default: if DUCKDB_QUERY_TIMEOUT is unset or invalid, DuckDB
// queries still get a finite wall-clock timeout so a single /api/suggest
// full-table FTS+LIKE scan cannot run unbounded (DoS). Mirrors the
// KUZU_QUERY_TIMEOUT convention (see Database.js). Operators override via env.
const DEFAULT_QUERY_TIMEOUT_MS = 30000;

const parsedQueryTimeout = parseInt(process.env.DUCKDB_QUERY_TIMEOUT, 10);
// Treat unset / non-numeric / zero / negative as invalid and fall back to the
// safe finite default, so the timeout is always a positive number.
const QUERY_TIMEOUT_MS =
  !isNaN(parsedQueryTimeout) && parsedQueryTimeout > 0
    ? parsedQueryTimeout
    : DEFAULT_QUERY_TIMEOUT_MS;

// Fail-closed default connection-pool size. A single shared connection
// serialises every concurrent /api/suggest query, so one slow BM25 scan stalls
// all autocomplete; a small pool lets independent queries run in parallel. Kept
// small because autocomplete is a supporting surface, not the main query path.
const DEFAULT_NUM_CONNECTIONS = 3;

const parsedNumConnections = parseInt(process.env.DUCKDB_NUM_CONNECTIONS, 10);
// Treat unset / non-numeric / zero / negative as invalid and fall back to the
// safe default (never disabled).
const NUM_CONNECTIONS =
  !isNaN(parsedNumConnections) && parsedNumConnections > 0
    ? parsedNumConnections
    : DEFAULT_NUM_CONNECTIONS;

// Admission control: on top of the pool we allow a bounded backlog of requests
// waiting for a free connection. Beyond pool size + queue depth, excess
// requests are shed immediately with a LoadShedError (-> HTTP 503) instead of
// queueing unboundedly, so a burst of slow scans cannot pile up unbounded.
const MAX_QUEUE_DEPTH = 10;

/**
 * Thrown by the checkout path when the pool + bounded wait queue are full.
 * Carries an HTTP-shaped status so the /api/suggest route can shed load with a
 * 503 (and a Retry-After) rather than a generic 500.
 */
class LoadShedError extends Error {
  constructor(message) {
    super(message);
    this.name = "LoadShedError";
    this.status = 503;
  }
}

/**
 * DuckDB connection manager for autocomplete queries.
 *
 * Provides read-only access to the DuckDB search tables that back the
 * autocomplete functionality. Connection is optional — if DUCKDB_FILE is not
 * set, autocomplete features gracefully degrade.
 *
 * Uses the promise-based @duckdb/node-api ("node-neo") binding. Because
 * instance/connection creation is async, init() kicks off connection setup
 * without blocking the caller and stores an in-flight promise; query() and
 * getCapabilities() await it, so requests during the (brief) startup window
 * queue rather than fail. isEnabled() flips to true only once the connection
 * pool has actually been established.
 *
 * Concurrency: queries run over a small pool of connections opened on the ONE
 * DuckDBInstance. Each pooled connection runs at most one query at a time (so a
 * timed-out query can be interrupted/replaced without hitting an innocent
 * concurrent request). A bounded admission gate caps in-flight + queued work.
 */
class DuckDBConnection {
  constructor() {
    this.instance = null;
    // Pool of { conn, busy } slots. One query per slot at a time.
    this.pool = [];
    // FIFO backlog of waiters for a free slot: each entry is { resolve, reject }.
    this.waiters = [];
    this.enabled = false;
    this.capabilities = null;
    // Promise that resolves once the pool is ready (or rejects/settles to a
    // disabled state). query()/getCapabilities() await this so the async
    // startup is transparent to callers, which invoke init() fire-and-forget.
    this.ready = null;
  }

  /**
   * Initialize the DuckDB pool from an environment variable.
   * Reads DUCKDB_FILE (documented name) or DUCKDB_PATH (legacy alias).
   * If neither is set, autocomplete will be disabled.
   *
   * Returns the readiness promise so callers may await it if they wish, but
   * awaiting is optional — index.js/Configure.js call this fire-and-forget.
   * @returns {Promise<void>}
   */
  init() {
    const duckdbPath = process.env.DUCKDB_FILE || process.env.DUCKDB_PATH;
    if (!duckdbPath) {
      logger.info("DUCKDB_FILE not set - autocomplete disabled");
      this.ready = Promise.resolve();
      return this.ready;
    }

    this.ready = this._connect(duckdbPath);
    return this.ready;
  }

  /**
   * Establish the read-only instance + connection pool and run capability
   * detection. Any failure leaves the manager disabled (autocomplete
   * gracefully degrades) rather than throwing to the boot path.
   */
  async _connect(duckdbPath) {
    try {
      this.instance = await DuckDBInstance.create(duckdbPath, {
        access_mode: "READ_ONLY",
      });
      for (let i = 0; i < NUM_CONNECTIONS; i++) {
        const conn = await this.instance.connect();
        // Load fts on EVERY pooled connection: extension loading is
        // per-connection, so any connection that may later serve a ranked
        // query must have fts available. A file without fts leaves capability
        // detection to degrade to LIKE-only; the LOAD failure here is
        // non-fatal.
        await this._loadFtsBestEffort(conn);
        this.pool.push({ conn, busy: false });
      }
      this.enabled = true;
      logger.info(
        `DuckDB connected: ${duckdbPath} (autocomplete enabled, ` +
        `pool size: ${NUM_CONNECTIONS}, query timeout: ${QUERY_TIMEOUT_MS} ms)`
      );
    } catch (err) {
      logger.error(`Failed to connect to DuckDB at ${duckdbPath}: ${err.message}`);
      this.enabled = false;
      this.instance = null;
      this.pool = [];
      return;
    }

    this.capabilities = await this.detectCapabilities();
  }

  /**
   * Load the fts extension on a single connection, tolerating absence. Runs
   * during pool setup (outside the admission gate) so every pooled connection
   * that may serve a ranked query has fts available; detectCapabilities()
   * observes whether it actually loaded.
   */
  async _loadFtsBestEffort(conn) {
    try {
      await conn.runAndReadAll("LOAD fts");
    } catch (loadErr) {
      try {
        await conn.runAndReadAll("INSTALL fts; LOAD fts");
      } catch (installErr) {
        // Non-fatal: capability detection will report fts unavailable and the
        // endpoint degrades to LIKE-only. Logged once per connection at debug
        // level to avoid startup noise on files without fts.
        logger.debug(
          `DuckDB fts extension unavailable on a pooled connection (${installErr.message})`
        );
      }
    }
  }

  /**
   * Detect what the connected DuckDB file supports:
   * - whether the fts extension loads (required for match_bm25 ranking)
   * - which search.* tables exist, their columns, and whether each has
   *   a matching FTS index schema (fts_search_<table>)
   *
   * Runs once at startup. Ranked search degrades to LIKE-only when the
   * extension or index schemas are missing, so older DuckDB files keep
   * working unchanged. Startup queries run on a pooled connection directly,
   * OUTSIDE the admission gate, so they are never shed by request load.
   *
   * @returns {Promise<{fts: boolean, tables: Object<string, {columns: Set<string>, fts: boolean}>}>}
   */
  async detectCapabilities() {
    const capabilities = { fts: false, tables: {} };

    try {
      await this._querySetup("LOAD fts");
      capabilities.fts = true;
    } catch (loadErr) {
      try {
        await this._querySetup("INSTALL fts; LOAD fts");
        capabilities.fts = true;
      } catch (installErr) {
        logger.warn(
          `DuckDB fts extension unavailable (${installErr.message}) - autocomplete degrades to LIKE-only`
        );
      }
    }

    try {
      const columns = await this._querySetup(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'search'"
      );
      const ftsSchemas = await this._querySetup(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'fts_search_%'"
      );
      const ftsSchemaSet = new Set(ftsSchemas.map((r) => r.schema_name));
      for (const row of columns) {
        if (!capabilities.tables[row.table_name]) {
          capabilities.tables[row.table_name] = {
            columns: new Set(),
            fts: capabilities.fts && ftsSchemaSet.has(`fts_search_${row.table_name}`),
          };
        }
        capabilities.tables[row.table_name].columns.add(row.column_name);
      }
    } catch (err) {
      logger.error(`Failed to inspect DuckDB search schema: ${err.message}`);
    }

    const tableNames = Object.keys(capabilities.tables);
    const ftsTables = tableNames.filter((t) => capabilities.tables[t].fts);
    logger.info(
      `DuckDB search tables: [${tableNames.join(", ")}], FTS-ranked: [${ftsTables.join(", ")}]`
    );
    return capabilities;
  }

  /**
   * Get detected search capabilities (awaits startup detection).
   * @returns {Promise<{fts: boolean, tables: Object}>}
   */
  async getCapabilities() {
    // Wait for the startup connection/detection to settle before reporting.
    if (this.ready) {
      await this.ready;
    }
    if (!this.capabilities) {
      return { fts: false, tables: {} };
    }
    return this.capabilities;
  }

  /**
   * Acquire a free pooled slot, waiting in a bounded queue if all are busy.
   *
   * Admission control: the total of busy slots + queued waiters is capped at
   * pool size + MAX_QUEUE_DEPTH. Beyond that, checkout rejects immediately with
   * a LoadShedError (status 503) so a burst of slow scans is shed rather than
   * piling up unbounded. Startup queries bypass this via _querySetup().
   *
   * @returns {Promise<{ conn, busy }>} A pool slot marked busy.
   */
  _checkout() {
    const free = this.pool.find((slot) => !slot.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    if (this.waiters.length >= MAX_QUEUE_DEPTH) {
      return Promise.reject(
        new LoadShedError(
          "Search is at capacity; too many concurrent autocomplete queries"
        )
      );
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /**
   * Return a slot to the pool. If a waiter is queued, hand it the slot directly
   * (it stays busy); otherwise mark it free.
   */
  _release(slot) {
    const next = this.waiters.shift();
    if (next) {
      // Slot stays busy and is handed straight to the next waiter.
      next.resolve(slot);
    } else {
      slot.busy = false;
    }
  }

  /**
   * Replace a pooled connection whose query timed out. Interrupt is issued as a
   * courtesy, then the connection is closed and a fresh one opened so a
   * runaway/abandoned query can never keep occupying a pool slot. On
   * replacement failure the slot is dropped and, if the pool would be empty,
   * the manager disables itself (autocomplete degrades) rather than serving
   * from a dead connection.
   */
  async _replaceSlot(slot) {
    try {
      slot.conn.interrupt();
    } catch {
      // interrupt() is best-effort; proceed to close+reopen regardless.
    }
    try {
      slot.conn.closeSync();
    } catch {
      // Ignore: the connection may already be unusable.
    }
    try {
      const conn = await this.instance.connect();
      await this._loadFtsBestEffort(conn);
      slot.conn = conn;
    } catch (err) {
      logger.error(
        `Failed to replace a timed-out DuckDB connection: ${err.message}`
      );
      const idx = this.pool.indexOf(slot);
      if (idx !== -1) {
        this.pool.splice(idx, 1);
      }
      if (this.pool.length === 0) {
        this.enabled = false;
      }
      // Rethrow so query() fails whichever queued waiters this dropped slot
      // can no longer serve (all of them, if the pool is now empty).
      throw err;
    }
  }

  /**
   * Execute a SQL query with parameters over a checked-out pooled connection.
   *
   * @param {string} sql - SQL query string with ? placeholders for parameters.
   * @param {...*} params - Query parameters in positional order (variadic).
   * @returns {Promise<Array<Object>>} Query results as an array of row objects.
   * @throws {Error} If the connection is not available or the query fails.
   * @throws {LoadShedError} When the pool + bounded queue are full.
   */
  async query(sql, ...params) {
    // Wait for the in-flight pool setup so queries issued during startup resolve
    // once ready. detectCapabilities()/startup use _querySetup() (not this
    // method), so awaiting this.ready here never self-deadlocks.
    if (this.ready) {
      await this.ready;
    }

    if (!this.enabled || this.pool.length === 0) {
      throw new Error("DuckDB is not available");
    }

    const slot = await this._checkout();
    let timedOut = false;
    try {
      // node-neo's runAndReadAll takes a positional array. Spread the variadic
      // params to preserve this method's call signature for existing callers.
      const runPromise =
        params.length > 0
          ? slot.conn.runAndReadAll(sql, params)
          : slot.conn.runAndReadAll(sql);
      const reader = await this._withTimeout(slot.conn, runPromise, QUERY_TIMEOUT_MS);
      // getRowObjects() yields plain objects keyed by column name (BIGINT
      // columns arrive as JS bigint, matching the old node-duckdb behaviour
      // Suggest.js relies on).
      return reader.getRowObjects();
    } catch (err) {
      timedOut = err && err.__duckdbTimeout === true;
      throw err;
    } finally {
      if (timedOut) {
        // The query is still running on this connection; interrupt and replace
        // the connection so it never keeps occupying a pool slot, then return a
        // FRESH slot to the pool. _replaceSlot mutates slot.conn in place.
        try {
          await this._replaceSlot(slot);
          this._release(slot);
        } catch {
          // Slot was dropped from the pool (replacement failed). If the pool
          // is now EMPTY, no _release can ever come, so every queued waiter
          // would hang forever — drain them all. If other slots remain, the
          // pool merely shrank by one: reject just one waiter (the one this
          // slot would have served); the rest are still served as the
          // surviving slots release.
          if (this.pool.length === 0) {
            const orphaned = this.waiters.splice(0);
            for (const waiter of orphaned) {
              waiter.reject(
                new Error("DuckDB connection unavailable after timeout")
              );
            }
          } else {
            const next = this.waiters.shift();
            if (next) {
              next.reject(
                new Error("DuckDB connection unavailable after timeout")
              );
            }
          }
        }
      } else {
        this._release(slot);
      }
    }
  }

  /**
   * Run a startup/setup query on a pooled connection WITHOUT admission control
   * or the per-query timeout wrapper. Used by _connect()/detectCapabilities()
   * so schema/extension probes are never shed by request load and are not
   * counted against the pool's in-flight budget.
   */
  async _querySetup(sql) {
    const slot = this.pool.find((s) => !s.busy) || this.pool[0];
    if (!slot) {
      throw new Error("DuckDB is not available");
    }
    const reader = await slot.conn.runAndReadAll(sql);
    return reader.getRowObjects();
  }

  /**
   * Race a query promise against a wall-clock timeout. On timeout the returned
   * rejection is tagged (__duckdbTimeout) so query() knows to interrupt and
   * replace the connection: because each pooled connection runs at most one
   * query at a time, killing the timed-out query has no collateral on other
   * requests. The timer is cleared on both settle paths.
   *
   * @param {object} conn - The pooled connection the query is running on.
   * @param {Promise} runPromise - The in-flight DuckDB query promise.
   * @param {number} timeoutMs - Timeout in milliseconds.
   * @returns {Promise} Resolves with the query result or rejects on timeout.
   */
  _withTimeout(conn, runPromise, timeoutMs) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`DuckDB query exceeded ${timeoutMs}ms timeout`);
        // Tag so the caller interrupts + replaces this connection's slot.
        err.__duckdbTimeout = true;
        reject(err);
      }, timeoutMs);
    });
    return Promise.race([runPromise, timeoutPromise]).finally(() => {
      clearTimeout(timer);
    });
  }

  /**
   * Check if the DuckDB pool is available.
   * @returns {boolean} True if connected and ready.
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Close all pooled connections and the instance.
   */
  close() {
    for (const slot of this.pool) {
      try {
        slot.conn.closeSync();
      } catch {
        // Ignore per-connection close errors during teardown.
      }
    }
    this.pool = [];
    // Reject any lingering waiters so callers do not hang on a closed pool.
    for (const waiter of this.waiters) {
      waiter.reject(new Error("DuckDB is closing"));
    }
    this.waiters = [];
    if (this.instance) {
      if (typeof this.instance.closeSync === "function") {
        this.instance.closeSync();
      }
      this.instance = null;
    }
    this.enabled = false;
    this.capabilities = null;
    this.ready = null;
  }
}

const duckdbSingleton = new DuckDBConnection();
// Expose LoadShedError on the exported singleton so the Suggest route can
// identify admission-control shed errors via `instanceof` (or `.status`).
duckdbSingleton.LoadShedError = LoadShedError;
module.exports = duckdbSingleton;
