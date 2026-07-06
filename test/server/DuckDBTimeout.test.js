import { describe, it, expect, vi } from "vitest";

// The DuckDB module exports a singleton. Importing it only constructs the
// manager (no connection is opened until init() is called, which we never do
// here), so this test never touches a real database. We exercise the
// statement-timeout wrapper (_withTimeout) directly with fake promises.
import duckdb from "../../src/server/utils/DuckDB.js";

describe("DuckDB _withTimeout statement-timeout wrapper", () => {
  it("resolves with the query result when the query beats the timeout", async () => {
    const fast = Promise.resolve("rows");
    const result = await duckdb._withTimeout(fast, 1000);
    expect(result).toBe("rows");
  });

  it("rejects with a timeout error when the query is too slow", async () => {
    // A promise that never settles simulates an unbounded full-table scan.
    const neverSettles = new Promise(() => {});
    await expect(duckdb._withTimeout(neverSettles, 20)).rejects.toThrow(
      /exceeded 20ms timeout/
    );
  });

  it("does NOT interrupt the shared connection on timeout", async () => {
    // interrupt() is connection-wide on the single shared connection, so calling
    // it on timeout could cancel a different concurrent request. The wrapper must
    // reject the caller WITHOUT interrupting; the abandoned scan finishes on its
    // own. Guard against a regression that reintroduces the interrupt() call.
    const interrupt = vi.fn();
    const originalConn = duckdb.conn;
    duckdb.conn = { interrupt };
    try {
      const neverSettles = new Promise(() => {});
      await expect(duckdb._withTimeout(neverSettles, 10)).rejects.toThrow(
        /timeout/
      );
      expect(interrupt).not.toHaveBeenCalled();
    } finally {
      duckdb.conn = originalConn;
    }
  });

  it("clears the timer when the query completes in time", async () => {
    const interrupt = vi.fn();
    const originalConn = duckdb.conn;
    duckdb.conn = { interrupt };
    try {
      const result = await duckdb._withTimeout(Promise.resolve(42), 1000);
      expect(result).toBe(42);
      // Give any stray timer a tick; it must have been cleared, not fired.
      await new Promise((r) => setTimeout(r, 20));
      expect(interrupt).not.toHaveBeenCalled();
    } finally {
      duckdb.conn = originalConn;
    }
  });
});
