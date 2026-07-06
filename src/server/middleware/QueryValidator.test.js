import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// QueryValidator is CommonJS; load it the same way the server does.
const require = createRequire(import.meta.url);
const QueryValidator = require("./QueryValidator");
const { MODES } = require("./../utils/Constants");

const READ_ONLY = MODES.READ_ONLY;

// The DoS bypass payload shape: a backtick identifier containing a lone
// apostrophe, followed by deeply nested parens. Before the fix the apostrophe
// flipped the string-state scanners into fake "in-string" mode, so every `(`
// after it was treated as inside a string and NOT counted toward the depth
// guard — letting the pathological nesting reach the ANTLR parser.
function backtickNestingPayload(depth) {
  return (
    "MATCH (n) WHERE n.`'` = " +
    "(".repeat(depth) +
    ")".repeat(depth) +
    " RETURN n"
  );
}

describe("assertNestingWithinBounds — backtick-identifier DoS bypass (AC#1, AC#2)", () => {
  it("counts parens hidden behind a backtick-apostrophe prefix and BLOCKS the deep-nesting payload", () => {
    // N=160 is well over MAX_NESTING_DEPTH (100); the guard must reject it.
    const payload = backtickNestingPayload(160);
    expect(() => QueryValidator.assertNestingWithinBounds(payload)).toThrow(
      /too deeply nested/i
    );
  });

  it("rejects the payload FAST — the guard, not the parser, catches it", () => {
    // A wall-clock assertion is inherently loose in CI, but the guard is a
    // cheap O(n) scan that must finish in single-digit ms, whereas the ANTLR
    // parse of this payload took ~2.6s pre-fix. A generous ceiling proves the
    // expensive parse never ran.
    const payload = backtickNestingPayload(160);
    const start = Date.now();
    expect(() => QueryValidator.assertNestingWithinBounds(payload)).toThrow();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("still counts ordinary (non-backtick-hidden) deep nesting", () => {
    const plain = "MATCH (n) WHERE n.x = " + "(".repeat(160) + ")".repeat(160);
    expect(() => QueryValidator.assertNestingWithinBounds(plain)).toThrow(
      /too deeply nested/i
    );
  });

  it("does NOT count parens that are genuinely inside a backtick identifier", () => {
    // A backtick identifier legitimately containing many '(' chars is a single
    // identifier, not nesting; it must not trip the guard.
    const stmt = "MATCH (n) WHERE n.`" + "(".repeat(200) + "` = 1 RETURN n";
    expect(() =>
      QueryValidator.assertNestingWithinBounds(stmt)
    ).not.toThrow();
  });

  it("does NOT count parens inside a real single-quoted string (no regression)", () => {
    const stmt = "MATCH (n) WHERE n.x = '" + "(".repeat(200) + "' RETURN n";
    expect(() =>
      QueryValidator.assertNestingWithinBounds(stmt)
    ).not.toThrow();
  });

  it("a backtick inside a real quoted string is literal, not an identifier opener", () => {
    // The string closes at the second quote; the '(' x200 after it are real
    // nesting and MUST be counted. The stray backtick inside the string must
    // not leave the scanner in backtick mode.
    const stmt =
      "MATCH (n) WHERE n.x = 'a`b' AND n.y = " +
      "(".repeat(160) +
      ")".repeat(160);
    expect(() => QueryValidator.assertNestingWithinBounds(stmt)).toThrow(
      /too deeply nested/i
    );
  });
});

describe("legitimate backtick identifiers with a literal quote (AC#3b)", () => {
  it("accepts a query using a backtick identifier that contains a literal apostrophe", () => {
    // Kuzu allows odd characters inside backtick identifiers; a `'` inside one
    // is a literal identifier char and must not break validation.
    const query = "MATCH (n:Person) WHERE n.`o'brien` = 1 RETURN n";
    expect(() => QueryValidator.validateQuery(query, READ_ONLY)).not.toThrow();
    expect(QueryValidator.validateQuery(query, READ_ONLY)).toBe(true);
  });

  it("accepts a backtick identifier used as a return alias", () => {
    const query = "MATCH (n) RETURN n.name AS `full name`";
    expect(() => QueryValidator.validateQuery(query, READ_ONLY)).not.toThrow();
  });
});

describe("backtick cannot smuggle a hidden statement or comment (AC#3c)", () => {
  it("does not treat a `;` inside a backtick identifier as a statement separator", () => {
    // If the ';' were mis-read as a separator, splitStatements would produce
    // two statements and the second ('LOAD FROM ...') would... actually the
    // point is the OPPOSITE: a real ';' must still split. Here the ';' is
    // INSIDE a backtick and must NOT split — it is part of one identifier.
    const query = "MATCH (n) WHERE n.`a;b` = 1 RETURN n";
    const statements = QueryValidator.splitStatements(query);
    expect(statements).toHaveLength(1);
  });

  it("a REAL trailing statement after a backtick identifier is still split and validated", () => {
    // Backtick-awareness must not swallow a genuine second statement: the
    // backtick closes, then the real ';' separates a forbidden LOAD FROM which
    // must be rejected by the whole-query validator.
    const query =
      "MATCH (n) WHERE n.`weird'name` = 1 RETURN n; LOAD FROM 'x' RETURN *";
    const statements = QueryValidator.splitStatements(query);
    expect(statements).toHaveLength(2);
    expect(() => QueryValidator.validateQuery(query, READ_ONLY)).toThrow();
  });

  it("does not treat `//` inside a backtick identifier as a comment", () => {
    // If stripComments mis-read the '//' as a line comment it would delete the
    // rest of the line, including the closing backtick and RETURN, corrupting
    // the query. It must survive intact as one statement.
    const query = "MATCH (n) WHERE n.`a//b` = 1 RETURN n";
    const stripped = QueryValidator.stripComments(query);
    expect(stripped).toContain("`a//b`");
    expect(stripped).toContain("RETURN n");
  });

  it("a backtick identifier cannot hide a forbidden LOAD FROM behind a fake comment", () => {
    // Real comments outside backticks are still stripped so they cannot hide a
    // separator; this is the counterpart proving stripComments still works.
    const query = "MATCH (n) RETURN n // ; LOAD FROM 'x'";
    // The comment (and everything after //) is stripped; single benign stmt.
    const statements = QueryValidator.splitStatements(query);
    expect(statements).toHaveLength(1);
    expect(() => QueryValidator.validateQuery(query, READ_ONLY)).not.toThrow();
  });
});

describe("full validateQuery — backtick DoS payload is rejected (AC#2)", () => {
  it("rejects the backtick-apostrophe deep-nesting payload via the top-level entry point", () => {
    const payload = backtickNestingPayload(160);
    expect(() => QueryValidator.validateQuery(payload, READ_ONLY)).toThrow(
      /too deeply nested/i
    );
  });

  it("is a no-op (allows anything) under READ_WRITE mode", () => {
    const payload = backtickNestingPayload(160);
    expect(QueryValidator.validateQuery(payload, MODES.READ_WRITE)).toBe(true);
  });
});

describe("allowlist fails CLOSED on mode — enforce unless READ_WRITE (TASK-168)", () => {
  // A LOAD FROM is a live local-file read (SSRF-ish) that Kuzu's read-only DB
  // open does NOT block; the allowlist is the ONLY control. It must be rejected
  // for every mode that is not the explicit local-dev READ_WRITE.
  const LOAD_FROM_QUERY = "LOAD FROM 'somefile.csv' RETURN *";

  it("REJECTS LOAD FROM under READ_ONLY mode", () => {
    expect(() =>
      QueryValidator.validateQuery(LOAD_FROM_QUERY, MODES.READ_ONLY)
    ).toThrow();
  });

  it("REJECTS LOAD FROM under DEMO mode (fail closed)", () => {
    expect(() =>
      QueryValidator.validateQuery(LOAD_FROM_QUERY, MODES.DEMO)
    ).toThrow();
  });

  it("REJECTS LOAD FROM under WASM mode (fail closed)", () => {
    expect(() =>
      QueryValidator.validateQuery(LOAD_FROM_QUERY, MODES.WASM)
    ).toThrow();
  });

  it("REJECTS LOAD FROM under an unrecognised/garbage mode (fail closed)", () => {
    expect(() =>
      QueryValidator.validateQuery(LOAD_FROM_QUERY, "NOT_A_REAL_MODE")
    ).toThrow();
  });

  it("ALLOWS LOAD FROM under READ_WRITE mode (validation short-circuits to true)", () => {
    expect(QueryValidator.validateQuery(LOAD_FROM_QUERY, MODES.READ_WRITE)).toBe(
      true
    );
  });

  it("still ALLOWS a benign read query under READ_ONLY (allowlist not broken)", () => {
    expect(QueryValidator.validateQuery("MATCH (n) RETURN n", READ_ONLY)).toBe(
      true
    );
  });
});

describe("no latency regression for legitimate shallow-but-large queries (AC#4)", () => {
  it("validates a ~50KB shallow query near the length cap quickly", () => {
    // Build a long but shallow query: a big OR chain, well under the nesting
    // bound. Must both pass and finish fast (the guard is O(n)).
    const clauses = [];
    let len = 0;
    let k = 0;
    while (len < 45000) {
      const clause = `n.p${k} = ${k}`;
      clauses.push(clause);
      len += clause.length + 4;
      k++;
    }
    const query = "MATCH (n) WHERE " + clauses.join(" OR ") + " RETURN n";
    expect(query.length).toBeGreaterThan(40000);
    expect(query.length).toBeLessThan(50000);

    const start = Date.now();
    const ok = QueryValidator.validateQuery(query, READ_ONLY);
    const elapsed = Date.now() - start;
    expect(ok).toBe(true);
    // Generous ceiling; the guard scan is O(n) and the parse of a flat OR chain
    // is fast. This is a sanity bound, not a micro-benchmark.
    expect(elapsed).toBeLessThan(5000);
  });
});
