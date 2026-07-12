import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The DuckDB module exports a singleton. Importing it only constructs the
// manager; no connection is opened until init() runs (which we never call).
// We hand-build the pool/instance state so the REAL checkout / release /
// query / replace logic is exercised against fake connections, never a DB.
import duckdb from "../../src/server/utils/DuckDB.js";

// A fake pooled connection that records interrupt/close and every SQL string
// it receives, and lets each test decide what runAndReadAll resolves to.
function fakeConn(id, runImpl) {
  const conn = {
    id,
    interrupted: false,
    closed: false,
    calls: [],
    interrupt() {
      this.interrupted = true;
    },
    closeSync() {
      this.closed = true;
    },
    async runAndReadAll(sql, params) {
      conn.calls.push(sql);
      if (runImpl) {
        return runImpl(sql, params);
      }
      return { getRowObjects: () => [] };
    },
  };
  return conn;
}

// Build a pool of N idle slots and a fake instance whose connect() yields a
// fresh fake conn (used by _replaceSlot). Resets all admission state.
function setupPool(n = 2, connectImpl) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    pool.push({ conn: fakeConn(`c${i}`), busy: false });
  }
  duckdb.pool = pool;
  duckdb.waiters = [];
  duckdb.enabled = true;
  duckdb.ready = null;
  let replacementCounter = 0;
  duckdb.instance = {
    connect:
      connectImpl ||
      (async () => fakeConn(`replacement-${replacementCounter++}`)),
  };
  return pool;
}

describe("DuckDB pool checkout / release", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("checks out at most one query per connection (no two share a slot)", async () => {
    setupPool(2);
    const a = await duckdb._checkout();
    const b = await duckdb._checkout();
    expect(a).not.toBe(b);
    expect(a.busy).toBe(true);
    expect(b.busy).toBe(true);
    // Both slots busy; a third checkout must not resolve immediately.
    let thirdResolved = false;
    const third = duckdb._checkout().then((s) => {
      thirdResolved = true;
      return s;
    });
    await Promise.resolve();
    expect(thirdResolved).toBe(false);
    // Releasing hands the freed slot to the queued waiter.
    duckdb._release(a);
    const handed = await third;
    expect(handed).toBe(a);
    expect(handed.busy).toBe(true);
  });

  it("release marks a slot free when no waiter is queued", () => {
    const pool = setupPool(1);
    pool[0].busy = true;
    duckdb._release(pool[0]);
    expect(pool[0].busy).toBe(false);
  });
});

describe("DuckDB admission gate (load shedding)", () => {
  it("sheds with a 503 LoadShedError once pool + queue depth are exhausted", async () => {
    // Pool of 1 + MAX_QUEUE_DEPTH (10) waiters = 11 outstanding before shed.
    setupPool(1);
    // Fill the single slot.
    await duckdb._checkout();
    // Queue exactly MAX_QUEUE_DEPTH waiters (they stay pending).
    for (let i = 0; i < 10; i++) {
      duckdb._checkout().catch(() => {});
    }
    expect(duckdb.waiters.length).toBe(10);
    // The next checkout exceeds the bound and must shed synchronously.
    let thrown;
    try {
      await duckdb._checkout();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.name).toBe("LoadShedError");
    expect(thrown.status).toBe(503);
    expect(thrown).toBeInstanceOf(duckdb.LoadShedError);
    // Waiter count unchanged: a shed does not enqueue.
    expect(duckdb.waiters.length).toBe(10);
  });
});

describe("DuckDB query() timeout replaces the connection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("interrupts + replaces a timed-out connection and returns a fresh slot", async () => {
    const pool = setupPool(1);
    const originalConn = pool[0].conn;

    // Force the timeout path: _withTimeout rejects with the tagged error the
    // real timer would produce, without waiting for the real 30s timeout.
    const timeoutErr = new Error("DuckDB query exceeded timeout");
    timeoutErr.__duckdbTimeout = true;
    vi.spyOn(duckdb, "_withTimeout").mockRejectedValue(timeoutErr);

    await expect(duckdb.query("SELECT 1")).rejects.toThrow(/timeout/);

    // The runaway connection was interrupted and closed...
    expect(originalConn.interrupted).toBe(true);
    expect(originalConn.closed).toBe(true);
    // ...and the slot now holds a FRESH replacement connection...
    expect(pool[0].conn).not.toBe(originalConn);
    expect(pool[0].conn.id).toContain("replacement");
    // ...which had fts loaded during replacement: extension loading is
    // per-connection, so a replacement without LOAD fts would silently break
    // ranked queries served by this slot.
    expect(
      pool[0].conn.calls.some((sql) => sql.includes("LOAD fts"))
    ).toBe(true);
    // ...and the slot is free again (returned to the pool), not stuck busy.
    expect(pool[0].busy).toBe(false);
    // No leaked waiters.
    expect(duckdb.waiters.length).toBe(0);
  });

  it("releases the slot without replacing it on a normal (non-timeout) query", async () => {
    const pool = setupPool(1);
    const conn = pool[0].conn;
    conn.runAndReadAll = async () => ({ getRowObjects: () => [{ n: 1 }] });

    const rows = await duckdb.query("SELECT 1");
    expect(rows).toEqual([{ n: 1 }]);
    // Same connection retained; slot free; nothing interrupted/closed.
    expect(pool[0].conn).toBe(conn);
    expect(conn.interrupted).toBe(false);
    expect(conn.closed).toBe(false);
    expect(pool[0].busy).toBe(false);
  });

  it("disables the manager if a timed-out connection cannot be replaced and the pool empties", async () => {
    const pool = setupPool(1, async () => {
      throw new Error("connect failed");
    });
    void pool;

    const timeoutErr = new Error("DuckDB query exceeded timeout");
    timeoutErr.__duckdbTimeout = true;
    vi.spyOn(duckdb, "_withTimeout").mockRejectedValue(timeoutErr);

    await expect(duckdb.query("SELECT 1")).rejects.toThrow(/timeout/);
    // Replacement failed -> slot dropped -> pool empty -> disabled.
    expect(duckdb.pool.length).toBe(0);
    expect(duckdb.enabled).toBe(false);
  });

  it("drains ALL queued waiters when replacement fails and the pool empties (none hang)", async () => {
    setupPool(1, async () => {
      throw new Error("connect failed");
    });

    // Park query() awaiting a controllable _withTimeout so waiters can queue
    // behind the busy slot before the timeout fires.
    let rejectTimeout;
    vi.spyOn(duckdb, "_withTimeout").mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectTimeout = reject;
        })
    );

    const queryPromise = duckdb.query("SELECT 1");
    // Flush the event loop so query() has checked out the slot and is parked.
    await new Promise((r) => setTimeout(r, 0));
    expect(duckdb.pool[0].busy).toBe(true);

    // Three requests queue behind the single busy slot.
    const waiters = [duckdb._checkout(), duckdb._checkout(), duckdb._checkout()];
    expect(duckdb.waiters.length).toBe(3);

    // Observe settlement BEFORE firing the timeout (attaches handlers early);
    // the race timer converts a never-settling waiter into a "hung" verdict
    // instead of stalling the test.
    const observed = waiters.map((p) =>
      Promise.race([
        p.then(
          () => "resolved",
          () => "rejected"
        ),
        new Promise((r) => setTimeout(() => r("hung"), 200)),
      ])
    );

    // Fire the timeout; the replacement will fail and empty the pool.
    const timeoutErr = new Error("DuckDB query exceeded timeout");
    timeoutErr.__duckdbTimeout = true;
    rejectTimeout(timeoutErr);
    await expect(queryPromise).rejects.toThrow(/timeout/);

    // EVERY waiter must have been rejected — none left hanging on a pool that
    // can never release a slot again.
    const outcomes = await Promise.all(observed);
    expect(outcomes).toEqual(["rejected", "rejected", "rejected"]);
    expect(duckdb.waiters.length).toBe(0);
    expect(duckdb.pool.length).toBe(0);
    expect(duckdb.enabled).toBe(false);
  });
});
