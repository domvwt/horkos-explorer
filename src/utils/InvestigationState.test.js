import { describe, it, expect } from "vitest";
import LZString from "lz-string";
import { generateExportCode, parseExportCode } from "./InvestigationState";

// A minimal graph in the shape serializeState reads: node/edge properties live
// under node.data.properties, positions under node.style.
function graphNode(label, id, x, y) {
  return {
    id: `${label}_${id}`,
    data: { properties: { _label: label, id } },
    style: { x, y },
  };
}

function graphEdge(label, id) {
  return { id: `${label}_${id}`, data: { properties: { _label: label, id } } };
}

const sampleState = {
  queries: [{ query: "MATCH (n) RETURN n" }],
  graphData: {
    nodes: [graphNode("Person", "p1", 10, 20), graphNode("Company", "c1", 30, 40)],
    edges: [graphEdge("Directorship", "d1")],
  },
};

describe("InvestigationState round-trip", () => {
  it("preserves query, nodes and edges through export/import", () => {
    const { code } = generateExportCode(sampleState);
    const parsed = parseExportCode(code);

    expect(parsed).not.toBeNull();
    expect(parsed.queries).toEqual([{ query: "MATCH (n) RETURN n" }]);
    expect(parsed.minimalNodes).toEqual([
      { label: "Person", pk: "p1", x: 10, y: 20 },
      { label: "Company", pk: "c1", x: 30, y: 40 },
    ]);
    expect(parsed.minimalEdges).toEqual([{ label: "Directorship", pk: "d1" }]);
  });

  it("does not emit a hidden-elements field in the serialized payload", () => {
    const { code } = generateExportCode(sampleState);
    // Unwrap the HKS1:<payload>:Z envelope and inflate to inspect the raw object.
    const payload = code.slice(5, -2);
    const raw = JSON.parse(LZString.decompressFromBase64(payload));

    expect(raw).not.toHaveProperty("h");
    expect(Object.keys(raw).sort()).toEqual(["e", "n", "q", "v"]);
  });

  it("still decodes legacy codes that carry an 'h' field (ignored)", () => {
    // Craft a v1 payload with a legacy hidden-elements field. The decoder must
    // tolerate it (the field is simply dropped) so old share codes keep working.
    const legacy = {
      v: 1,
      q: "MATCH (n) RETURN n",
      n: [["Person", "p1", 10, 20]],
      e: [],
      h: { nodes: { "Person|p1": true }, edges: {} },
    };
    const code = `HKS1:${LZString.compressToBase64(JSON.stringify(legacy))}:Z`;

    const parsed = parseExportCode(code);
    expect(parsed).not.toBeNull();
    expect(parsed.minimalNodes).toEqual([{ label: "Person", pk: "p1", x: 10, y: 20 }]);
    expect(parsed).not.toHaveProperty("hiddenElements");
  });
});
