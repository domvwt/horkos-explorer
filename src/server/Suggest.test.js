import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// The server code under test is CommonJS; load it the same way the server does.
const require = createRequire(import.meta.url);
const { toSuggestion, ENTITY_TYPES } = require("./Suggest");

// Regression coverage for the "/api/suggest" JSON-serialization boundary.
//
// @duckdb/node-api returns numeric columns as non-plain-number JS values:
//   - BIGINT           -> a JS bigint
//   - DECIMAL          -> a DuckDBDecimalValue wrapper object backed by a bigint
// JSON.stringify rejects both ("Do not know how to serialize a BigInt"), so a
// single such value anywhere in a suggestion crashes the whole /api/suggest
// response. This bit the LIKE/fast path specifically: it selects `0.0 AS score`,
// which arrives as a DuckDBDecimalValue. toSuggestion() must coerce every
// numeric wire-type it emits (score + the numeric disambiguators) to a plain
// number so the response always serializes.

// Minimal stand-in for @duckdb/node-api's DECIMAL wrapper: a non-plain object,
// backed by a bigint, whose constructor name is what our detector keys on and
// whose valueOf/toString give the numeric value Number() reads.
class DuckDBDecimalValue {
  constructor(unscaled, scale) {
    this._value = unscaled; // bigint, as the real binding stores it
    this._scale = scale;
  }
  toString() {
    return (Number(this._value) / 10 ** this._scale).toString();
  }
  valueOf() {
    return Number(this._value) / 10 ** this._scale;
  }
}

function serializes(obj) {
  // Returns true only if the object round-trips through JSON without throwing.
  try {
    JSON.stringify(obj);
    return true;
  } catch {
    return false;
  }
}

describe("toSuggestion serialization", () => {
  it("coerces a DECIMAL-wrapper score (LIKE path) to a plain number", () => {
    // Mirrors the LIKE path: `0.0 AS score` -> DuckDBDecimalValue.
    const row = {
      name: "Zoe Smith",
      cluster_id: "psc:123:abc",
      canonical_name: "Zoe Smith",
      birth_date: "1986-03",
      nationality: "British",
      record_count: 1n, // BIGINT arrives as bigint
      score: new DuckDBDecimalValue(0n, 1),
    };
    const s = toSuggestion(row, ENTITY_TYPES.Person);
    expect(typeof s.score).toBe("number");
    expect(s.score).toBe(0);
    expect(typeof s.disambiguators.record_count).toBe("number");
    expect(s.disambiguators.record_count).toBe(1);
    expect(serializes(s)).toBe(true);
    expect(JSON.parse(JSON.stringify(s)).score).toBe(0);
  });

  it("passes a plain-number score (ranked path) through unchanged", () => {
    // Mirrors the ranked path: match_bm25 -> DOUBLE -> plain number.
    const row = {
      name: "John Smith",
      cluster_id: "psc:999:zzz",
      canonical_name: "John Smith",
      birth_date: "1970-01",
      nationality: "British",
      record_count: 3n,
      score: 4.5425,
    };
    const s = toSuggestion(row, ENTITY_TYPES.Person);
    expect(s.score).toBe(4.5425);
    expect(serializes(s)).toBe(true);
  });

  it("leaves string disambiguators as strings (never NaN)", () => {
    // Company disambiguators are all VARCHAR; coercion must not touch them.
    const row = {
      name: "SMIIT LTD",
      cluster_id: "companies-house:081:b6b",
      canonical_name: "SMIIT LTD",
      company_number: "08126788",
      status: "Active",
      score: new DuckDBDecimalValue(0n, 1),
    };
    const s = toSuggestion(row, ENTITY_TYPES.Company);
    expect(s.disambiguators.company_number).toBe("08126788");
    expect(s.disambiguators.status).toBe("Active");
    expect(serializes(s)).toBe(true);
  });

  it("serializes a full result array for every entity type", () => {
    for (const type of Object.keys(ENTITY_TYPES)) {
      const config = ENTITY_TYPES[type];
      const row = {
        name: "x",
        cluster_id: "id:1",
        canonical_name: "x",
        score: new DuckDBDecimalValue(0n, 1),
      };
      // Populate whatever disambiguators this type declares with plausible
      // wire-typed values: a bigint for record_count, strings otherwise.
      for (const col of config.disambiguators) {
        row[col] = col === "record_count" ? 2n : "val";
      }
      const suggestions = [toSuggestion(row, config)];
      expect(serializes(suggestions)).toBe(true);
    }
  });

  it("passes null/undefined score through without coercing to a number", () => {
    const row = {
      name: "x",
      cluster_id: "id:1",
      canonical_name: "x",
      birth_date: "1970-01",
      nationality: "British",
      record_count: 1n,
      score: null,
    };
    const s = toSuggestion(row, ENTITY_TYPES.Person);
    expect(s.score).toBeNull();
    expect(serializes(s)).toBe(true);
  });
});
