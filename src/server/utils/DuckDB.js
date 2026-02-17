const duckdb = require("duckdb");
const logger = require("./Logger");

/**
 * DuckDB connection manager for autocomplete queries.
 *
 * Provides read-only access to DuckDB search tables for autocomplete
 * functionality. Connection is optional - if DUCKDB_PATH is not set,
 * autocomplete features gracefully degrade.
 */
class DuckDBConnection {
  constructor() {
    this.db = null;
    this.conn = null;
    this.enabled = false;
  }

  /**
   * Initialize DuckDB connection from environment variable.
   * If DUCKDB_PATH is not set, autocomplete will be disabled.
   */
  init() {
    const duckdbPath = process.env.DUCKDB_PATH;
    if (!duckdbPath) {
      logger.info("DUCKDB_PATH not set - autocomplete disabled");
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
    }
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
  }
}

module.exports = new DuckDBConnection();
