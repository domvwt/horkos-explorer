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

/**
 * DuckDB connection manager for autocomplete queries.
 *
 * Provides read-only access to DuckDB search tables for autocomplete
 * functionality. Connection is optional - if DUCKDB_FILE is not set,
 * autocomplete features gracefully degrade.
 *
 * Uses the promise-based @duckdb/node-api ("node-neo") binding. Because
 * instance/connection creation is async, init() kicks off connection setup
 * without blocking the caller and stores the in-flight promise; query() and
 * getCapabilities() await it, so requests that arrive during the (brief)
 * startup window queue rather than fail. isEnabled() flips true only once a
 * connection is actually established.
 */
class DuckDBConnection {
  constructor() {
    this.instance = null;
    this.conn = null;
    this.enabled = false;
    this.capabilities = null;
    // Promise that resolves once the connection is ready (or rejects/settles
    // to a disabled state). query()/getCapabilities() await this so the async
    // startup is transparent to callers, which invoke init() fire-and-forget.
    this.ready = null;
  }

  /**
   * Initialize DuckDB connection from environment variable.
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
   * Establish the read-only instance/connection and run capability
   * detection. Any failure leaves the manager disabled (autocomplete
   * gracefully degrades) rather than throwing to the boot path.
   */
  async _connect(duckdbPath) {
    try {
      this.instance = await DuckDBInstance.create(duckdbPath, {
        access_mode: "READ_ONLY",
      });
      this.conn = await this.instance.connect();
      this.enabled = true;
      logger.info(
        `DuckDB connected: ${duckdbPath} (autocomplete enabled, ` +
        `query timeout: ${QUERY_TIMEOUT_MS} ms)`
      );
    } catch (err) {
      logger.error(`Failed to connect to DuckDB at ${duckdbPath}: ${err.message}`);
      this.enabled = false;
      this.instance = null;
      this.conn = null;
      return;
    }

    this.capabilities = await this.detectCapabilities();
  }

  /**
   * Detect what the connected DuckDB file supports:
   * - whether the fts extension loads (required for match_bm25 ranking)
   * - which search.* tables exist, their columns, and whether each has
   *   a matching FTS index schema (fts_search_<table>)
   *
   * Runs once at startup. Ranked search degrades to LIKE-only when the
   * extension or index schemas are missing, so older DuckDB files keep
   * working unchanged.
   *
   * @returns {Promise<{fts: boolean, tables: Object<string, {columns: Set<string>, fts: boolean}>}>}
   */
  async detectCapabilities() {
    const capabilities = { fts: false, tables: {} };

    try {
      await this.query("LOAD fts");
      capabilities.fts = true;
    } catch (loadErr) {
      try {
        await this.query("INSTALL fts; LOAD fts");
        capabilities.fts = true;
      } catch (installErr) {
        logger.warn(
          `DuckDB fts extension unavailable (${installErr.message}) - autocomplete degrades to LIKE-only`
        );
      }
    }

    try {
      const columns = await this.query(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'search'"
      );
      const ftsSchemas = await this.query(
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
    // Wait for startup connection/detection to settle before reporting.
    if (this.ready) {
      await this.ready;
    }
    if (!this.capabilities) {
      return { fts: false, tables: {} };
    }
    return this.capabilities;
  }

  /**
   * Execute a SQL query with parameters.
   *
   * @param {string} sql - SQL query string with ? placeholders for parameters.
   * @param {...*} params - Query parameters in positional order (variadic).
   * @returns {Promise<Array<Object>>} Query results as array of row objects.
   * @throws {Error} If connection is not available or query fails.
   */
  async query(sql, ...params) {
    // Wait for the in-flight connection so queries issued during startup
    // resolve once ready. Guard against a self-await deadlock: detectCapabilities
    // runs INSIDE the `ready` promise and itself calls query() — by that point
    // `this.conn` is already set, so we must NOT await `ready` (which is still
    // pending on detectCapabilities). Only await when the connection isn't up yet.
    if (this.ready && !this.conn) {
      await this.ready;
    }
    if (!this.enabled || !this.conn) {
      throw new Error("DuckDB connection not available");
    }

    // node-neo takes positional parameters as an array; the old binding took
    // them variadically. Collect the variadic params into an array to preserve
    // this method's call signature for existing callers (Suggest.js).
    const runPromise =
      params.length > 0
        ? this.conn.runAndReadAll(sql, params)
        : this.conn.runAndReadAll(sql);

    // Statement-timeout mechanism: DuckDB has no native per-statement timeout
    // PRAGMA/config, so we bound the wall-clock time here with a Promise.race
    // that rejects once the timeout elapses. We deliberately do NOT call
    // conn.interrupt() on timeout: interrupt() is connection-wide, and this is a
    // single shared connection, so interrupting would cancel whatever query is
    // currently executing on it -- which may be a *different, concurrent*
    // request, not the one that timed out. The abandoned query is a bounded
    // read-only scan; letting it finish in the background is preferable to
    // cancelling an innocent concurrent request (whose failure could, e.g., flip
    // FTS capability off process-wide in Suggest.js).
    const reader = await this._withTimeout(runPromise, QUERY_TIMEOUT_MS);
    // getRowObjects() yields plain objects keyed by column name (BIGINT
    // columns arrive as JS bigint, matching the old node-duckdb behaviour that
    // Suggest.js relies on).
    return reader.getRowObjects();
  }

  /**
   * Race a query promise against a wall-clock timeout. On timeout, reject the
   * caller WITHOUT interrupting the in-flight query: interrupt() is
   * connection-wide on this single shared connection, so it could cancel a
   * different, concurrent request. The abandoned query is a bounded read-only
   * scan and finishes on its own. The timer is cleared on both settle paths.
   *
   * @param {Promise} runPromise - The in-flight DuckDB query promise.
   * @param {number} timeoutMs - Timeout in milliseconds.
   * @returns {Promise} Resolves with the query result or rejects on timeout.
   */
  _withTimeout(runPromise, timeoutMs) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        // Reject the caller so it stops waiting. We do NOT interrupt the running
        // query: interrupt() is connection-wide on this single shared
        // connection, so it could cancel a different, concurrent request. The
        // abandoned query is a bounded read-only scan and finishes on its own.
        reject(new Error(`DuckDB query exceeded ${timeoutMs}ms timeout`));
      }, timeoutMs);
    });
    return Promise.race([runPromise, timeoutPromise]).finally(() => {
      clearTimeout(timer);
    });
  }

  /**
   * Check if DuckDB connection is available.
   * @returns {boolean} True if connected and ready
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Close the DuckDB connection.
   */
  close() {
    if (this.conn) {
      this.conn.closeSync();
      this.conn = null;
    }
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

module.exports = new DuckDBConnection();
