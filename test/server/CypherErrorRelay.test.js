import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// Exercises the REAL Cypher.js router handler (not a look-alike) to prove that
// the query-execution catch path applies the error-sanitizer allowlist:
//   - a non-allowlisted execution error (e.g. Runtime/IO/Conversion) still
//     returns the fixed generic "Query execution failed" message;
//   - an allowlisted Parser/Binder error returns the sanitized user-facing text
//     in the SAME `error` response field the frontend already reads;
//   - a filesystem path fixture never appears in any response body.
//
// Same technique as CypherLoadShed.test.js / CypherRequestGuards.test.js:
// Cypher.js is CommonJS and requires Database/QueryValidator/SessionDatabase/
// RowBudget at module top (Database's constructor opens a real Kuzu DB). vitest's
// vi.mock does not reliably intercept that nested CommonJS require, so we bypass
// vitest's module runner: use a native Node require (createRequire) and pre-seed
// Node's real require.cache with mock modules BEFORE requiring Cypher.js. Here
// the mock connection's query() THROWS a shaped Kuzu error so the handler's
// catch path (the code under test) runs without ever opening a DB.

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const DATABASE_PATH = path.join(repoRoot, "src/server/utils/Database.js");
const QUERY_VALIDATOR_PATH = path.join(repoRoot, "src/server/middleware/QueryValidator.js");
const SESSION_DB_PATH = path.join(repoRoot, "src/server/utils/SessionDatabase.js");
const ROW_BUDGET_PATH = path.join(repoRoot, "src/server/middleware/RowBudget.js");
const CYPHER_PATH = path.join(repoRoot, "src/server/Cypher.js");

// The error the mock connection.query() will throw. Reassigned per test.
let queryError = null;

const mockConnection = {
  query() {
    return Promise.reject(queryError);
  },
};

const mockDatabase = {
  getAccessModeString: () => "READ_ONLY",
  getConnection() {
    return mockConnection;
  },
  releaseConnection() {},
  getSchema() {
    throw new Error("getSchema must not be called in READ_ONLY execute path");
  },
  invalidateSchemaCache() {},
};

const mockQueryValidator = {
  middleware: () => (req, res, next) => next(),
};

// Row budget disabled so it never blocks; debit is a no-op. keyForRequest must
// exist because the handler calls it before getConnection().
const mockRowBudget = {
  keyForRequest: () => "test-budget-key",
  isEnforced: () => false,
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
  fakeModule(SESSION_DB_PATH, undefined);
  fakeModule(ROW_BUDGET_PATH, mockRowBudget);
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
  seedModuleCache();
  const router = require(CYPHER_PATH);
  return getPostHandler(router);
}

async function runWithError(err) {
  queryError = err;
  const handler = freshHandler();
  const req = { body: { query: "MATCH (n) RETURN n LIMIT 1" } };
  const res = mockRes();
  await handler(req, res, () => {});
  return res;
}

describe("Cypher.js real route: sanitized error relay on the execution catch path", () => {
  it("keeps the generic message for a non-allowlisted Runtime exception", async () => {
    const res = await runWithError(new Error("Runtime exception: Divide by zero."));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Query execution failed" });
    // The raw Kuzu text never leaks.
    expect(JSON.stringify(res.body)).not.toContain("Divide by zero");
  });

  it("keeps the generic message for an IO exception that embeds an absolute path", async () => {
    const res = await runWithError(
      new Error("IO exception: could not open /database/horkos.kuzu")
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Query execution failed" });
    // The filesystem path fixture must not appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain("/database/horkos.kuzu");
    expect(JSON.stringify(res.body)).not.toContain("horkos.kuzu");
  });

  it("keeps the generic message for a Conversion exception (internal schema detail)", async () => {
    const res = await runWithError(
      new Error(
        "Conversion exception: Unsupported casting function from STRUCT(role STRING) to STRUCT(role STRING, control_type STRING)."
      )
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Query execution failed" });
    expect(JSON.stringify(res.body)).not.toContain("STRUCT");
  });

  it("relays a sanitized Binder exception in the error field", async () => {
    const res = await runWithError(
      new Error("Binder exception: Variable foo is not in scope.")
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "Binder exception: Variable foo is not in scope.",
    });
  });

  it("relays a sanitized Parser exception, keeping the echoed query line", async () => {
    const res = await runWithError(
      new Error(
        'Parser exception: Invalid input <RETURN>: expected rule oC_RegularQuery (line: 1, offset: 6)\n"RETURN"\n       '
      )
    );
    expect(res.statusCode).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toContain("Parser exception:");
    expect(res.body.error).toContain("(line: 1, offset: 6)");
  });

  it("redacts a filesystem path that appears inside an allowlisted Binder message", async () => {
    const res = await runWithError(
      new Error(
        "Binder exception: No file found that matches the pattern: /database/horkos.kuzu."
      )
    );
    expect(res.statusCode).toBe(400);
    // Relayed (Binder class) but the path is scrubbed.
    expect(res.body.error).toContain("Binder exception:");
    expect(res.body.error).toContain("[redacted]");
    expect(JSON.stringify(res.body)).not.toContain("/database/horkos.kuzu");
    expect(JSON.stringify(res.body)).not.toContain("horkos.kuzu");
  });

  it("still maps an interrupt/timeout error to 408 (unchanged), never relaying it", async () => {
    const res = await runWithError(new Error("Interrupted."));
    expect(res.statusCode).toBe(408);
    expect(res.body).toEqual({ error: "Query timed out" });
  });
});
