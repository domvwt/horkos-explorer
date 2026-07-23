import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// Exercises the REAL Cypher.js router handler (not a look-alike) to prove:
//   1. KUZU_QUERY_SIZE_LIMIT is a per-REQUEST budget shared across every
//      statement in a multi-statement batch, not a per-statement cap.
//   2. RowBudget is debited the exact number of rows actually shipped under
//      that aggregate cap.
//   3. queryMap hygiene: progress without a client uuid registers nothing, and
//      the map is hard-capped so a client cannot grow it without bound.
//
// Same technique as CypherLoadShed / CypherRequestGuards: Cypher.js is CommonJS
// and require()s Database/QueryValidator/SessionDatabase/RowBudget at module
// top (Database's constructor opens a real Kuzu DB). vitest's vi.mock does not
// reliably intercept nested CommonJS require, so we bypass the vitest module
// runner entirely and pre-seed Node's real require.cache with mocks BEFORE
// requiring Cypher.js. KUZU_QUERY_SIZE_LIMIT is read from the environment at
// module load, so we set it before the fresh require.

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const DATABASE_PATH = path.join(repoRoot, "src/server/utils/Database.js");
const QUERY_VALIDATOR_PATH = path.join(repoRoot, "src/server/middleware/QueryValidator.js");
const SESSION_DB_PATH = path.join(repoRoot, "src/server/utils/SessionDatabase.js");
const ROW_BUDGET_PATH = path.join(repoRoot, "src/server/middleware/RowBudget.js");
const CYPHER_PATH = path.join(repoRoot, "src/server/Cypher.js");

// The aggregate cap under test. A small value keeps the fixtures readable while
// exercising the exact same code path as the production default (10000).
const SIZE_LIMIT = 5;

// ---------------------------------------------------------------------------
// Mock Kuzu result: implements the exact surface processSingleResult() uses.
// `tuples` is the full set of rows this statement would return; getNext() walks
// them one at a time (used by the capped path) and getAll() returns them all
// (used by the within-cap path). getNumTuples() reports the untruncated size so
// the handler can detect truncation.
// ---------------------------------------------------------------------------
function makeResult(tuples) {
  let cursor = 0;
  return {
    closed: false,
    getNumTuples() {
      return tuples.length;
    },
    async getAll() {
      return tuples.slice();
    },
    async getNext() {
      return tuples[cursor++];
    },
    async getColumnDataTypes() {
      return ["INT64"];
    },
    async getColumnNames() {
      return ["n"];
    },
    close() {
      this.closed = true;
    },
  };
}

// Build `count` rows of the shape the mock result column implies.
function rows(count) {
  return Array.from({ length: count }, (_, i) => ({ n: i }));
}

let debitCalls;
let queryResultFactory;
let progressCallbackInvoker;

function makeConnection() {
  return {
    async query(queryStr, progressCallback) {
      // If the handler passed a progress callback (req.body.progress), let the
      // test decide whether/how to drive it before the result is produced.
      if (typeof progressCallback === "function" && progressCallbackInvoker) {
        progressCallbackInvoker(progressCallback);
      }
      return queryResultFactory();
    },
    async prepare() {
      throw new Error("prepare() must not be called in these tests");
    },
    async execute() {
      throw new Error("execute() must not be called in these tests");
    },
  };
}

const mockDatabase = {
  getAccessModeString: () => "READ_ONLY",
  getConnection() {
    return makeConnection();
  },
  releaseConnection() {},
  getSchema() {
    throw new Error("getSchema must not be called in READ_ONLY mode");
  },
  invalidateSchemaCache() {},
};

const mockQueryValidator = {
  middleware: () => (req, res, next) => next(),
};

// RowBudget mock: enforced (READ_ONLY), always admits, and records every debit
// so a test can assert the exact rows shipped were debited.
const mockRowBudget = {
  keyForRequest() {
    return "test-budget-key";
  },
  isEnforced() {
    return true;
  },
  check() {
    return { allowed: true, retryAfterMs: 0 };
  },
  debit(key, rowCount) {
    debitCalls.push({ key, rowCount });
  },
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
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(payload) {
      // The real handler JSON.stringifies the body before send(); parse it back
      // so assertions read a plain object.
      this.body = typeof payload === "string" ? JSON.parse(payload) : payload;
      return this;
    },
    json(payload) {
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

// The progress GET lives on its own sub-router (exported as `progressRouter`
// beside the main router) so API.js can mount it under the general api
// limiter instead of the query limiter — progress polling must not burn
// query-rate-limit tokens.
function getProgressHandler(router) {
  for (const layer of router.progressRouter.stack) {
    if (
      layer.route &&
      layer.route.path === "/:uuid" &&
      layer.route.methods.get
    ) {
      const routeStack = layer.route.stack;
      return routeStack[routeStack.length - 1].handle;
    }
  }
  throw new Error("GET /:uuid route not found on progress router");
}

let savedSizeLimit;

beforeEach(() => {
  savedSizeLimit = process.env.KUZU_QUERY_SIZE_LIMIT;
  process.env.KUZU_QUERY_SIZE_LIMIT = String(SIZE_LIMIT);
  debitCalls = [];
  queryResultFactory = null;
  progressCallbackInvoker = null;
  seedModuleCache();
});

afterEach(() => {
  if (savedSizeLimit === undefined) {
    delete process.env.KUZU_QUERY_SIZE_LIMIT;
  } else {
    process.env.KUZU_QUERY_SIZE_LIMIT = savedSizeLimit;
  }
});

function freshRouter() {
  return require(CYPHER_PATH);
}

describe("Cypher.js /api/cypher: per-request aggregate row cap", () => {
  it("caps a single statement at the limit and flags it truncated (behaviour unchanged)", async () => {
    // 8 tuples, limit 5 -> ships 5, truncated. Single-statement path.
    queryResultFactory = () => makeResult(rows(8));
    const handler = getPostHandler(freshRouter());
    const req = { body: { query: "MATCH (n) RETURN n" } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(res.body.isMultiStatement).toBe(false);
    expect(res.body.rows).toHaveLength(SIZE_LIMIT);
    expect(res.body.truncated).toBe(true);
  });

  it("single statement within the limit is byte-identical to before (no truncated key)", async () => {
    // 3 tuples, limit 5 -> ships all 3, NOT truncated. This is the regression
    // pin: the non-truncated single-statement response must be exactly the
    // legacy shape { rows, dataTypes, isSchemaChanged, isMultiStatement }.
    queryResultFactory = () => makeResult(rows(3));
    const handler = getPostHandler(freshRouter());
    const req = { body: { query: "MATCH (n) RETURN n" } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      rows: rows(3),
      dataTypes: { n: "INT64" },
      isSchemaChanged: false,
      isMultiStatement: false,
    });
    expect("truncated" in res.body).toBe(false);
  });

  it("statement 1 consuming the whole budget forces statement 2 to 0 rows + truncated", async () => {
    // Two statements, each would return 8 tuples. Limit 5 is the REQUEST budget:
    // statement 1 ships 5 (truncated), statement 2 gets 0 remaining -> ships 0
    // rows but still flags truncated because it had tuples to give.
    // A multi-statement request: conn.query() returns an ARRAY of results.
    queryResultFactory = () => [makeResult(rows(8)), makeResult(rows(8))];

    const handler = getPostHandler(freshRouter());
    const req = { body: { query: "MATCH (n) RETURN n; MATCH (m) RETURN m" } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(res.body.isMultiStatement).toBe(true);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].rows).toHaveLength(5);
    expect(res.body.results[0].truncated).toBe(true);
    expect(res.body.results[1].rows).toHaveLength(0);
    expect(res.body.results[1].truncated).toBe(true);

    // Acceptance criterion #1: total rows across ALL statements <= the limit.
    const total = res.body.results.reduce((s, r) => s + r.rows.length, 0);
    expect(total).toBe(SIZE_LIMIT);
    expect(total).toBeLessThanOrEqual(SIZE_LIMIT);
  });

  it("splits the budget across statements, summing exactly to the cap", async () => {
    // Statement 1 has 2 tuples (fits, not truncated), statement 2 has 8 tuples
    // (only 3 of the budget left -> ships 3, truncated). 2 + 3 = 5 = limit.
    queryResultFactory = () => [makeResult(rows(2)), makeResult(rows(8))];

    const handler = getPostHandler(freshRouter());
    const req = { body: { query: "MATCH (a) RETURN a; MATCH (b) RETURN b" } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.body.results[0].rows).toHaveLength(2);
    expect("truncated" in res.body.results[0]).toBe(false);
    expect(res.body.results[1].rows).toHaveLength(3);
    expect(res.body.results[1].truncated).toBe(true);

    const total = res.body.results.reduce((s, r) => s + r.rows.length, 0);
    expect(total).toBe(SIZE_LIMIT);
  });

  it("a multi-statement batch that fits under the budget is not truncated", async () => {
    // 2 + 2 = 4 <= 5. Neither statement is capped.
    queryResultFactory = () => [makeResult(rows(2)), makeResult(rows(2))];

    const handler = getPostHandler(freshRouter());
    const req = { body: { query: "MATCH (a) RETURN a; MATCH (b) RETURN b" } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(res.body.results[0].rows).toHaveLength(2);
    expect(res.body.results[1].rows).toHaveLength(2);
    expect("truncated" in res.body.results[0]).toBe(false);
    expect("truncated" in res.body.results[1]).toBe(false);
  });
});

describe("Cypher.js /api/cypher: RowBudget debit under the aggregate cap", () => {
  it("debits the exact rows shipped for a capped single statement", async () => {
    queryResultFactory = () => makeResult(rows(8));
    const handler = getPostHandler(freshRouter());
    const req = { body: { query: "MATCH (n) RETURN n" } };
    const res = mockRes();

    await handler(req, res, () => {});

    expect(debitCalls).toHaveLength(1);
    expect(debitCalls[0].rowCount).toBe(SIZE_LIMIT);
  });

  it("debits the aggregate shipped rows for a multi-statement batch (sums to the cap)", async () => {
    queryResultFactory = () => [makeResult(rows(2)), makeResult(rows(8))];
    const handler = getPostHandler(freshRouter());
    const req = { body: { query: "MATCH (a) RETURN a; MATCH (b) RETURN b" } };
    const res = mockRes();

    await handler(req, res, () => {});

    // 2 (stmt1) + 3 (stmt2, budget-clipped) = 5 rows actually shipped.
    expect(debitCalls).toHaveLength(1);
    expect(debitCalls[0].rowCount).toBe(SIZE_LIMIT);
  });
});

describe("Cypher.js /api/cypher: queryMap hygiene", () => {
  it("progress without a client uuid registers nothing", async () => {
    // Drive the progress callback exactly as Kuzu would, but with no uuid on the
    // request body. Nothing must be written to queryMap (no `undefined` key).
    queryResultFactory = () => makeResult(rows(1));
    progressCallbackInvoker = (cb) => cb(0.5, 0, 1);

    const router = freshRouter();
    const postHandler = getPostHandler(router);
    const progressHandler = getProgressHandler(router);

    const req = { body: { query: "MATCH (n) RETURN n", progress: true } };
    const res = mockRes();
    await postHandler(req, res, () => {});
    expect(res.statusCode).toBe(200);

    // The progress route is the only window into queryMap; an "undefined" key
    // would surface as a stringified lookup. Assert it is absent (404).
    const progReq = { params: { uuid: "undefined" } };
    const progRes = mockRes();
    progressHandler(progReq, progRes, () => {});
    expect(progRes.statusCode).toBe(404);
  });

  it("progress with a client uuid registers and is polled during the query, then cleaned up", async () => {
    const clientUuid = "123e4567-e89b-42d3-a456-556642440000";
    const router = freshRouter();
    const postHandler = getPostHandler(router);
    const progressHandler = getProgressHandler(router);

    // Drive the callback, then WHILE it is registered (before the request
    // finally-block deletes it) poll the progress route from inside the query.
    let polledDuringQuery = null;
    queryResultFactory = () => makeResult(rows(1));
    progressCallbackInvoker = (cb) => {
      cb(0.75, 1, 2);
      const progRes = mockRes();
      progressHandler({ params: { uuid: clientUuid } }, progRes, () => {});
      polledDuringQuery = { status: progRes.statusCode, body: progRes.body };
    };

    const req = {
      body: { query: "MATCH (n) RETURN n", progress: true, uuid: clientUuid },
    };
    const res = mockRes();
    await postHandler(req, res, () => {});

    // During the query the uuid was live and polling returned the tick.
    expect(polledDuringQuery.status).toBe(200);
    expect(polledDuringQuery.body).toEqual({
      pipelineProgress: 0.75,
      numPipelinesFinished: 1,
      numPipelines: 2,
    });

    // After the request completes, the finally-block dropped the entry.
    const afterRes = mockRes();
    progressHandler({ params: { uuid: clientUuid } }, afterRes, () => {});
    expect(afterRes.statusCode).toBe(404);
  });

  it("does not register a NEW uuid when the map is at its hard cap", async () => {
    // Fill queryMap to its cap with live entries, then prove a fresh uuid is
    // refused (never evicting a live entry). We reach into the map through a
    // sequence of concurrent-style progress registrations: because the handler
    // deletes on completion, we instead keep entries live by NOT completing —
    // drive many progress callbacks whose requests are still "in flight".
    //
    // The map is module-internal, so we exercise the cap through many overlapping
    // in-flight progress queries. Each keeps its entry until its own request's
    // finally runs; we hold them open by awaiting them all together.
    const router = freshRouter();
    const postHandler = getPostHandler(router);
    const progressHandler = getProgressHandler(router);

    const CAP = 1000;
    // A gate that lets every in-flight query register its progress entry and
    // then park until we release them, so all CAP+1 entries are live at once.
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const uuidFor = (i) => {
      // Deterministic distinct v4-shaped uuids.
      const hex = i.toString(16).padStart(12, "0");
      return `123e4567-e89b-42d3-a456-${hex}`;
    };

    const inFlight = [];
    const capturedResults = [];
    // Each query: register its progress tick, then park on the gate before
    // returning a result (so its queryMap entry stays live).
    for (let i = 0; i < CAP + 1; i++) {
      const id = uuidFor(i);
      const localReq = {
        body: { query: "MATCH (n) RETURN n", progress: true, uuid: id },
      };
      const localRes = mockRes();
      // Custom connection per query that registers progress then awaits the gate.
      const conn = {
        async query(queryStr, progressCallback) {
          progressCallback(0.1 * (i % 10), 0, 1);
          await gate;
          return makeResult(rows(0));
        },
      };
      // Temporarily point the shared database mock at this connection.
      const savedGet = mockDatabase.getConnection;
      mockDatabase.getConnection = () => conn;
      const p = postHandler(localReq, localRes, () => {}).then(() =>
        capturedResults.push(localRes)
      );
      mockDatabase.getConnection = savedGet;
      inFlight.push(p);
    }

    // Give every parked query a tick to register its progress entry.
    await new Promise((r) => setImmediate(r));

    // The first CAP uuids are live; the (CAP+1)-th must have been REFUSED
    // registration (cap reached), so polling it returns 404 while an early one
    // returns 200.
    const earlyRes = mockRes();
    progressHandler({ params: { uuid: uuidFor(0) } }, earlyRes, () => {});
    expect(earlyRes.statusCode).toBe(200);

    const overflowRes = mockRes();
    progressHandler({ params: { uuid: uuidFor(CAP) } }, overflowRes, () => {});
    expect(overflowRes.statusCode).toBe(404);

    // Release all parked queries and let them finish cleanly.
    release();
    await Promise.all(inFlight);
  });
});
