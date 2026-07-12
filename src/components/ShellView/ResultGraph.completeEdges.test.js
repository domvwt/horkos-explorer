import { describe, it, expect, vi } from "vitest";

// NeighborsFetcher pulls in the Axios wrapper at load time; it is
// browser-only. Stub it so the pure query engine can run under node without a
// DOM or network. The tests spy on _runQuery directly, so the stub is never
// actually called.
vi.mock("@/utils/AxiosWrapper", () => ({ default: { post: vi.fn() } }));

import NeighborsFetcher from "../../utils/NeighborsFetcher";
import { encodeId } from "../../utils/GraphResultExtractor";

// A small Horkos-shaped rel-table set (mirrors NeighborsFetcher.test.js).
const relTables = [
  { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
  { name: "CorporateOwnership", connectivity: [{ src: "Company", dst: "Company" }] },
  { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
  { name: "ResidentialAddress", connectivity: [{ src: "Person", dst: "Address" }] },
];

// Pure reference for the grouping that ResultGraph.completeEdgesAmongCurrentNodes
// performs on the LIVE canvas node set: group EVERY node now on the canvas by
// (table, pk column) into the { table, primaryKeyName, primaryKeyValues } shape
// that fetchRelsAmongNodes consumes. The point of the complete-edge pass is that
// this set is the WHOLE canvas — not just the focus node's fresh neighbours — so
// the edge engine can see a pre-existing, non-focus node as a candidate endpoint.
// Kept here (like NeighborsFetcher.test.js's countNewNeighborNodes reference) so
// the grouping semantics are locked by a DB-free test.
function groupCanvasNodesForRelFetch(canvasNodes) {
  const byTable = {};
  canvasNodes.forEach((node) => {
    const props = node.data && node.data.properties;
    const label = props && props._label;
    if (!label) return;
    const pkValue = props.id; // every node table in this schema keys on `id`
    if (pkValue === undefined || pkValue === null) return;
    if (!byTable[label]) {
      byTable[label] = { table: label, primaryKeyName: "id", primaryKeyValues: [] };
    }
    byTable[label].primaryKeyValues.push(pkValue);
  });
  return Object.values(byTable);
}

// A minimal canvas node in the shape ResultGraph reads (node.data.properties).
function canvasNode(label, id) {
  return { id: `${label}_${id}`, data: { properties: { _label: label, id } } };
}

describe("complete-edge convergence (ResultGraph.completeEdgesAmongCurrentNodes)", () => {
  it("groups the WHOLE canvas — including pre-existing non-focus nodes — for the edge pass", () => {
    // Canvas: a focus Person, a pre-existing Company that is NOT the focus's
    // fresh neighbour, and a Person leaf just added by an expansion.
    const canvas = [
      canvasNode("Person", "focus"),
      canvasNode("Company", "preexisting"),
      canvasNode("Person", "leaf"),
    ];
    const others = groupCanvasNodesForRelFetch(canvas);

    const person = others.find((o) => o.table === "Person");
    const company = others.find((o) => o.table === "Company");
    // Both Persons are grouped together, and the pre-existing Company — which a
    // focus->neighbour fetch would never include — is present. This is what lets
    // the edge engine consider an edge between the new leaf and that node.
    expect(person.primaryKeyValues.sort()).toEqual(["focus", "leaf"]);
    expect(company.primaryKeyValues).toEqual(["preexisting"]);
  });

  it("draws an edge between a newly-added node and a pre-existing non-focus node (the core bug)", async () => {
    // The scenario the old focus->neighbour expand paths missed: after adding a
    // leaf, an edge exists between that leaf and a Company already on the canvas
    // that was NOT the expansion focus. The among-nodes engine must surface it.
    const leafToPreexistingRel = {
      _id: { table: 9, offset: 42 },
      _label: "Directorship",
      _src: { table: 0, offset: 1 }, // Person leaf
      _dst: { table: 1, offset: 7 }, // pre-existing Company
    };

    const canvas = [
      canvasNode("Person", "focus"),
      canvasNode("Company", "preexisting"),
      canvasNode("Person", "leaf"),
    ];
    const others = groupCanvasNodesForRelFetch(canvas);

    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      // Person-Company pairing (Directorship) returns the leaf<->pre-existing edge.
      .mockImplementation((query) => {
        if (query.includes("`Directorship`")) {
          return Promise.resolve({ rows: [{ r: leafToPreexistingRel }], dataTypes: { r: "REL" } });
        }
        return Promise.resolve({ rows: [], dataTypes: { r: "REL" } });
      });

    const merged = await NeighborsFetcher.fetchRelsAmongNodes({
      nodes: others,
      relTables,
    });

    // The edge between the newly-added Person leaf and the pre-existing Company
    // is returned by the among-nodes pass — so completeEdgesAmongCurrentNodes
    // would render it, instead of it staying undrawn until a later expansion.
    expect(merged).not.toBeNull();
    expect(merged.rows.map((row) => encodeId(row.r._id))).toContain("9_42");
    runSpy.mockRestore();
  });

  it("keeps the among-nodes pass bounded — one request per rel-type x table pairing, not per node", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: { r: "REL" } });

    const canvasOf = (n) => [
      ...Array.from({ length: n }, (_, i) => canvasNode("Person", `p${i}`)),
      ...Array.from({ length: n }, (_, i) => canvasNode("Company", `c${i}`)),
    ];

    await NeighborsFetcher.fetchRelsAmongNodes({ nodes: groupCanvasNodesForRelFetch(canvasOf(3)), relTables });
    const small = runSpy.mock.calls.length;
    runSpy.mockClear();
    await NeighborsFetcher.fetchRelsAmongNodes({ nodes: groupCanvasNodesForRelFetch(canvasOf(200)), relTables });
    const large = runSpy.mock.calls.length;

    // Same tables + connectivity: growing the canvas must not grow the request
    // count, so completing edges on every expansion stays cheap.
    expect(large).toBe(small);
    runSpy.mockRestore();
  });
});
