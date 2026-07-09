import { describe, it, expect } from "vitest";
import {
  buildEdgeRows,
  collapseByEntity,
} from "./ConnectedEntities";

// --- buildEdgeRows fixtures -------------------------------------------------
// Raw neighbour-fetch rows shaped { r, dst }, as returned by fetchNeighbors.
// The clicked node is A {table:0, offset:1}; B {table:0, offset:2} is the
// neighbour, so dst is always B and direction is read from r._src.

const nodeB = { _id: { table: 0, offset: 2 }, _label: "Company", name: "Beta Ltd" };

function ownershipEdge({ srcIsNeighbor = false, offset = 1, sources } = {}) {
  return {
    r: {
      _id: { table: 5, offset },
      _label: "CorporateOwnership",
      _src: srcIsNeighbor ? { table: 0, offset: 2 } : { table: 0, offset: 1 },
      _dst: srcIsNeighbor ? { table: 0, offset: 1 } : { table: 0, offset: 2 },
      ...(sources ? { sources } : {}),
    },
    dst: nodeB,
  };
}

const helpers = {
  getDisplayName: (node) => node.name || "Unknown",
  isInGraph: () => false,
};

describe("buildEdgeRows", () => {
  it("keeps BOTH directions of a mutual same-type relationship (circular ownership)", () => {
    // A owns B AND B owns A over the same rel table: direction is part of the
    // row identity, so neither direction is dropped and both role labels
    // survive to the collapsed entity row.
    const rows = buildEdgeRows(
      [ownershipEdge({ srcIsNeighbor: false }), ownershipEdge({ srcIsNeighbor: true, offset: 2 })],
      helpers
    );
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.relationshipLabel)).toEqual(["Owner", "Owned by"]);

    const collapsed = collapseByEntity(rows);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].relationshipLabels).toEqual(["Owner", "Owned by"]);
  });

  it("collapses parallel edges of the same type and direction silently", () => {
    const rows = buildEdgeRows(
      [ownershipEdge({ offset: 1 }), ownershipEdge({ offset: 2 })],
      helpers
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].relationshipLabel).toBe("Owner");
  });

  it("emits one row per relationship type for the same neighbour", () => {
    const influenceEdge = {
      r: {
        _id: { table: 7, offset: 1 },
        _label: "CorporateInfluence",
        _src: { table: 0, offset: 1 },
        _dst: { table: 0, offset: 2 },
      },
      dst: nodeB,
    };
    const rows = buildEdgeRows([ownershipEdge(), influenceEdge], helpers);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.edgeLabel)).toEqual(["CorporateOwnership", "CorporateInfluence"]);
  });

  it("derives ownership share from the rel's sources struct", () => {
    const rows = buildEdgeRows(
      [ownershipEdge({ sources: [{ percentage: "25-to-50-percent" }] })],
      helpers
    );
    expect(rows[0].ownershipShare).toBe("25–50%");
  });

  it("applies the injected display-name and in-graph helpers", () => {
    const rows = buildEdgeRows([ownershipEdge()], {
      getDisplayName: () => "Custom Name",
      isInGraph: (nodeId) => nodeId === "0_2",
    });
    expect(rows[0].displayName).toBe("Custom Name");
    expect(rows[0].inGraph).toBe(true);
  });

  it("ignores malformed rows and tolerates a non-array input", () => {
    expect(buildEdgeRows(null, helpers)).toEqual([]);
    const rows = buildEdgeRows(
      [null, {}, { r: ownershipEdge().r }, { dst: nodeB }, ownershipEdge()],
      helpers
    );
    expect(rows).toHaveLength(1);
  });
});

// --- collapseByEntity fixtures ----------------------------------------------
// A per-edge row as produced by buildEdgeRows: one record per
// (neighbour node, relationship type, direction).
function edgeRow(overrides = {}) {
  return {
    id: "1_10",
    displayName: "Acme Ltd",
    label: "Company",
    inGraph: false,
    rawNode: { _id: { table: 1, offset: 10 }, _label: "Company" },
    rawRel: { _id: { table: 5, offset: 1 } },
    relationshipLabel: "Owner",
    ownershipShare: null,
    edgeLabel: "CorporateOwnership",
    ...overrides,
  };
}

describe("collapseByEntity", () => {
  it("returns one row per distinct entity when reached by multiple relationships", () => {
    const rows = [
      edgeRow({ relationshipLabel: "Owner", edgeLabel: "CorporateOwnership" }),
      edgeRow({ relationshipLabel: "Controls", edgeLabel: "CorporateInfluence", rawRel: { _id: { table: 6, offset: 2 } } }),
    ];
    const collapsed = collapseByEntity(rows);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe("1_10");
  });

  it("surfaces every distinct relationship label on the single row, first-seen order", () => {
    const rows = [
      edgeRow({ relationshipLabel: "Owner" }),
      edgeRow({ relationshipLabel: "Controls", rawRel: { _id: { table: 6, offset: 2 } } }),
    ];
    const [entity] = collapseByEntity(rows);
    expect(entity.relationshipLabels).toEqual(["Owner", "Controls"]);
  });

  it("collapses rows sharing a relationship label silently", () => {
    const rows = [
      edgeRow({ relationshipLabel: "Owner" }),
      edgeRow({ relationshipLabel: "Owner", rawRel: { _id: { table: 5, offset: 99 } } }),
    ];
    const [entity] = collapseByEntity(rows);
    expect(entity.relationshipLabels).toEqual(["Owner"]);
  });

  it("keeps distinct entities separate", () => {
    const rows = [
      edgeRow({ id: "1_10", displayName: "Acme Ltd" }),
      edgeRow({ id: "1_11", displayName: "Beta Ltd", rawNode: { _id: { table: 1, offset: 11 }, _label: "Company" } }),
    ];
    const collapsed = collapseByEntity(rows);
    expect(collapsed.map(e => e.id).sort()).toEqual(["1_10", "1_11"]);
  });

  it("gathers distinct ownership shares across the entity's edges", () => {
    const rows = [
      edgeRow({ relationshipLabel: "Owner", ownershipShare: "25–50%" }),
      edgeRow({ relationshipLabel: "Controls", ownershipShare: "75–100%", rawRel: { _id: { table: 6, offset: 2 } } }),
      edgeRow({ relationshipLabel: "Owner", ownershipShare: "25–50%", rawRel: { _id: { table: 5, offset: 3 } } }),
    ];
    const [entity] = collapseByEntity(rows);
    expect(entity.ownershipShares).toEqual(["25–50%", "75–100%"]);
  });

  it("keeps the first raw node/rel for the add path", () => {
    const relA = { _id: { table: 5, offset: 1 } };
    const relB = { _id: { table: 6, offset: 2 } };
    const rows = [
      edgeRow({ rawRel: relA }),
      edgeRow({ relationshipLabel: "Controls", rawRel: relB }),
    ];
    const [entity] = collapseByEntity(rows);
    expect(entity.rawRel).toBe(relA);
    expect(entity.rawNode._id).toEqual({ table: 1, offset: 10 });
  });

  it("takes identity fields (inGraph, displayName) from the first row seen", () => {
    const rows = [
      edgeRow({ inGraph: true, displayName: "Canonical" }),
      edgeRow({ inGraph: false, displayName: "Ignored", relationshipLabel: "Controls" }),
    ];
    const [entity] = collapseByEntity(rows);
    expect(entity.inGraph).toBe(true);
    expect(entity.displayName).toBe("Canonical");
  });

  it("ignores rows without an id and tolerates a non-array input", () => {
    expect(collapseByEntity(null)).toEqual([]);
    const rows = [edgeRow({ id: undefined }), edgeRow({ id: null }), edgeRow({ id: "1_10" })];
    expect(collapseByEntity(rows)).toHaveLength(1);
  });
});
