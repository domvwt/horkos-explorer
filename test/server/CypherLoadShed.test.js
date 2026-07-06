import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// This exercises the REAL Cypher.js router handler (not a look-alike), proving
// that a LoadShedError from database.getConnection() is caught and mapped to a
// 503 with a generic "at capacity" message — the actual admission-control shed
// path. supertest is NOT installed and must not be.
//
// Cypher.js is CommonJS and does `const database = require("./utils/Database")`
// at module top, whose constructor opens a real Kuzu DB. vitest's vi.mock does
// not reliably intercept that nested CommonJS require (empirically it loaded the
// real Database and tried to open an in-memory DB). So we bypass vitest's module
// runner entirely: use a NATIVE Node require (createRequire) and pre-seed Node's
// real require.cache with mock modules for Database, QueryValidator and
// SessionDatabase BEFORE requiring Cypher.js. This guarantees Cypher.js's own
// require() resolves to our mocks and never touches a DB.

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const DATABASE_PATH = path.join(repoRoot, "src/server/utils/Database.js");
const QUERY_VALIDATOR_PATH = path.join(repoRoot, "src/server/middleware/QueryValidator.js");
const SESSION_DB_PATH = path.join(repoRoot, "src/server/utils/SessionDatabase.js");
const CYPHER_PATH = path.join(repoRoot, "src/server/Cypher.js");

// A real LoadShedError shape (status 503), matching Database.js's class.
class LoadShedError extends Error {
  constructor(message) {
    super(message);
    this.name = "LoadShedError";
    this.status = 503;
  }
}

let getConnectionCalls = 0;
let releaseConnectionCalls = 0;

const mockDatabase = {
  getAccessModeString: () => "READ_ONLY",
  getConnection() {
    getConnectionCalls++;
    throw new LoadShedError(
      "Server is at capacity; too many concurrent queries in flight"
    );
  },
  releaseConnection() {
    releaseConnectionCalls++;
  },
  getSchema() {
    throw new Error("getSchema must not be called in READ_ONLY shed path");
  },
  invalidateSchemaCache() {},
  LoadShedError,
};

// Pass-through validator: we are testing 503 mapping, not validation.
const mockQueryValidator = {
  middleware: () => (req, res, next) => next(),
};

// Seed Node's real require.cache so Cypher.js's require() gets the mocks.
function seedModuleCache() {
  function fakeModule(id, exports) {
    const m = new (require("module").Module)(id, null);
    m.filename = id;
    m.loaded = true;
    m.exports = exports;
    require.cache[id] = m;
    return m;
  }
  fakeModule(DATABASE_PATH, mockDatabase);
  fakeModule(QUERY_VALIDATOR_PATH, mockQueryValidator);
  // SessionDatabase is optional. Cypher.js require()s it in a try/catch; if we
  // seed it as undefined-exports the require succeeds and sessionDb stays falsy.
  fakeModule(SESSION_DB_PATH, undefined);
  // Ensure Cypher.js itself is loaded fresh against the seeded deps.
  delete require.cache[CYPHER_PATH];
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

// Pull the real POST "/" body handler out of the router's layer stack (last
// handle registered on the route, after the validator middleware).
function getPostHandler(router) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === "/" && layer.route.methods.post) {
      const routeStack = layer.route.stack;
      return routeStack[routeStack.length - 1].handle;
    }
  }
  throw new Error("POST / route not found on router");
}

describe("Cypher.js real route: admission-control LoadShedError -> 503", () => {
  it("maps a shed getConnection() to a 503 with a generic at-capacity message and no raw error text", async () => {
    getConnectionCalls = 0;
    releaseConnectionCalls = 0;
    seedModuleCache();

    const router = require(CYPHER_PATH);
    const handler = getPostHandler(router);

    const req = { body: { query: "MATCH (n) RETURN n LIMIT 1" } };
    const res = mockRes();

    // Invoke the real handler. getConnection() throws the LoadShedError, which
    // the handler's catch maps to a 503 via sendErrorResponse.
    await handler(req, res, () => {});

    // The real route acquired (attempted) a connection...
    expect(getConnectionCalls).toBe(1);
    // ...and mapped the shed to a 503.
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: "Server is at capacity, please retry shortly",
    });
    // The raw internal error text must NOT leak to the client.
    expect(JSON.stringify(res.body)).not.toContain("too many concurrent queries");
    expect(JSON.stringify(res.body)).not.toContain("in flight");
  });
});
