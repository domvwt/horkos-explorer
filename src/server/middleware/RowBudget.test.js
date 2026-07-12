import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";

// RowBudget is CommonJS; load it the same way the server does. It reads its
// budget/window from env at module-load, so tests that need a specific budget
// re-require it after setting env via loadModule() with vi.resetModules().
const require = createRequire(import.meta.url);
const { MODES } = require("./../utils/Constants");

// Load a FRESH copy of RowBudget with the given env overrides applied at load
// time (the module snapshots QUERY_ROW_BUDGET / QUERY_ROW_BUDGET_WINDOW_MS /
// NODE_ENV into module-level constants). vi.resetModules() drops the require
// cache so each call re-evaluates the module top-level.
function loadModule(env = {}) {
  const saved = {};
  const keys = [
    "QUERY_ROW_BUDGET",
    "QUERY_ROW_BUDGET_WINDOW_MS",
    "NODE_ENV",
  ];
  for (const k of keys) {
    saved[k] = process.env[k];
    if (k in env) {
      if (env[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = env[k];
      }
    }
  }
  let mod;
  // createRequire uses Node's native require cache, which vi.resetModules()
  // does NOT clear. Delete the cached module (and the logger it pulls in is
  // side-effect-free to reload) so the top-level env snapshot re-evaluates.
  delete require.cache[require.resolve("./RowBudget")];
  try {
    mod = require("./RowBudget");
  } finally {
    // Restore env so we don't leak into other test files.
    for (const k of keys) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  }
  return mod;
}

describe("RowBudget — env parsing (fail-closed)", () => {
  it("uses the production default (100000) when unset", () => {
    // Force non-dev NODE_ENV so the prod default applies.
    const mod = loadModule({ QUERY_ROW_BUDGET: undefined, NODE_ENV: "test" });
    expect(mod.rowBudget).toBe(100000);
  });

  it("uses the relaxed dev default (10000000) under NODE_ENV=development", () => {
    const mod = loadModule({
      QUERY_ROW_BUDGET: undefined,
      NODE_ENV: "development",
    });
    expect(mod.rowBudget).toBe(10000000);
  });

  it("honours a valid positive QUERY_ROW_BUDGET override", () => {
    const mod = loadModule({ QUERY_ROW_BUDGET: "500", NODE_ENV: "test" });
    expect(mod.rowBudget).toBe(500);
  });

  it("fails closed to the default on a non-numeric budget (never disabled)", () => {
    const mod = loadModule({ QUERY_ROW_BUDGET: "banana", NODE_ENV: "test" });
    expect(mod.rowBudget).toBe(100000);
  });

  it("fails closed to the default on a zero budget (never disabled)", () => {
    const mod = loadModule({ QUERY_ROW_BUDGET: "0", NODE_ENV: "test" });
    expect(mod.rowBudget).toBe(100000);
  });

  it("fails closed to the default on a negative budget (never disabled)", () => {
    const mod = loadModule({ QUERY_ROW_BUDGET: "-1", NODE_ENV: "test" });
    expect(mod.rowBudget).toBe(100000);
  });

  it("defaults the window to 24h and honours a valid override", () => {
    const dflt = loadModule({
      QUERY_ROW_BUDGET_WINDOW_MS: undefined,
      NODE_ENV: "test",
    });
    expect(dflt.windowMs).toBe(24 * 60 * 60 * 1000);

    const override = loadModule({
      QUERY_ROW_BUDGET_WINDOW_MS: "60000",
      NODE_ENV: "test",
    });
    expect(override.windowMs).toBe(60000);
  });

  it("fails closed to the default window on an invalid value", () => {
    const mod = loadModule({
      QUERY_ROW_BUDGET_WINDOW_MS: "nope",
      NODE_ENV: "test",
    });
    expect(mod.windowMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe("RowBudget — accumulation and window reset", () => {
  let mod;

  beforeEach(() => {
    // Small budget, short window for deterministic boundary tests.
    mod = loadModule({
      QUERY_ROW_BUDGET: "100",
      QUERY_ROW_BUDGET_WINDOW_MS: "60000",
      NODE_ENV: "test",
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates rows across multiple debits", () => {
    const key = "1.2.3.4";
    mod.debit(key, 30);
    mod.debit(key, 30);
    expect(mod.check(key).allowed).toBe(true); // 60 < 100
    mod.debit(key, 30); // 90
    expect(mod.check(key).allowed).toBe(true);
  });

  it("admits at exactly 1 remaining, then blocks once the budget is reached (429 boundary)", () => {
    const key = "5.6.7.8";
    mod.debit(key, 99); // used=99, 1 remaining
    // used (99) < budget (100) -> still allowed.
    expect(mod.check(key).allowed).toBe(true);
    mod.debit(key, 1); // used=100, budget reached
    const res = mod.check(key);
    expect(res.allowed).toBe(false);
    expect(res.retryAfterMs).toBeGreaterThan(0);
  });

  it("blocks when a single debit overshoots the budget", () => {
    const key = "9.9.9.9";
    mod.debit(key, 150); // over budget in one shot (admit-then-debit overshoot)
    expect(mod.check(key).allowed).toBe(false);
  });

  it("resets the budget after the window elapses (lazy fixed window)", () => {
    const key = "10.0.0.1";
    mod.debit(key, 100); // exhausted
    expect(mod.check(key).allowed).toBe(false);
    // Advance past the 60s window.
    vi.advanceTimersByTime(60000);
    expect(mod.check(key).allowed).toBe(true);
    // A fresh debit starts a new window from 0.
    mod.debit(key, 50);
    expect(mod.check(key).allowed).toBe(true);
  });

  it("keeps distinct keys on independent budgets", () => {
    mod.debit("a", 100); // exhaust a
    expect(mod.check("a").allowed).toBe(false);
    expect(mod.check("b").allowed).toBe(true); // b untouched
  });

  it("ignores non-positive / non-finite debits (errored queries debit nothing)", () => {
    const key = "1.1.1.1";
    mod.debit(key, 0);
    mod.debit(key, -5);
    mod.debit(key, NaN);
    expect(mod._store.has(key)).toBe(false);
    expect(mod.check(key).allowed).toBe(true);
  });
});

describe("RowBudget — multi-statement summing (matches Cypher.js debit path)", () => {
  it("debiting the summed rows of a batch reaches the budget", () => {
    const mod = loadModule({
      QUERY_ROW_BUDGET: "100",
      QUERY_ROW_BUDGET_WINDOW_MS: "60000",
      NODE_ENV: "test",
    });
    const key = "2.2.2.2";
    // Mirror Cypher.js: SUM of rows.length across results[].
    const results = [{ rows: new Array(40) }, { rows: new Array(60) }];
    const shipped = results.reduce((s, r) => s + r.rows.length, 0);
    expect(shipped).toBe(100);
    mod.debit(key, shipped);
    expect(mod.check(key).allowed).toBe(false); // 100 reaches budget
  });
});

describe("RowBudget — eviction cap bounds memory", () => {
  it("never exceeds MAX_ENTRIES and evicts the oldest-windowStart entry on overflow", () => {
    const mod = loadModule({
      QUERY_ROW_BUDGET: "100",
      QUERY_ROW_BUDGET_WINDOW_MS: "600000",
      NODE_ENV: "test",
    });
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const cap = mod.MAX_ENTRIES;
      expect(cap).toBe(100000);
      // Fill exactly to the cap; the first key gets the oldest windowStart.
      for (let i = 0; i < cap; i++) {
        vi.setSystemTime(i); // strictly increasing windowStart per key
        mod.debit(`k${i}`, 1);
      }
      expect(mod._store.size).toBe(cap);
      expect(mod._store.has("k0")).toBe(true);
      // One more distinct key overflows the cap -> evict oldest (k0).
      vi.setSystemTime(cap + 1);
      mod.debit("overflow", 1);
      expect(mod._store.size).toBe(cap);
      expect(mod._store.has("k0")).toBe(false); // oldest evicted
      expect(mod._store.has("overflow")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RowBudget — sweep hygiene", () => {
  it("_sweepExpired deletes only entries whose window has fully elapsed", () => {
    const mod = loadModule({
      QUERY_ROW_BUDGET: "100",
      QUERY_ROW_BUDGET_WINDOW_MS: "60000",
      NODE_ENV: "test",
    });
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      mod.debit("old", 10); // windowStart=0
      vi.setSystemTime(30000);
      mod.debit("fresh", 10); // windowStart=30000
      // Move to 61s: 'old' (start 0) is expired; 'fresh' (start 30000) is not.
      vi.setSystemTime(61000);
      mod._sweepExpired();
      expect(mod._store.has("old")).toBe(false);
      expect(mod._store.has("fresh")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RowBudget — mode gating (fail closed unless READ_WRITE)", () => {
  const mod = loadModule({ NODE_ENV: "test" });

  it("EXEMPTS READ_WRITE (budget not enforced)", () => {
    expect(mod.isEnforced(MODES.READ_WRITE)).toBe(false);
  });

  it("ENFORCES READ_ONLY", () => {
    expect(mod.isEnforced(MODES.READ_ONLY)).toBe(true);
  });

  it("ENFORCES the removed DEMO mode value (fail closed)", () => {
    expect(mod.isEnforced("DEMO")).toBe(true);
  });

  it("ENFORCES the removed WASM mode value (fail closed)", () => {
    expect(mod.isEnforced("WASM")).toBe(true);
  });

  it("ENFORCES an unrecognised / garbage mode (fail closed)", () => {
    expect(mod.isEnforced("NOT_A_REAL_MODE")).toBe(true);
    expect(mod.isEnforced(undefined)).toBe(true);
  });
});

describe("RowBudget — key derivation reuses ipKeyGenerator", () => {
  const mod = loadModule({ NODE_ENV: "test" });

  it("returns an IPv4 address unchanged", () => {
    expect(mod.keyForRequest({ ip: "203.0.113.7" })).toBe("203.0.113.7");
  });

  it("masks an IPv6 address to its /56 prefix (cannot rotate inside prefix)", () => {
    // ipKeyGenerator applies the default /56 subnet mask, so two addresses in
    // the same /56 collapse to one key.
    const a = mod.keyForRequest({ ip: "2001:db8:1234:5600::1" });
    const b = mod.keyForRequest({ ip: "2001:db8:1234:5600::abcd" });
    expect(a).toBe(b);
  });
});
