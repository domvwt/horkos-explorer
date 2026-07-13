import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encodeId,
  formatNodeLabel,
  buildG6Node,
  buildG6Edge,
  extractGraphFromQueryResult,
} from "./GraphResultExtractor";
import { DATA_TYPES, POSSIBLE_MATCH_STYLE, ARC_CURVE_OFFSETS } from "./Constants";

// The extractor degrades (warn + skip) instead of crashing when the schema or
// per-label settings haven't loaded yet; these tests pin that contract.

const makeSettingsStore = (settingsByLabel = {}) => ({
  settingsForLabel: (label) => settingsByLabel[label] ?? null,
});

const personSettings = {
  label: "name",
  g6Settings: { size: 30, style: { fill: "#e15759", lineWidth: 1 } },
};

const ownershipSettings = {
  g6Settings: { size: 2, style: { stroke: "#999999" } },
};

// Hub nodes carry a build-time `name` from the pipeline; their configured label
// property resolves to "name" the same way real entity types' do.
const hubSettings = {
  label: "name",
  g6Settings: { size: 30, style: { fill: "#bbbbbb", lineWidth: 1 } },
};

const schema = {
  nodeTables: [
    { name: "Person", properties: [{ name: "name", type: "STRING" }] },
    { name: "Company", properties: [{ name: "name", type: "STRING" }] },
    { name: "VirtualHub", properties: [{ name: "name", type: "STRING" }] },
  ],
  relTables: [{ name: "PersonOwnership", properties: [] }],
};

const performanceSettings = {
  maxNumberOfNodes: 1000,
  maxNumberOfNodesWithLabels: 1000,
};

const rawPerson = { _id: { table: 0, offset: 0 }, _label: "Person", name: "Alice" };
const rawCompany = { _id: { table: 1, offset: 0 }, _label: "Company", name: "Acme Ltd" };
const rawOwnership = {
  _id: { table: 2, offset: 0 },
  _label: "PersonOwnership",
  _src: rawPerson._id,
  _dst: rawCompany._id,
};

let warnSpy;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("formatNodeLabel", () => {
  it("returns the formatted label property when settings exist", () => {
    const store = makeSettingsStore({ Person: personSettings });
    expect(formatNodeLabel(rawPerson, schema, store)).toBe("Alice");
  });

  it("returns an empty string when the label has no settings entry", () => {
    expect(formatNodeLabel(rawPerson, schema, makeSettingsStore())).toBe("");
  });

  it("shows a hub node's representative name with the ≈ prefix, not the cluster id", () => {
    const rawHub = {
      _id: { table: 3, offset: 0 },
      _label: "VirtualHub",
      id: "hub_cluster_42",
      name: "John Smith",
    };
    const store = makeSettingsStore({ VirtualHub: hubSettings });
    expect(formatNodeLabel(rawHub, schema, store)).toBe("≈ John Smith");
  });

  it("falls back to the type display name for a hub with no name (legacy graph)", () => {
    const rawHub = {
      _id: { table: 3, offset: 0 },
      _label: "VirtualHub",
      id: "hub_cluster_42",
      name: null,
    };
    const store = makeSettingsStore({ VirtualHub: hubSettings });
    expect(formatNodeLabel(rawHub, schema, store)).toBe("Possible Matches");
  });

  it("falls back for an empty-string hub name instead of rendering a dangling ≈", () => {
    const rawHub = {
      _id: { table: 3, offset: 0 },
      _label: "VirtualHub",
      id: "hub_cluster_42",
      name: "",
    };
    const store = makeSettingsStore({ VirtualHub: hubSettings });
    expect(formatNodeLabel(rawHub, schema, store)).toBe("Possible Matches");
  });
});

describe("buildG6Node", () => {
  it("builds a node with visual settings applied", () => {
    const store = makeSettingsStore({ Person: personSettings });
    const node = buildG6Node(encodeId(rawPerson._id), rawPerson, store);
    expect(node).not.toBeNull();
    expect(node.id).toBe("0_0");
    expect(node.style.fill).toBe("#e15759");
    expect(node.style.labelText).toBe("Alice");
  });

  it("returns null and warns when the label has no visual settings", () => {
    const node = buildG6Node("0_0", rawPerson, makeSettingsStore());
    expect(node).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "buildG6Node: no visual settings for label:",
      "Person",
    );
  });

  it("renders a VirtualHub with its standard solid settings styling (no special node treatment)", () => {
    const rawHub = {
      _id: { table: 3, offset: 0 },
      _label: "VirtualHub",
      id: "hub_cluster_42",
      name: "John Smith",
    };
    const store = makeSettingsStore({ VirtualHub: hubSettings });
    const node = buildG6Node(encodeId(rawHub._id), rawHub, store);
    // Deliberate: hubs are ordinary nodes on canvas; the possible-match layer
    // is carried by the dashed edges and the ≈ label prefix only.
    expect(node.style.fill).toBe(hubSettings.g6Settings.style.fill);
    expect(node.style.lineDash).toBeUndefined();
    expect(node.style.iconText).toBeDefined();
  });
});

describe("buildG6Edge", () => {
  it("builds an edge with visual settings applied", () => {
    const store = makeSettingsStore({ PersonOwnership: ownershipSettings });
    const edge = buildG6Edge("2_0", "0_0", "1_0", rawOwnership, store, schema);
    expect(edge).not.toBeNull();
    expect(edge.source).toBe("0_0");
    expect(edge.target).toBe("1_0");
    expect(edge.style.stroke).toBe("#999999");
  });

  it("returns null and warns when the label has no visual settings", () => {
    const edge = buildG6Edge("2_0", "0_0", "1_0", rawOwnership, makeSettingsStore(), schema);
    expect(edge).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "buildG6Edge: no visual settings for label:",
      "PersonOwnership",
    );
  });

  it.each([
    "PersonAmbiguousLink",
    "CompanyAmbiguousLink",
    "AddressAmbiguousLink",
  ])("renders %s dashed, thin, and arrowless", (relType) => {
    const rawAmbiguous = {
      _id: { table: 4, offset: 0 },
      _label: relType,
      _src: rawPerson._id,
      _dst: rawCompany._id,
    };
    // size: 3 (the production rel default) so the lineWidth assertion can
    // only pass via the possible-match override, not the settings passthrough.
    const store = makeSettingsStore({
      [relType]: { g6Settings: { size: 3, style: { stroke: "#999999" } } },
    });
    const edge = buildG6Edge("4_0", "0_0", "1_0", rawAmbiguous, store, schema);
    expect(edge.style.lineDash).toEqual([4, 4]);
    // A copy, not the shared constant: mutating one edge's dash in place must
    // not restyle every other dashed edge for the rest of the session.
    expect(edge.style.lineDash).not.toBe(POSSIBLE_MATCH_STYLE.EDGE_LINE_DASH);
    expect(edge.style.lineWidth).toBe(2);
    // Explicit false per-edge so the graph-level `endArrow: true` default
    // (graphConfig.js) cannot re-add an arrowhead to a symmetric relation.
    expect(edge.style.endArrow).toBe(false);
  });

  it("leaves confirmed relationship edges untouched by the possible-match treatment", () => {
    const store = makeSettingsStore({ PersonOwnership: ownershipSettings });
    const edge = buildG6Edge("2_0", "0_0", "1_0", rawOwnership, store, schema);
    expect(edge.style.lineDash).toBeUndefined();
    expect(edge.style.endArrow).toBeUndefined();
  });
});

describe("extractGraphFromQueryResult", () => {
  const queryResult = {
    rows: [{ p: rawPerson, r: rawOwnership, c: rawCompany }],
    dataTypes: { p: DATA_TYPES.NODE, r: DATA_TYPES.REL, c: DATA_TYPES.NODE },
  };
  const fullStore = makeSettingsStore({
    Person: personSettings,
    Company: personSettings,
    PersonOwnership: ownershipSettings,
  });

  it("extracts nodes and edges when schema and settings are loaded", () => {
    const result = extractGraphFromQueryResult(queryResult, schema, fullStore, performanceSettings);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.counters).toEqual({
      node: { Person: 1, Company: 1 },
      rel: { PersonOwnership: 1 },
      total: { node: 2, rel: 1 },
    });
    expect(result.sampled).toBe(false);
    expect(result.sampledNodeCount).toBe(2);
    expect(result.totalNodeCount).toBe(2);
  });

  const emptyShape = {
    counters: { node: {}, rel: {}, total: { node: 0, rel: 0 } },
    nodes: [],
    edges: [],
    nodesMap: {},
    edgesMap: {},
    sampled: false,
    sampledNodeCount: 0,
    totalNodeCount: 0,
  };

  it("returns an empty result and warns when the schema is null", () => {
    const result = extractGraphFromQueryResult(queryResult, null, fullStore, undefined);
    expect(result).toEqual(emptyShape);
    expect(warnSpy).toHaveBeenCalledWith(
      "extractGraphFromQueryResult: schema not loaded, skipping graph extraction",
    );
  });

  it("returns an empty result when the schema is missing its tables", () => {
    expect(extractGraphFromQueryResult(queryResult, {}, fullStore, undefined)).toEqual(emptyShape);
  });

  it("does not treat a legitimately empty schema as missing", () => {
    const emptySchema = { nodeTables: [], relTables: [] };
    const result = extractGraphFromQueryResult(
      { rows: [], dataTypes: {} },
      emptySchema,
      fullStore,
      performanceSettings,
    );
    expect(result.counters.total).toEqual({ node: 0, rel: 0 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("skips elements without settings instead of crashing", () => {
    const partialStore = makeSettingsStore({
      Person: personSettings,
      Company: personSettings,
    });
    const result = extractGraphFromQueryResult(queryResult, schema, partialStore, performanceSettings);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);
    expect(result.counters.total).toEqual({ node: 2, rel: 0 });
  });
});

describe("extractGraphFromQueryResult parallel-edge overlap offsetting", () => {
  // Two people so every rel below sits between the SAME node pair (0_0, 1_0).
  const personA = { _id: { table: 0, offset: 0 }, _label: "Person", name: "A" };
  const personB = { _id: { table: 0, offset: 1 }, _label: "Person", name: "B" };

  const overlapStore = makeSettingsStore({
    Person: personSettings,
    PersonOwnership: ownershipSettings,
  });

  // The overlap counter (per node pair) is not exposed directly; its effect
  // surfaces on the built edge: the 1st edge between a pair is a plain `line`
  // (overlapIndex 1), and each subsequent DISTINCT edge becomes a `quadratic`
  // with curveOffset = ARC_CURVE_OFFSETS[overlapIndex - 1]. So the offset index
  // is fully observable via edge.type + edge.style.curveOffset.
  const makeRel = (offset, src, dst) => ({
    _id: { table: 2, offset },
    _label: "PersonOwnership",
    _src: src,
    _dst: dst,
  });

  it("fans two DISTINCT parallel edges apart at offsets 1 and 2 (no regression)", () => {
    // Two different _id edges between the same pair — both must increment.
    const rel0 = makeRel(0, personA._id, personB._id);
    const rel1 = makeRel(1, personA._id, personB._id);
    const queryResult = {
      rows: [
        { a: personA, r: rel0, b: personB },
        { a: personA, r: rel1, b: personB },
      ],
      dataTypes: { a: DATA_TYPES.NODE, r: DATA_TYPES.REL, b: DATA_TYPES.NODE },
    };

    const result = extractGraphFromQueryResult(queryResult, schema, overlapStore, performanceSettings);

    expect(result.edges).toHaveLength(2);
    const edge0 = result.edgesMap[encodeId(rel0._id)];
    const edge1 = result.edgesMap[encodeId(rel1._id)];

    // overlapIndex 1 -> plain line, no curve.
    expect(edge0.type).toBe("line");
    expect(edge0.style.curveOffset).toBeUndefined();
    // overlapIndex 2 -> quadratic with the 2nd curve offset.
    expect(edge1.type).toBe("quadratic");
    expect(edge1.style.curveOffset).toBe(ARC_CURVE_OFFSETS[1]);
  });

  it("does not let a duplicate edge _id inflate the overlap offset (self-pair regression)", () => {
    // rel0 arrives TWICE, in both orientations — this simulates an undirected
    // self-pair match (`-[r]-` with the same pk list on both ends) where Kuzu
    // returns each edge once per orientation. rel1 is a genuinely distinct
    // parallel edge between the same pair. The duplicate must NOT bump the
    // counter, so the distinct edges land on offsets 1 and 2, never 1 and 3.
    const rel0 = makeRel(0, personA._id, personB._id);
    const rel0Reversed = makeRel(0, personB._id, personA._id); // same _id, flipped
    const rel1 = makeRel(1, personA._id, personB._id);
    const queryResult = {
      rows: [
        { a: personA, r: rel0, b: personB },
        { a: personB, r: rel0Reversed, b: personA }, // duplicate _id, discarded
        { a: personA, r: rel1, b: personB },
      ],
      dataTypes: { a: DATA_TYPES.NODE, r: DATA_TYPES.REL, b: DATA_TYPES.NODE },
    };

    const result = extractGraphFromQueryResult(queryResult, schema, overlapStore, performanceSettings);

    // Only one g6 edge per distinct _id survives dedup.
    expect(result.edges).toHaveLength(2);
    expect(result.counters.rel).toEqual({ PersonOwnership: 2 });

    const edge0 = result.edgesMap[encodeId(rel0._id)];
    const edge1 = result.edgesMap[encodeId(rel1._id)];

    // First distinct edge stays at overlapIndex 1 (plain line).
    expect(edge0.type).toBe("line");
    expect(edge0.style.curveOffset).toBeUndefined();
    // Second distinct edge is at overlapIndex 2, NOT 3: the discarded duplicate
    // did not advance the counter. Offset index 2 -> ARC_CURVE_OFFSETS[1] (60);
    // the bug would have produced ARC_CURVE_OFFSETS[2] (-60).
    expect(edge1.type).toBe("quadratic");
    expect(edge1.style.curveOffset).toBe(ARC_CURVE_OFFSETS[1]);
    expect(edge1.style.curveOffset).not.toBe(ARC_CURVE_OFFSETS[2]);
  });
});

describe("extractGraphFromQueryResult node sampling", () => {
  // Build a query result with `count` distinct Person nodes and PersonOwnership
  // edges chaining node i to node i+1 (Person -> Company alternation isn't
  // needed here — sampling only cares about node identity and edge endpoints).
  const buildManyNodesResult = (count) => {
    const people = Array.from({ length: count }, (_, i) => ({
      _id: { table: 0, offset: i },
      _label: "Person",
      name: `Person ${i}`,
    }));
    const rows = people.map((p) => ({ p }));
    // Chain consecutive nodes with an edge so some edges are guaranteed to
    // reference a sampled-out node — this is what exercises orphan pruning.
    for (let i = 0; i < count - 1; i++) {
      rows.push({
        p: people[i],
        r: {
          _id: { table: 2, offset: i },
          _label: "PersonOwnership",
          _src: people[i]._id,
          _dst: people[i + 1]._id,
        },
        c: people[i + 1],
      });
    }
    const dataTypes = { p: DATA_TYPES.NODE, r: DATA_TYPES.REL, c: DATA_TYPES.NODE };
    return { rows, dataTypes };
  };

  const bigStore = makeSettingsStore({
    Person: personSettings,
    PersonOwnership: ownershipSettings,
  });

  let randomSpy;
  afterEach(() => {
    if (randomSpy) {
      randomSpy.mockRestore();
      randomSpy = undefined;
    }
  });

  it("does not sample when the node count is at or under the cap", () => {
    const queryResult = buildManyNodesResult(10);
    const result = extractGraphFromQueryResult(queryResult, schema, bigStore, {
      maxNumberOfNodes: 10,
      maxNumberOfNodesWithLabels: 1000,
    });
    expect(result.sampled).toBe(false);
    expect(result.nodes).toHaveLength(10);
    expect(result.sampledNodeCount).toBe(10);
    expect(result.totalNodeCount).toBe(10);
  });

  it("truncates to exactly maxNumberOfNodes and reports honest metadata", () => {
    const queryResult = buildManyNodesResult(50);
    const performance = { maxNumberOfNodes: 12, maxNumberOfNodesWithLabels: 1000 };
    const result = extractGraphFromQueryResult(queryResult, schema, bigStore, performance);

    expect(result.sampled).toBe(true);
    expect(result.nodes).toHaveLength(12);
    expect(result.sampledNodeCount).toBe(12);
    expect(result.totalNodeCount).toBe(50);
    // The cap is respected exactly, not "at most" — deterministic output length.
    expect(Object.keys(result.nodesMap)).toHaveLength(12);
  });

  it("prunes every edge that references a sampled-out node (no dangling endpoints)", () => {
    const queryResult = buildManyNodesResult(50);
    const performance = { maxNumberOfNodes: 12, maxNumberOfNodesWithLabels: 1000 };
    const result = extractGraphFromQueryResult(queryResult, schema, bigStore, performance);

    const keptNodeIds = new Set(result.nodes.map((n) => n.id));
    for (const edge of result.edges) {
      expect(keptNodeIds.has(edge.source)).toBe(true);
      expect(keptNodeIds.has(edge.target)).toBe(true);
    }
  });

  it("samples via a linear Fisher-Yates shuffle, not a random-index splice loop", () => {
    // A splice-based approach calls Math.random() roughly (n - max) times (once
    // per removal); a Fisher-Yates shuffle calls it (n - 1) times (once per
    // shuffle step), regardless of how many nodes end up truncated. Pinning the
    // call count distinguishes the two implementations without depending on
    // which specific nodes survive.
    const total = 50;
    const queryResult = buildManyNodesResult(total);
    const performance = { maxNumberOfNodes: 5, maxNumberOfNodesWithLabels: 1000 };
    randomSpy = vi.spyOn(Math, "random");
    extractGraphFromQueryResult(queryResult, schema, bigStore, performance);
    expect(randomSpy).toHaveBeenCalledTimes(total - 1);
  });

  it("is deterministic in output length across repeated runs with mocked randomness", () => {
    const queryResult = buildManyNodesResult(30);
    const performance = { maxNumberOfNodes: 7, maxNumberOfNodesWithLabels: 1000 };
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const first = extractGraphFromQueryResult(queryResult, schema, bigStore, performance);
    const second = extractGraphFromQueryResult(buildManyNodesResult(30), schema, bigStore, performance);
    expect(first.nodes).toHaveLength(7);
    expect(second.nodes).toHaveLength(7);
    // Math.random mocked to a constant: the shuffle is fully determined, so the
    // same input produces the same sampled node set.
    expect(first.nodes.map((n) => n.id).sort()).toEqual(second.nodes.map((n) => n.id).sort());
  });
});
