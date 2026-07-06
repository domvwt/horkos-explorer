import { describe, it, expect, beforeAll, vi } from "vitest";

// Imported DB-free via the KUZU_WASM early-return (see AdmissionControl.test.js
// for the rationale). getSchema() calls this._computeSchema() as a separate
// prototype method, which is the clean seam: we replace it with a spy and count
// calls to prove the READ_ONLY caching contract without any DB round-trip.

let db;

beforeAll(async () => {
  vi.stubEnv("KUZU_WASM", "true");
  vi.stubEnv("MODE", "READ_ONLY");
  const mod = await import("../../src/server/utils/Database.js");
  db = mod.default;
});

describe("Database.getSchema caching (real getSchema/invalidateSchemaCache)", () => {
  it("READ_ONLY: computes once, then serves the cache; invalidate forces a recompute", async () => {
    const computed = { nodeTables: [], relTables: [] };
    db.isReadOnlyMode = true;
    db.cachedSchema = null;
    db._computeSchema = vi.fn().mockResolvedValue(computed);

    // First call: cache miss -> compute + cache.
    const first = await db.getSchema();
    expect(db._computeSchema).toHaveBeenCalledTimes(1);
    expect(first).toBe(computed);
    expect(db.cachedSchema).toBe(computed);

    // Second call: cache hit -> NO recompute, same object returned.
    const second = await db.getSchema();
    expect(db._computeSchema).toHaveBeenCalledTimes(1);
    expect(second).toBe(computed);

    // Invalidate clears the cache so the next call recomputes.
    db.invalidateSchemaCache();
    expect(db.cachedSchema).toBeNull();

    const third = await db.getSchema();
    expect(db._computeSchema).toHaveBeenCalledTimes(2);
    expect(third).toBe(computed);
  });

  it("READ_WRITE: never caches — recomputes on every call", async () => {
    db.isReadOnlyMode = false;
    db.cachedSchema = null;
    db._computeSchema = vi.fn().mockResolvedValue({ nodeTables: [], relTables: [] });

    await db.getSchema();
    await db.getSchema();
    await db.getSchema();

    // No caching in write mode: one compute per call.
    expect(db._computeSchema).toHaveBeenCalledTimes(3);
    // And nothing is retained in cachedSchema.
    expect(db.cachedSchema).toBeNull();
  });

  it("invalidateSchemaCache is a safe no-op when nothing is cached", () => {
    db.cachedSchema = null;
    expect(() => db.invalidateSchemaCache()).not.toThrow();
    expect(db.cachedSchema).toBeNull();
  });
});
