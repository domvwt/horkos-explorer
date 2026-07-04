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
    numberConnections = isNaN(numberConnections) ? 1 : numberConnections;
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

  getConnection() {
    let minUseCount = Number.MAX_SAFE_INTEGER;
    let minUseCountIndex = -1;
    for (let i = 0; i < this.connectionPool.length; ++i) {
      if (this.connectionPool[i].useCount < minUseCount) {
        minUseCount = this.connectionPool[i].useCount;
        minUseCountIndex = i;
      }
      if (this.connectionPool[i].useCount === 0) {
        minUseCountIndex = 0;
        minUseCountIndex = i;
        break;
      }
    }
    this.connectionPool[minUseCountIndex].useCount++;
    return this.connectionPool[minUseCountIndex].connection;
  }

  releaseConnection(connection) {
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

  async getSchema() {
    const conn = this.getConnection();
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
      this.releaseConnection(conn);
    }
  }

  getDbVersionFromQuery() {
    const conn = this.getConnection();
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
        this.releaseConnection(conn);
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

module.exports = new Database();
