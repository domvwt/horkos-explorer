import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Suggest.js is a CommonJS module and pulls the DuckDB singleton in via
// require("./utils/DuckDB"). We must stub *that same* singleton instance, so we
// require() it here too - a vitest ESM `import` of the same file resolves to a
// DIFFERENT instance under CJS/ESM interop, and spying it would patch the wrong
// object (the handler would still see the un-stubbed require()'d singleton).
// The singleton only opens a connection when init() is called (never here), so
// requiring it is DB-free.
const duckdb = require("../../src/server/utils/DuckDB.js");
const suggestModule = require("../../src/server/Suggest.js");
const suggestRouter = suggestModule;
const {
  handleSuggest,
  buildRankedSql,
  buildLikeSql,
  buildLegacySql,
  ENTITY_TYPES,
} = suggestModule;

// A minimal Express-style res spy: records status + json payload.
function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function mockReq(query) {
  return { query };
}

// Capabilities where a table has the contract columns and (optionally) FTS.
function caps({ table, columns, fts }) {
  return {
    fts,
    tables: {
      [table]: { columns: new Set(columns), fts },
    },
  };
}

const CONTRACT = ["doc_id", "cluster_id", "canonical_name"];

describe("Suggest SQL builders", () => {
  it("buildRankedSql uses conjunctive := 1 on match_bm25 (AC#3)", () => {
    const sql = buildRankedSql(ENTITY_TYPES.Company);
    expect(sql).toContain("match_bm25(doc_id, ?, conjunctive := 1)");
  });

  it("buildRankedSql has three ? placeholders (query, start, limit)", () => {
    const sql = buildRankedSql(ENTITY_TYPES.Person);
    const placeholders = (sql.match(/\?/g) || []).length;
    expect(placeholders).toBe(3);
  });

  it("buildLikeSql is FTS-free (no match_bm25) and per-table", () => {
    const sql = buildLikeSql(ENTITY_TYPES.Company);
    expect(sql).not.toContain("match_bm25");
    expect(sql).toContain("search.company_names");
  });

  it("buildLikeSql has two ? placeholders (start, limit)", () => {
    const sql = buildLikeSql(ENTITY_TYPES.Address);
    const placeholders = (sql.match(/\?/g) || []).length;
    expect(placeholders).toBe(2);
  });

  it("buildLegacySql selects only name, no cluster_id / FTS", () => {
    const sql = buildLegacySql(ENTITY_TYPES.Person);
    expect(sql).not.toContain("match_bm25");
    expect(sql).not.toContain("cluster_id");
    expect(sql).toContain("SELECT name");
  });
});

describe("handleSuggest staged flow", () => {
  let querySpy;

  beforeEach(() => {
    vi.spyOn(duckdb, "isEnabled").mockReturnValue(true);
    querySpy = vi.spyOn(duckdb, "query").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports a router as the default export", () => {
    expect(typeof suggestRouter).toBe("function");
  });

  it("stage=fast runs the LIKE builder, never match_bm25 (AC#1)", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "company_names", columns: CONTRACT, fts: true })
    );
    const res = mockRes();
    await handleSuggest(
      mockReq({ q: "acme", type: "Company", stage: "fast" }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(querySpy).toHaveBeenCalledTimes(1);
    const sql = querySpy.mock.calls[0][0];
    expect(sql).not.toContain("match_bm25");
  });

  it("stage=rank runs the ranked BM25 builder (AC#2)", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "company_names", columns: CONTRACT, fts: true })
    );
    const res = mockRes();
    await handleSuggest(
      mockReq({ q: "acme corp", type: "Company", stage: "rank" }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(querySpy).toHaveBeenCalledTimes(1);
    const sql = querySpy.mock.calls[0][0];
    expect(sql).toContain("match_bm25(doc_id, ?, conjunctive := 1)");
  });

  it("stage=rank returns [] without querying when FTS is unavailable", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "company_names", columns: CONTRACT, fts: false })
    );
    const res = mockRes();
    await handleSuggest(
      mockReq({ q: "acme", type: "Company", stage: "rank" }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("a stage=rank failure does NOT flip the process-wide FTS flag", async () => {
    const capabilities = caps({
      table: "company_names",
      columns: CONTRACT,
      fts: true,
    });
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(capabilities);
    querySpy.mockRejectedValueOnce(new Error("bm25 timed out"));
    const res = mockRes();
    await handleSuggest(
      mockReq({ q: "acme", type: "Company", stage: "rank" }),
      res
    );
    expect(res.statusCode).toBe(500);
    // The isolation guarantee: FTS remains enabled for every other user.
    expect(capabilities.tables.company_names.fts).toBe(true);
  });

  it("rejects an invalid stage value with 400", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "company_names", columns: CONTRACT, fts: true })
    );
    const res = mockRes();
    await handleSuggest(
      mockReq({ q: "acme", type: "Company", stage: "bogus" }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(querySpy).not.toHaveBeenCalled();
  });
});

describe("handleSuggest non-staged / fallback paths (AC#5)", () => {
  let querySpy;

  beforeEach(() => {
    vi.spyOn(duckdb, "isEnabled").mockReturnValue(true);
    querySpy = vi.spyOn(duckdb, "query").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no stage + FTS available runs the fast LIKE query (unstaged default)", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "person_names", columns: CONTRACT, fts: true })
    );
    const res = mockRes();
    await handleSuggest(mockReq({ q: "john smith", type: "Person" }), res);
    expect(res.statusCode).toBe(200);
    // Unstaged requests serve the cheap prefix path; BM25 only runs when the
    // client explicitly asks for the stage=rank upgrade.
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0][0]).not.toContain("match_bm25");
  });

  it("no stage + FTS unavailable runs the LIKE query", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "person_names", columns: CONTRACT, fts: false })
    );
    const res = mockRes();
    await handleSuggest(mockReq({ q: "john", type: "Person" }), res);
    expect(res.statusCode).toBe(200);
    expect(querySpy.mock.calls[0][0]).not.toContain("match_bm25");
  });

  it("no stage + LIKE query failure returns 500 without touching the FTS flag", async () => {
    const capabilities = caps({
      table: "person_names",
      columns: CONTRACT,
      fts: true,
    });
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(capabilities);
    querySpy.mockRejectedValueOnce(new Error("db gone"));
    const res = mockRes();
    await handleSuggest(mockReq({ q: "john", type: "Person" }), res);
    // The unstaged default IS the LIKE path now; there is no ranked query to
    // degrade from, and a LIKE failure must not disable FTS for other users.
    expect(res.statusCode).toBe(500);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(capabilities.tables.person_names.fts).toBe(true);
  });

  it("legacy pre-contract table runs the legacy query and nulls cluster ids", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "person_names", columns: ["name", "name_normalized"], fts: false })
    );
    querySpy.mockResolvedValueOnce([{ name: "John Smith" }]);
    const res = mockRes();
    await handleSuggest(mockReq({ q: "john", type: "Person" }), res);
    expect(res.statusCode).toBe(200);
    expect(querySpy.mock.calls[0][0]).toContain("SELECT name");
    expect(res.body).toEqual([
      {
        name: "John Smith",
        cluster_id: null,
        canonical_name: null,
        disambiguators: {},
        score: 0,
      },
    ]);
  });

  it("stage=fast falls through to legacy on a pre-contract table", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "person_names", columns: ["name", "name_normalized"], fts: false })
    );
    querySpy.mockResolvedValueOnce([{ name: "Jane Doe" }]);
    const res = mockRes();
    await handleSuggest(
      mockReq({ q: "jane", type: "Person", stage: "fast" }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(querySpy.mock.calls[0][0]).toContain("SELECT name");
  });
});

describe("handleSuggest guard rails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 when DuckDB is disabled", async () => {
    vi.spyOn(duckdb, "isEnabled").mockReturnValue(false);
    const res = mockRes();
    await handleSuggest(mockReq({ q: "acme", type: "Company" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a too-short query", async () => {
    vi.spyOn(duckdb, "isEnabled").mockReturnValue(true);
    const res = mockRes();
    await handleSuggest(mockReq({ q: "a", type: "Company" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an unknown entity type", async () => {
    vi.spyOn(duckdb, "isEnabled").mockReturnValue(true);
    const res = mockRes();
    await handleSuggest(mockReq({ q: "acme", type: "Widget" }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe("handleSuggest load shedding maps to 503", () => {
  // A res spy that also records Retry-After set via res.set().
  function shedRes() {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      set(name, value) {
        this.headers[name] = value;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  // Shape matches DuckDB.js's LoadShedError (name + status 503).
  class LoadShedError extends Error {
    constructor(message) {
      super(message);
      this.name = "LoadShedError";
      this.status = 503;
    }
  }

  beforeEach(() => {
    vi.spyOn(duckdb, "isEnabled").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a shed query on the fast stage to 503 with Retry-After, no raw text", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "company_names", columns: CONTRACT, fts: true })
    );
    vi.spyOn(duckdb, "query").mockRejectedValue(
      new LoadShedError("too many concurrent autocomplete queries")
    );
    const res = shedRes();
    await handleSuggest(
      mockReq({ q: "acme", type: "Company", stage: "fast" }),
      res
    );
    expect(res.statusCode).toBe(503);
    expect(res.headers["Retry-After"]).toBe("1");
    expect(res.body).toEqual({ error: "Search is busy, please retry shortly" });
    // Internal message must not leak.
    expect(JSON.stringify(res.body)).not.toContain("concurrent");
  });

  it("maps a shed query on the rank stage to 503", async () => {
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(
      caps({ table: "company_names", columns: CONTRACT, fts: true })
    );
    vi.spyOn(duckdb, "query").mockRejectedValue(new LoadShedError("shed"));
    const res = shedRes();
    await handleSuggest(
      mockReq({ q: "acme", type: "Company", stage: "rank" }),
      res
    );
    expect(res.statusCode).toBe(503);
    expect(res.headers["Retry-After"]).toBe("1");
  });

  it("a shed on the non-staged ranked path returns 503 without flipping FTS off", async () => {
    const capabilities = caps({
      table: "person_names",
      columns: CONTRACT,
      fts: true,
    });
    vi.spyOn(duckdb, "getCapabilities").mockResolvedValue(capabilities);
    vi.spyOn(duckdb, "query").mockRejectedValue(new LoadShedError("shed"));
    const res = shedRes();
    await handleSuggest(mockReq({ q: "john smith", type: "Person" }), res);
    expect(res.statusCode).toBe(503);
    // Transient backpressure must not disable ranked search for everyone.
    expect(capabilities.tables.person_names.fts).toBe(true);
  });
});
