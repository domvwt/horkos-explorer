import { describe, it, expect } from "vitest";
import {
  buildEdgeRows,
  collapseByEntity,
  selectEntitiesToExpand,
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

describe("selectEntitiesToExpand", () => {
  function entity(id, name, inGraph = false, label = "Company") {
    return { id, displayName: name, inGraph, label };
  }

  it("selects only entities not already on the canvas", () => {
    const entities = [
      entity("1_1", "Alpha", true),
      entity("1_2", "Bravo", false),
      entity("1_3", "Charlie", false),
    ];
    const { toAdd, totalCandidates, truncated } = selectEntitiesToExpand(entities, 10);
    expect(toAdd.map(e => e.id)).toEqual(["1_2", "1_3"]);
    expect(totalCandidates).toBe(2);
    expect(truncated).toBe(false);
  });

  it("orders within a group by the display comparator: case-insensitive locale-aware name, then id", () => {
    const entities = [
      entity("1_3", "Charlie"),
      entity("1_1", "alpha"),
      entity("1_2", "Bravo"),
    ];
    const { toAdd } = selectEntitiesToExpand(entities, 10);
    expect(toAdd.map(e => e.displayName)).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("respects the GROUP dimension of the display order: earlier group beats earlier name", () => {
    // The visible list groups by raw label ("Address" sorts before "Company")
    // and only then sorts names within each group. A capped selection must
    // take the visible top entity — the Address — over an alphabetically
    // earlier company name further down the panel.
    const entities = [
      entity("1_1", "Aardvark Ltd", false, "Company"),
      entity("1_2", "Zebra Street", false, "Address"),
    ];
    const { toAdd } = selectEntitiesToExpand(entities, 1);
    expect(toAdd.map(e => e.displayName)).toEqual(["Zebra Street"]);
  });

  it("sorts accented names the way the visible list does, not by code units", () => {
    // Code-unit order would put "Zed" before "Émile" (é > z in UTF-16);
    // localeCompare — the visible list's within-group comparator — puts Émile
    // first, so a capped selection takes the first entities the user sees.
    const entities = [entity("1_1", "Zed"), entity("1_2", "Émile")];
    const { toAdd } = selectEntitiesToExpand(entities, 1);
    expect(toAdd.map(e => e.displayName)).toEqual(["Émile"]);
  });

  it("breaks display-name ties by id for a stable order", () => {
    const entities = [
      entity("1_20", "Same"),
      entity("1_3", "Same"),
      entity("1_1", "Same"),
    ];
    const { toAdd } = selectEntitiesToExpand(entities, 10);
    expect(toAdd.map(e => e.id)).toEqual(["1_1", "1_20", "1_3"]);
  });

  it("caps the selection at the bound and flags truncation", () => {
    const entities = Array.from({ length: 5 }, (_, i) => entity(`1_${i}`, `Node ${i}`));
    const { toAdd, totalCandidates, truncated } = selectEntitiesToExpand(entities, 3);
    expect(toAdd).toHaveLength(3);
    expect(totalCandidates).toBe(5);
    expect(truncated).toBe(true);
  });

  it("does not flag truncation when candidates exactly equal the bound", () => {
    const entities = Array.from({ length: 3 }, (_, i) => entity(`1_${i}`, `Node ${i}`));
    const { truncated } = selectEntitiesToExpand(entities, 3);
    expect(truncated).toBe(false);
  });

  it("caps deterministically so the same first-N are chosen regardless of input order", () => {
    const forward = [entity("1_1", "Alpha"), entity("1_2", "Bravo"), entity("1_3", "Charlie")];
    const reversed = forward.slice().reverse();
    const a = selectEntitiesToExpand(forward, 2).toAdd.map(e => e.id);
    const b = selectEntitiesToExpand(reversed, 2).toAdd.map(e => e.id);
    expect(a).toEqual(b);
    expect(a).toEqual(["1_1", "1_2"]);
  });

  it("floors a fractional cap (the settings number input allows one)", () => {
    const entities = Array.from({ length: 5 }, (_, i) => entity(`1_${i}`, `Node ${i}`));
    const { toAdd, truncated } = selectEntitiesToExpand(entities, 3.7);
    expect(toAdd).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it("returns an empty selection for a non-positive or invalid cap", () => {
    const entities = [entity("1_1", "Alpha")];
    expect(selectEntitiesToExpand(entities, 0).toAdd).toEqual([]);
    expect(selectEntitiesToExpand(entities, -5).toAdd).toEqual([]);
    expect(selectEntitiesToExpand(entities, 0.9).toAdd).toEqual([]);
    expect(selectEntitiesToExpand(entities, NaN).toAdd).toEqual([]);
    expect(selectEntitiesToExpand(entities, Infinity).toAdd).toEqual([]);
  });

  it("tolerates a non-array entity input", () => {
    expect(selectEntitiesToExpand(null, 10)).toEqual({
      toAdd: [],
      totalCandidates: 0,
      truncated: false,
    });
  });
});
