import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encodeId,
  formatNodeLabel,
  buildG6Node,
  buildG6Edge,
  extractGraphFromQueryResult,
} from "./GraphResultExtractor";
import { DATA_TYPES } from "./Constants";

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

  it("shows a hub node's representative name, not the cluster id", () => {
    const rawHub = {
      _id: { table: 3, offset: 0 },
      _label: "VirtualHub",
      id: "hub_cluster_42",
      name: "John Smith",
    };
    const store = makeSettingsStore({ VirtualHub: hubSettings });
    expect(formatNodeLabel(rawHub, schema, store)).toBe("John Smith");
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
  });

  const emptyShape = {
    counters: { node: {}, rel: {}, total: { node: 0, rel: 0 } },
    nodes: [],
    edges: [],
    nodesMap: {},
    edgesMap: {},
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
