import { describe, it, expect } from "vitest";

// The truncated-caption visibility logic that lives inline in
// ResultTable.vue's `truncatedCaption` computed. /api/cypher sets a
// response-level `truncated: true` when the server cut the result to the
// KUZU_QUERY_SIZE_LIMIT row cap (see processSingleResult in
// src/server/Cypher.js). That flag rides directly on the queryResult object
// ResultTable receives as a prop (Cypher.js's processSingleResult body IS
// what ShellCell hands down as a single queryResult, or one entry of
// data.results for a multi-statement batch), so the caption is a pure
// function of queryResult.truncated + queryResult.rows.length.
//
// This is deliberately the response-level flag, NOT the per-result
// `truncated` NeighborsFetcher/ConnectedEntitiesPanel use for
// neighbour-expansion caps - those are a different signal on a different
// object and must never be read here.
//
// ResultTable.vue is a Vue SFC that vitest does not compile (see
// ResultGraph.edgeIntegrity.test.js for the same repo-wide pattern), so this
// locks the computed's SEMANTICS with a reference implementation that
// mirrors the inline code exactly. If truncatedCaption changes, this
// reference must change with it.
function truncatedCaption(queryResult) {
  if (!queryResult || !queryResult.truncated) {
    return "";
  }
  const shownRows = queryResult.rows.length;
  return `Truncated to ${shownRows} rows by the server limit`;
}

describe("ResultTable truncated caption", () => {
  it("is empty when the response was not truncated", () => {
    expect(truncatedCaption({ truncated: false, rows: [{}, {}] })).toBe("");
  });

  it("is empty when the truncated flag is entirely absent", () => {
    expect(truncatedCaption({ rows: [{}, {}] })).toBe("");
  });

  it("is empty when queryResult is null", () => {
    expect(truncatedCaption(null)).toBe("");
  });

  it("shows the exact copy with the shipped row count when truncated is true", () => {
    const rows = Array.from({ length: 10000 }, () => ({}));
    expect(truncatedCaption({ truncated: true, rows })).toBe(
      "Truncated to 10000 rows by the server limit"
    );
  });

  it("uses rows.length, not a hardcoded or page-scoped count", () => {
    const rows = Array.from({ length: 42 }, () => ({}));
    expect(truncatedCaption({ truncated: true, rows })).toBe(
      "Truncated to 42 rows by the server limit"
    );
  });
});
