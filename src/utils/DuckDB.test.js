// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

// The DuckDB-WASM engine (duckdb-eh.wasm + worker) is ~10MB+ over the wire and
// exists solely to power client-side CSV/Parquet parsing in the Importer, a
// view hidden outside READ_WRITE. Read-only visitors must NEVER fetch it, so
// the client wrapper must not instantiate the engine at construction/import
// time — only on demand when a consumer first needs the DB.
//
// We mock the WASM package so "instantiation" is observable and counted, then
// assert (a) importing/constructing the singleton fetches nothing, and (b)
// init()/getDb() are single-flight (concurrent callers instantiate once).

let instantiateCount = 0;

vi.mock("@duckdb/duckdb-wasm", () => {
  class AsyncDuckDB {
    constructor() {
      instantiateCount += 1;
    }
    async instantiate() {}
    async connect() {
      return {
        query: async () => ({ toArray: () => [{ toJSON: () => ({ '"version"()': "mock" }) }] }),
        close: async () => {},
      };
    }
  }
  return {
    DuckDBDataProtocol: { BROWSER_FILEREADER: 0 },
    ConsoleLogger: class {},
    AsyncDuckDB,
    // A single-slice bundle is enough; init() only reads mainWorker/mainModule.
    selectBundle: async (bundles) => bundles.eh,
  };
});

// happy-dom has no Worker; the wrapper only constructs one, never uses it here.
beforeEach(() => {
  instantiateCount = 0;
  vi.resetModules();
  globalThis.Worker = class {};
});

async function freshDuckDB() {
  // Fresh module registry each time so the singleton is reconstructed and its
  // "already initialised" state does not leak between tests.
  const mod = await import("./DuckDB");
  return mod.default;
}

describe("DuckDB engine is not instantiated at import time", () => {
  it("constructing the singleton fetches/instantiates nothing", async () => {
    await freshDuckDB();
    expect(instantiateCount).toBe(0);
  });
});

describe("init() is idempotent single-flight", () => {
  it("instantiates exactly once across concurrent init() calls", async () => {
    const duck = await freshDuckDB();
    await Promise.all([duck.init(), duck.init(), duck.init()]);
    expect(instantiateCount).toBe(1);
  });

  it("does not re-instantiate on a later init() once ready", async () => {
    const duck = await freshDuckDB();
    await duck.init();
    await duck.init();
    expect(instantiateCount).toBe(1);
  });

  it("instantiates on demand via getDb() and shares the single flight", async () => {
    const duck = await freshDuckDB();
    const [a, b] = await Promise.all([duck.getDb(), duck.getDb()]);
    expect(instantiateCount).toBe(1);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("allows a retry after a failed instantiation", async () => {
    const duck = await freshDuckDB();
    // Force the first flight to reject, then confirm a later init retries
    // instead of latching onto the poisoned promise.
    const boom = new Error("instantiate failed");
    const spy = vi.spyOn(duck, "_instantiate");
    spy.mockRejectedValueOnce(boom);
    await expect(duck.init()).rejects.toThrow("instantiate failed");
    spy.mockRestore();
    await duck.init();
    expect(instantiateCount).toBe(1);
  });
});
