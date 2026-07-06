import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// Exercises the REAL Cypher.js router handler (not a look-alike) to prove the
// query/params request-validation guards actually reject malformed request
// bodies. Regression test for a dead operator-precedence bug: the guards used
// to read `!typeof query === "string"` / `!typeof params === "object"`, where
// `!typeof x` evaluates first (typeof always yields a non-empty string, so
// `!typeof x` is always `false`), making the comparison to "string"/"object"
// always false — the guards never fired, and a truthy non-string query or
// non-object params slipped straight through to downstream layers (query
// execution / Object.keys(params)).
//
// Same technique as CypherLoadShed.test.js: Cypher.js is CommonJS and requires
// Database/QueryValidator/SessionDatabase/RowBudget at module top, and
// Database's constructor opens a real Kuzu DB. vitest's vi.mock does not
// reliably intercept that nested CommonJS require, so we bypass vitest's
// module runner entirely — use a native Node require (createRequire) and
// pre-seed Node's real require.cache with mock modules BEFORE requiring
// Cypher.js. This guarantees Cypher.js's own require() resolves to the mocks
// and the guards under test are reached without ever opening a DB or a server.
//
// The admission-control invariant (a rejected request must never touch the
// row-budget pre-check or the connection pool) is asserted directly: every
// 400 case expects rowBudgetKeyCalls === 0 and getConnectionCalls === 0,
// while the pass-through cases expect both to be 1.

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const DATABASE_PATH = path.join(repoRoot, "src/server/utils/Database.js");
const QUERY_VALIDATOR_PATH = path.join(repoRoot, "src/server/middleware/QueryValidator.js");
const SESSION_DB_PATH = path.join(repoRoot, "src/server/utils/SessionDatabase.js");
const ROW_BUDGET_PATH = path.join(repoRoot, "src/server/middleware/RowBudget.js");
const CYPHER_PATH = path.join(repoRoot, "src/server/Cypher.js");

let getConnectionCalls = 0;
let rowBudgetKeyCalls = 0;

const mockDatabase = {
  getAccessModeString: () => "READ_ONLY",
  getConnection() {
    getConnectionCalls++;
    // A request that passes all guards legitimately reaches this point. Throw
    // a plain Error (no .status) so the handler's getConnection catch maps it
    // to 503 — the test only needs proof the guards were passed, not a query.
    throw new Error("stop at the pool: guards already passed");
  },
  releaseConnection() {},
  getSchema() {
    throw new Error("getSchema must not be called for this route in READ_ONLY mode");
  },
  invalidateSchemaCache() {},
};

// Pass-through validator: we are testing the guards inside the route handler
// itself, not the QueryValidator middleware that runs before it.
const mockQueryValidator = {
  middleware: () => (req, res, next) => next(),
};

// The row-budget pre-check runs AFTER the guards under test and BEFORE
// getConnection(). keyForRequest counts calls so the 400 tests can prove the
// early return fired before the pre-check; isEnforced returns false so the
// budget never blocks a passing request (check must then never be called).
const mockRowBudget = {
  keyForRequest() {
    rowBudgetKeyCalls++;
    return "test-budget-key";
  },
  isEnforced() {
    return false;
  },
  check() {
    throw new Error("rowBudget.check must not be called when isEnforced() is false");
  },
  debit() {},
};

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
  fakeModule(ROW_BUDGET_PATH, mockRowBudget);
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

function freshHandler() {
  getConnectionCalls = 0;
  rowBudgetKeyCalls = 0;
  seedModuleCache();
  const router = require(CYPHER_PATH);
  return getPostHandler(router);
}

describe("Cypher.js real route: query/params request-validation guards", () => {
  it("400s a non-string truthy query (array)", async () => {
    const handler = freshHandler();
    const req = { body: { query: ["MATCH (n) RETURN n"] } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "The query must be a string with length > 0",
    });
    // Position invariant: the 400 fired before the row-budget pre-check and
    // before the pool acquisition (admission control).
    expect(rowBudgetKeyCalls).toBe(0);
    expect(getConnectionCalls).toBe(0);
  });

  it("400s a non-string truthy query (number)", async () => {
    const handler = freshHandler();
    const req = { body: { query: 42 } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "The query must be a string with length > 0",
    });
    // Position invariant: the 400 fired before the row-budget pre-check and
    // before the pool acquisition (admission control).
    expect(rowBudgetKeyCalls).toBe(0);
    expect(getConnectionCalls).toBe(0);
  });

  it("400s a falsy query (empty string) via the existing !query branch", async () => {
    const handler = freshHandler();
    const req = { body: { query: "" } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "The query must be a string with length > 0",
    });
    // Position invariant: the 400 fired before the row-budget pre-check and
    // before the pool acquisition (admission control).
    expect(rowBudgetKeyCalls).toBe(0);
    expect(getConnectionCalls).toBe(0);
  });

  it("400s a non-object params (string)", async () => {
    const handler = freshHandler();
    const req = {
      body: { query: "MATCH (n) RETURN n LIMIT 1", params: "str" },
    };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Params must be an object" });
    // Position invariant: the 400 fired before the row-budget pre-check and
    // before the pool acquisition (admission control).
    expect(rowBudgetKeyCalls).toBe(0);
    expect(getConnectionCalls).toBe(0);
  });

  it("400s a non-object params (number)", async () => {
    const handler = freshHandler();
    const req = {
      body: { query: "MATCH (n) RETURN n LIMIT 1", params: 42 },
    };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Params must be an object" });
    // Position invariant: the 400 fired before the row-budget pre-check and
    // before the pool acquisition (admission control).
    expect(rowBudgetKeyCalls).toBe(0);
    expect(getConnectionCalls).toBe(0);
  });

  it("null params is falsy and skips the params guard (existing `params &&` short-circuit, unchanged)", async () => {
    const handler = freshHandler();
    const req = {
      body: { query: "MATCH (n) RETURN n LIMIT 1", params: null },
    };
    const res = mockRes();

    await handler(req, res, () => {});

    // Passes both guards, runs the row-budget pre-check, and proceeds to
    // getConnection(); our mock throws there and the handler maps it to 503.
    expect(res.statusCode).toBe(503);
    expect(rowBudgetKeyCalls).toBe(1);
    expect(getConnectionCalls).toBe(1);
  });

  it("a valid string query with object params passes both guards and reaches getConnection()", async () => {
    const handler = freshHandler();
    const req = {
      body: {
        query: "MATCH (n) RETURN n LIMIT 1",
        params: { id: "abc" },
      },
    };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(503);
    expect(rowBudgetKeyCalls).toBe(1);
    expect(getConnectionCalls).toBe(1);
  });

  it("a valid string query with no params passes both guards and reaches getConnection()", async () => {
    const handler = freshHandler();
    const req = { body: { query: "MATCH (n) RETURN n LIMIT 1" } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(503);
    expect(rowBudgetKeyCalls).toBe(1);
    expect(getConnectionCalls).toBe(1);
  });
});
