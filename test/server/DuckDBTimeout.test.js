import { describe, it, expect, vi } from "vitest";

// The DuckDB module exports a singleton. Importing it only constructs the
// manager (no connection opened until init() is called, which we never do
// here), so this test never touches a real database. We exercise the
// statement-timeout wrapper (_withTimeout) directly with fake promises.
import duckdb from "../../src/server/utils/DuckDB.js";

describe("DuckDB _withTimeout statement-timeout wrapper", () => {
  it("resolves with the query result when the query beats the timeout", async () => {
    const conn = {};
    const fast = Promise.resolve("rows");
    const result = await duckdb._withTimeout(conn, fast, 1000);
    expect(result).toBe("rows");
  });

  it("rejects with a tagged timeout error when the query is too slow", async () => {
    // A promise that never settles simulates an unbounded full-table scan.
    const conn = {};
    const neverSettles = new Promise(() => {});
    await expect(duckdb._withTimeout(conn, neverSettles, 20)).rejects.toThrow(
      /exceeded 20ms timeout/
    );
  });

  it("tags the timeout rejection with __duckdbTimeout so query() replaces the slot", async () => {
    const conn = {};
    const neverSettles = new Promise(() => {});
    let caught;
    try {
      await duckdb._withTimeout(conn, neverSettles, 10);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.__duckdbTimeout).toBe(true);
  });

  it("does NOT tag a non-timeout rejection (a genuine query error)", async () => {
    const conn = {};
    const failing = Promise.reject(new Error("syntax error"));
    let caught;
    try {
      await duckdb._withTimeout(conn, failing, 1000);
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toContain("syntax error");
    expect(caught.__duckdbTimeout).toBeUndefined();
  });

  it("clears the timer when the query completes in time (no dangling reject)", async () => {
    const conn = {};
    const result = await duckdb._withTimeout(conn, Promise.resolve(42), 1000);
    expect(result).toBe(42);
    // Give any (erroneously) un-cleared timer a chance to fire; it must not.
    await new Promise((r) => setTimeout(r, 20));
    expect(result).toBe(42);
    vi.restoreAllMocks();
  });
});
