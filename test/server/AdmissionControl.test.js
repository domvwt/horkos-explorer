import { describe, it, expect, beforeAll, vi } from "vitest";

// Database.js ends with `module.exports = new Database()`, and the constructor
// opens a real Kuzu database. BUT the constructor early-returns immediately when
// KUZU_WASM === "true" (case-insensitive), BEFORE opening any DB and BEFORE
// initialising the counter/pool fields. So we import it with KUZU_WASM=true to
// get a BARE singleton, then hand-build the state the admission-control methods
// read and exercise the REAL prototype methods (getConnection/releaseConnection)
// against it. This tests the actual self-DoS invariant with no DB.

let db;

beforeAll(async () => {
  vi.stubEnv("KUZU_WASM", "true");
  vi.stubEnv("MODE", "READ_ONLY");
  const mod = await import("../../src/server/utils/Database.js");
  db = mod.default;
});

// Reset the hand-built state before each assertion group. maxInFlightQueries is
// deliberately small (2) so we can drive the shed path with two acquisitions.
function fakePool() {
  return [
    { connection: { id: "c0" }, useCount: 0 },
    { connection: { id: "c1" }, useCount: 0 },
    { connection: { id: "c2" }, useCount: 0 },
  ];
}

function setupState() {
  db.inFlightQueries = 0;
  db.maxInFlightQueries = 2;
  db.connectionPool = fakePool();
}

describe("Database admission control (real getConnection/releaseConnection)", () => {
  it("a controlled getConnection increments inFlightQueries by exactly 1 and release decrements back to 0", () => {
    setupState();
    expect(db.inFlightQueries).toBe(0);

    const conn = db.getConnection();
    expect(db.inFlightQueries).toBe(1);
    // The returned value is a real pooled connection object.
    expect(conn).toBeTruthy();

    const released = db.releaseConnection(conn);
    expect(released).toBe(true);
    expect(db.inFlightQueries).toBe(0);
  });

  it("sheds with a LoadShedError (status 503) once the in-flight cap is reached, WITHOUT incrementing the counter on the shed path", () => {
    setupState();
    // Fill the cap: two admitted acquisitions => inFlightQueries === 2 === max.
    db.getConnection();
    db.getConnection();
    expect(db.inFlightQueries).toBe(2);

    // The next controlled acquisition must be shed and MUST NOT increment the
    // counter — that leak is the exact permanent self-DoS this guards against.
    let thrown;
    try {
      db.getConnection();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.name).toBe("LoadShedError");
    expect(thrown.status).toBe(503);
    // CRITICAL invariant: counter unchanged after the throw.
    expect(db.inFlightQueries).toBe(2);

    // It is a real LoadShedError as exported by the module.
    expect(thrown).toBeInstanceOf(db.LoadShedError);
  });

  it("getConnection({admissionControlled:false}) bypasses the gate and does NOT increment the counter", () => {
    setupState();
    expect(db.inFlightQueries).toBe(0);

    const conn = db.getConnection({ admissionControlled: false });
    expect(conn).toBeTruthy();
    // Internal callers (schema/version lookups) borrow a connection without
    // counting against the admission cap.
    expect(db.inFlightQueries).toBe(0);

    // ...and its matching non-controlled release does NOT decrement either.
    const released = db.releaseConnection(conn, { admissionControlled: false });
    expect(released).toBe(true);
    expect(db.inFlightQueries).toBe(0);
  });

  it("an internal (uncontrolled) acquisition does not decrement a controlled request's slot even at the cap", () => {
    setupState();
    // One controlled request outstanding.
    const controlled = db.getConnection();
    expect(db.inFlightQueries).toBe(1);

    // An internal lookup borrows a connection with admissionControlled:false. It
    // must neither shed (even if it would exceed the cap) nor touch the counter.
    db.maxInFlightQueries = 1; // controlled slot already fills the cap
    const internal = db.getConnection({ admissionControlled: false });
    expect(internal).toBeTruthy();
    expect(db.inFlightQueries).toBe(1);

    db.releaseConnection(internal, { admissionControlled: false });
    expect(db.inFlightQueries).toBe(1);

    db.releaseConnection(controlled);
    expect(db.inFlightQueries).toBe(0);
  });

  it("releaseConnection never drives inFlightQueries below 0", () => {
    setupState();
    expect(db.inFlightQueries).toBe(0);

    // Release a real pooled connection while the counter is already 0. The
    // counter must clamp at 0, never go negative (a negative counter would
    // silently raise the effective cap and defeat load-shedding).
    const someConn = db.connectionPool[0].connection;
    const released = db.releaseConnection(someConn);
    expect(released).toBe(true);
    expect(db.inFlightQueries).toBe(0);
  });
});
