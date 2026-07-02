const duckdb = require("duckdb");
const logger = require("./Logger");

/**
 * DuckDB connection manager for autocomplete queries.
 *
 * Provides read-only access to DuckDB search tables for autocomplete
 * functionality. Connection is optional - if DUCKDB_FILE is not set,
 * autocomplete features gracefully degrade.
 */
class DuckDBConnection {
  constructor() {
    this.db = null;
    this.conn = null;
    this.enabled = false;
    this.capabilities = null;
  }

  /**
   * Initialize DuckDB connection from environment variable.
   * Reads DUCKDB_FILE (documented name) or DUCKDB_PATH (legacy alias).
   * If neither is set, autocomplete will be disabled.
   */
  init() {
    const duckdbPath = process.env.DUCKDB_FILE || process.env.DUCKDB_PATH;
    if (!duckdbPath) {
      logger.info("DUCKDB_FILE not set - autocomplete disabled");
      return;
    }

    try {
      this.db = new duckdb.Database(duckdbPath, { access_mode: "READ_ONLY" });
      this.conn = this.db.connect();
      this.enabled = true;
      logger.info(`DuckDB connected: ${duckdbPath} (autocomplete enabled)`);
    } catch (err) {
      logger.error(`Failed to connect to DuckDB at ${duckdbPath}: ${err.message}`);
      this.enabled = false;
      return;
    }

    this.capabilities = this.detectCapabilities();
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
    if (!this.enabled) {
      throw new Error("DuckDB connection not available");
    }

    return new Promise((resolve, reject) => {
      this.conn.all(sql, ...params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
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
      this.conn.close();
      this.conn = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.enabled = false;
    this.capabilities = null;
  }
}

module.exports = new DuckDBConnection();
