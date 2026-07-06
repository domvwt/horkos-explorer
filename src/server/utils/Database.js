const path = require("path");
const process = require("process");
const logger = require("./Logger");
const fs = require("fs");
const TABLE_TYPES = {
  NODE: "NODE",
  REL: "REL",
};
const CONSTANTS = require("./Constants");
const MODES = CONSTANTS.MODES;
const READ_WRITE_MODE = MODES.READ_WRITE;

// Fail-closed default: if KUZU_QUERY_TIMEOUT is unset or invalid, every pooled
// connection still gets a finite per-query wall-clock timeout so a single query
// cannot run indefinitely (DoS). Operators can raise/lower it via the env var.
const DEFAULT_QUERY_TIMEOUT_MS = 30000;

// Admission-control defaults for the query-execution path. getConnection() is a
// round-robin load-balancer, NOT a concurrency limiter: without a bound, N
// concurrent /api/cypher requests all serialise on the shared pool and a burst
// of near-timeout queries can make legitimate users wait minutes. We cap the
// number of query acquisitions in flight (concurrency) plus a bounded backlog
// (queue depth); excess is shed immediately with a LoadShedError the route maps
// to a 503, rather than letting an unbounded queue build. The cap is derived
// from the pool size (one in-flight query per connection) plus MAX_QUEUE_DEPTH
// slack for briefly-overlapping requests. Operators can override via env vars.
const DEFAULT_NUM_CONNECTIONS = 4;
const DEFAULT_MAX_QUEUE_DEPTH = 30;

/**
 * Thrown by getConnection() when the admission-control cap is exceeded. Carries
 * an HTTP-shaped status so the /api/cypher route can shed load with a 503
 * instead of the generic 400/500 path (the client can back off and retry).
 */
class LoadShedError extends Error {
  constructor(message) {
    super(message);
    this.name = "LoadShedError";
    this.status = 503;
  }
}

let kuzu;
// Try submodule build first (local dev), fall back to node_modules (Docker)
const submodulePath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "kuzu",
  "tools",
  "nodejs_api",
  "build/"
);
const submoduleIndexPath = path.join(submodulePath, "index.js");
if (fs.existsSync(submoduleIndexPath)) {
  kuzu = require(submodulePath);
} else {
  kuzu = require("kuzu");
}
const os = require("os");

class Database {
  constructor() {
    const isWasmMode = process.env.KUZU_WASM &&
      process.env.KUZU_WASM.toLowerCase() === "true";
    if (isWasmMode) {
      return;
    }
    const dbDir = process.env.KUZU_DIR;
    const isInMemory = (process.env.KUZU_IN_MEMORY &&
      process.env.KUZU_IN_MEMORY.toLowerCase() === "true") ||
      !dbDir;
    const mode = this.getAccessModeString();
    const isReadOnlyMode = mode !== READ_WRITE_MODE;
    let dbPath;
    if (isInMemory) {
      logger.info("In-memory mode is enabled");
      dbPath = ":memory:";
    } else {
      let dbFileName = process.env.KUZU_FILE;
      if (!dbFileName) {
        dbFileName = "database.kz";
        logger.warn(
          "KUZU_FILE environment variable not set, using default database file name: database.kz"
        );
      } else {
        logger.info(`Using database file: ${dbFileName}`);
      }
      dbPath = path.resolve(
        path.join(dbDir, dbFileName)
      );
    }
    let bufferPoolSize = parseInt(process.env.KUZU_BUFFER_POOL_SIZE);
    bufferPoolSize = isNaN(bufferPoolSize) ? 0 : bufferPoolSize;
    let numberConnections = parseInt(process.env.KUZU_NUM_CONNECTIONS);
    // Default to a small pool (not 1): a pool of 1 serialises every concurrent
    // /api/cypher request on a single connection, so one slow query stalls all
    // others. A handful of connections lets independent queries proceed in
    // parallel while the admission gate below still bounds total in-flight work.
    numberConnections = isNaN(numberConnections) || numberConnections < 1
      ? DEFAULT_NUM_CONNECTIONS
      : numberConnections;
    let numberOfCores = parseInt(process.env.KUZU_NUM_CORES);
    numberOfCores =
      isNaN(numberOfCores) || numberOfCores < 1
        ? os.cpus().length
        : numberOfCores;
    if (numberOfCores !== os.cpus().length) {
      logger.info("Connection pool configuration: ");
      logger.info(`   ${numberOfCores} / ${os.cpus().length} total cores`);
    }
    let coresPerConnection = Math.floor(numberOfCores / numberConnections);
    coresPerConnection = coresPerConnection < 1 ? 1 : coresPerConnection;
    if (numberOfCores !== os.cpus().length) {
      logger.info(
        `   ${coresPerConnection} ${coresPerConnection === 1 ? "core" : "cores"
        } per connection`
      );
      logger.info(
        `   ${numberConnections} ${numberConnections === 1 ? "connection" : "connections"
        }`
      );
    }
    this.dbPath = dbPath;
    this.isInitialDatabaseEmpty = this.isDatabasePathEmpty();
    logger.info(
      `Access mode: ${isReadOnlyMode ? MODES.READ_ONLY : MODES.READ_WRITE}`
    );
    const parsedQueryTimeout = parseInt(process.env.KUZU_QUERY_TIMEOUT);
    // Treat unset / non-numeric / zero / negative as invalid and fall back to
    // the safe finite default, so this.queryTimeout is always a positive number.
    const queryTimeout =
      !isNaN(parsedQueryTimeout) && parsedQueryTimeout > 0
        ? parsedQueryTimeout
        : DEFAULT_QUERY_TIMEOUT_MS;
    logger.info(`Query timeout: ${queryTimeout} ms`);
    this.bufferPoolSize = bufferPoolSize;
    this.isReadOnlyMode = isReadOnlyMode;
    this.numberConnections = numberConnections;
    this.queryTimeout = queryTimeout;
    this.coresPerConnection = coresPerConnection;

    // Admission control: cap total in-flight admission-controlled query
    // acquisitions at (pool size + bounded backlog). Extra concurrent requests
    // are shed with a LoadShedError (-> 503) instead of piling up unbounded.
    let maxQueueDepth = parseInt(process.env.KUZU_MAX_QUEUE_DEPTH);
    maxQueueDepth = isNaN(maxQueueDepth) || maxQueueDepth < 0
      ? DEFAULT_MAX_QUEUE_DEPTH
      : maxQueueDepth;
    this.maxInFlightQueries = numberConnections + maxQueueDepth;
    // Number of admission-controlled acquisitions currently outstanding
    // (incremented on a controlled getConnection, decremented on release).
    this.inFlightQueries = 0;
    logger.info(
      `Query admission control: max ${this.maxInFlightQueries} in-flight ` +
      `(${numberConnections} connection(s) + ${maxQueueDepth} queue depth)`
    );

    // In READ_ONLY the schema is static, so getSchema() can be cached (Item 2).
    // In READ_WRITE the cache stays null and the schema is recomputed per call;
    // invalidateSchemaCache() is wired to the read-write schema-change path.
    this.cachedSchema = null;

    this.init();
  }

  isDatabasePathEmpty() {
    try {
      const files = fs.readdirSync(this.dbPath);
      return files.length === 0;
    } catch (err) {
      return true;
    }
  }

  init() {
    this.db = new kuzu.Database(this.dbPath, this.bufferPoolSize, true, this.isReadOnlyMode);
    this.connectionPool = [];
    for (let i = 0; i < this.numberConnections; ++i) {
      const conn = {
        connection: new kuzu.Connection(this.db, this.coresPerConnection),
        useCount: 0,
        id: i,
      };
      // this.queryTimeout is always a finite positive number (see constructor),
      // so every pooled connection gets a query timeout by default.
      conn.connection.setQueryTimeout(this.queryTimeout);
      this.connectionPool.push(conn);
    }
  }

  get kuzu() {
    return kuzu;
  }

  getAccessModeString() {
    const rawMode = (process.env.MODE || "").trim();
    if (!rawMode) {
      logger.warn(
        "MODE environment variable not set, defaulting to READ_ONLY for safety. " +
        "Set MODE=READ_WRITE explicitly to open the database writable and allow write operations."
      );
      return MODES.READ_ONLY;
    }
    const mode = rawMode.toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(MODES, mode)) {
      logger.warn(
        `Unrecognised MODE value "${process.env.MODE}", defaulting to READ_ONLY for safety. ` +
        "Valid values are DEMO, READ_ONLY, READ_WRITE."
      );
      return MODES.READ_ONLY;
    }
    return mode;
  }

  getDb() {
    return this.db;
  }

  /**
   * Acquire a pooled connection (round-robin by lowest use count).
   *
   * @param {object} [opts]
   * @param {boolean} [opts.admissionControlled=true] - When true (the default,
   *   used by the external /api/cypher path), the acquisition counts against the
   *   in-flight cap and is shed with a LoadShedError once the cap is exceeded, so
   *   a burst of concurrent queries cannot pile up unbounded. Internal callers
   *   (schema/version lookups) pass false so they are never shed by their own
   *   bookkeeping; they still borrow a connection but bypass the gate.
   * @returns {object} A Kuzu connection from the pool.
   * @throws {LoadShedError} When admissionControlled and the in-flight cap is hit.
   */
  getConnection(opts = {}) {
    const admissionControlled = opts.admissionControlled !== false;
    if (admissionControlled) {
      if (this.inFlightQueries >= this.maxInFlightQueries) {
        throw new LoadShedError(
          "Server is at capacity; too many concurrent queries in flight"
        );
      }
      this.inFlightQueries++;
    }
    let minUseCount = Number.MAX_SAFE_INTEGER;
    let minUseCountIndex = -1;
    for (let i = 0; i < this.connectionPool.length; ++i) {
      if (this.connectionPool[i].useCount < minUseCount) {
        minUseCount = this.connectionPool[i].useCount;
        minUseCountIndex = i;
      }
      if (this.connectionPool[i].useCount === 0) {
        minUseCountIndex = i;
        break;
      }
    }
    this.connectionPool[minUseCountIndex].useCount++;
    return this.connectionPool[minUseCountIndex].connection;
  }

  /**
   * Release a pooled connection acquired with getConnection().
   *
   * @param {object} connection - The connection returned by getConnection().
   * @param {object} [opts]
   * @param {boolean} [opts.admissionControlled=true] - MUST match the flag the
   *   matching getConnection() used, so the in-flight counter is decremented
   *   exactly once for every admitted acquisition. Callers that took a
   *   connection with the default (admission-controlled) acquire release with
   *   the default here; internal callers that passed false on acquire pass false
   *   on release too.
   * @returns {boolean} True if the connection belonged to the pool.
   */
  releaseConnection(connection, opts = {}) {
    const admissionControlled = opts.admissionControlled !== false;
    if (admissionControlled && this.inFlightQueries > 0) {
      this.inFlightQueries--;
    }
    for (let i = 0; i < this.connectionPool.length; ++i) {
      if (this.connectionPool[i].connection === connection) {
        this.connectionPool[i].useCount--;
        return true;
      }
    }
    return false;
  }

  reset() {
    const isAllConnectionsReleased = this.connectionPool.every(
      (conn) => conn.useCount === 0
    );
    if (!isAllConnectionsReleased) {
      throw new Error("Please make sure no queries are running before resetting Kuzu.");
    }
    const oldConnectionPool = this.connectionPool;
    const oldDb = this.db;
    this.connectionPool = [];
    this.db = null;
    return Promise.all(oldConnectionPool.map((conn) => conn.connection.close()))
      .then(() => {
        oldDb.close();
      }).then(() => {
        this.init();
      });
  }

  /**
   * Invalidate the cached READ_ONLY schema so the next getSchema() recomputes.
   * No-op when nothing is cached. Wired to the READ_WRITE schema-change path so
   * a DDL statement in that mode is reflected on the next read.
   */
  invalidateSchemaCache() {
    this.cachedSchema = null;
  }

  /**
   * Return the database schema (node/rel tables + connectivity).
   *
   * In READ_ONLY the schema is static for the process lifetime, so the computed
   * result is cached after the first call: the ~15-20 serial round-trips
   * (show_tables + per-table TABLE_INFO + per-rel SHOW_CONNECTION) then run once
   * instead of on every /api/schema and /api/cypher request. In READ_WRITE the
   * schema can change, so it is recomputed each call and the cache stays unused
   * (invalidateSchemaCache() clears it on the write-mode schema-change path).
   */
  async getSchema() {
    if (this.isReadOnlyMode && this.cachedSchema) {
      return this.cachedSchema;
    }
    const schema = await this._computeSchema();
    if (this.isReadOnlyMode) {
      this.cachedSchema = schema;
    }
    return schema;
  }

  async _computeSchema() {
    // Internal bookkeeping query: bypass admission control so schema fetches are
    // never shed by their own count, and never decrement another request's slot.
    const conn = this.getConnection({ admissionControlled: false });
    try {
      const result = await conn.query("CALL show_tables() RETURN *;");
      const tables = await result.getAll();
      result.close();
      const nodeTables = [];
      const relTables = [];
      for (const table of tables) {
        const properties = (
          await conn
            .query(`CALL TABLE_INFO('${table.name}') RETURN *;`)
            .then((res) => res.getAll())
        ).map((property) => ({
          name: property.name,
          type: property.type,
          isPrimaryKey: property["primary key"],
        }));
        if (table.type === TABLE_TYPES.NODE) {
          delete table["type"];
          table.properties = properties;
          nodeTables.push(table);
        } else if (table.type === TABLE_TYPES.REL) {
          delete table["type"];
          properties.forEach((property) => {
            delete property.isPrimaryKey;
          });
          table.properties = properties;
          const connectivity = await conn
            .query(`CALL SHOW_CONNECTION('${table.name}') RETURN *;`)
            .then((res) => res.getAll());
          table.connectivity = [];
          connectivity.forEach(c => {
            table.connectivity.push({
              src: c["source table name"],
              dst: c["destination table name"],
            });
          });
          relTables.push(table);
        }
      }
      nodeTables.sort((a, b) => a.name.localeCompare(b.name));
      relTables.sort((a, b) => a.name.localeCompare(b.name));
      return { nodeTables, relTables };
    } finally {
      this.releaseConnection(conn, { admissionControlled: false });
    }
  }

  getDbVersionFromQuery() {
    // Internal bookkeeping query (runs at boot and on /api/): bypass admission
    // control so it is never shed and does not consume a query slot.
    const conn = this.getConnection({ admissionControlled: false });
    let queryResult;
    return conn
      .query("CALL db_version() RETURN *;")
      .then((res) => {
        queryResult = res;
        return res.getAll();
      })
      .then((res) => {
        const row = res[0];
        const version = Object.values(row)[0];
        return version;
      })
      .finally(() => {
        if (queryResult) {
          queryResult.close();
        }
        this.releaseConnection(conn, { admissionControlled: false });
      });
  }

  getDbVersionFromPackage() {
    const packagePath = path.join(__dirname, "..", "..", "..", "package.json");
    return fs.promises.readFile(packagePath, "utf8").then((data) => {
      const packageJson = JSON.parse(data);
      return packageJson.dependencies.kuzu;
    });
  }

  getDbVersion() {
    return Promise.all([
      this.getDbVersionFromQuery(),
      this.getDbVersionFromPackage(),
    ]).then(([queryVersion, packageVersion]) => {
      const version = packageVersion.includes("dev")
        ? packageVersion
        : queryVersion;
      const storageVersion = this.kuzu.STORAGE_VERSION;
      return { version, storageVersion };
    });
  }
}

const databaseSingleton = new Database();
// Expose the LoadShedError constructor on the exported singleton so callers
// (Cypher.js) can identify admission-control shed errors via `instanceof` if
// they prefer that to reading `.status`. Existing callers keep using the
// singleton's methods unchanged; this only adds a property.
databaseSingleton.LoadShedError = LoadShedError;
module.exports = databaseSingleton;
