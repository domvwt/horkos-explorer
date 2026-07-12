import { describe, it, expect, vi, beforeEach } from "vitest";

// PathFinder pulls in the Axios wrapper at load time; it is browser-only.
// Stub it so the pure query-builder / result-shaping logic can be exercised
// under node without a DOM or network. findShortestPath tests spy on
// _runQuery directly, so the stub stays uncalled there.
vi.mock("@/utils/AxiosWrapper", () => ({ default: { post: vi.fn() } }));

import PathFinder, {
  buildDiscoveryQuery,
  buildHydrationQuery,
  extractDiscoveryResult,
  clampMaxHops,
  MAX_HOPS,
} from "./PathFinder";

describe("clampMaxHops", () => {
  it("passes valid in-range hop counts through", () => {
    expect(clampMaxHops(1)).toBe(1);
    expect(clampMaxHops(6)).toBe(6);
    expect(clampMaxHops(12)).toBe(12);
  });

  it("clamps down to the MAX_HOPS ceiling", () => {
    expect(clampMaxHops(13)).toBe(MAX_HOPS);
    expect(clampMaxHops(100)).toBe(MAX_HOPS);
  });

  it("defaults non-positive / non-integer / missing to MAX_HOPS", () => {
    expect(clampMaxHops(0)).toBe(MAX_HOPS);
    expect(clampMaxHops(-3)).toBe(MAX_HOPS);
    expect(clampMaxHops(2.5)).toBe(MAX_HOPS);
    expect(clampMaxHops(undefined)).toBe(MAX_HOPS);
    expect(clampMaxHops("nope")).toBe(MAX_HOPS);
    expect(clampMaxHops(NaN)).toBe(MAX_HOPS);
  });

  it("MAX_HOPS is 12 (single-stage bound)", () => {
    expect(MAX_HOPS).toBe(12);
  });
});

describe("buildDiscoveryQuery", () => {
  const base = {
    labelA: "Person",
    pkNameA: "id",
    pkValueA: "p1",
    labelB: "Company",
    pkNameB: "id",
    pkValueB: "c1",
    pkName: "id",
  };

  it("builds the inline-projected recursive-rel discovery query at the clamped bound", () => {
    const { query, params, maxHops } = buildDiscoveryQuery(base);
    expect(query).toBe(
      "MATCH (a:`Person`)-[e* SHORTEST 1..12 (r, n | {}, {n.`id`})]-(b:`Company`) " +
        "WHERE a.`id` = $aid AND b.`id` = $bid " +
        "RETURN properties(nodes(e), 'id') AS nodeIds, " +
        "properties(nodes(e), '_label') AS nodeLabels, " +
        "properties(rels(e), '_label') AS relLabels LIMIT 1;"
    );
    // Only the pk VALUES live in params — never interpolated into query text.
    expect(params).toEqual({ aid: "p1", bid: "c1" });
    expect(query).not.toContain("p1");
    expect(query).not.toContain("c1");
    expect(maxHops).toBe(12);
  });

  it("keeps the pk escaped in identifier positions but RAW in the properties() string literal", () => {
    const { query } = buildDiscoveryQuery(base);
    // Identifier positions (inline projection, WHERE clauses) carry backticks.
    expect(query).toContain("{n.`id`}");
    expect(query).toContain("a.`id` = $aid");
    expect(query).toContain("b.`id` = $bid");
    // String-literal position: Kuzu reads properties()'s second argument as a
    // raw property-name string — backtick escaping is NOT stripped there, so
    // an escaped name would look up a property literally named `id`.
    expect(query).toContain("properties(nodes(e), 'id')");
    expect(query).not.toContain("'`id`'");
  });

  it("clamps an over-large requested bound to MAX_HOPS", () => {
    const { query, maxHops } = buildDiscoveryQuery({ ...base, maxHops: 42 });
    expect(query).toContain("SHORTEST 1..12");
    expect(maxHops).toBe(12);
  });

  it("escapes label and endpoint-pk identifiers (backtick injection safe)", () => {
    const { query } = buildDiscoveryQuery({
      ...base,
      labelA: "Odd`Label",
      pkNameA: "we`ird",
    });
    expect(query).toContain("(a:`Odd``Label`)");
    expect(query).toContain("a.`we``ird` = $aid");
  });

  it("rejects a projected pk name that is not identifier-shaped (string-literal guard)", () => {
    // The projected pk lands inside a Cypher string literal where no escaping
    // mechanism applies, so anything beyond a plain identifier must throw
    // (routed to the error banner) rather than be interpolated unguarded.
    expect(() => buildDiscoveryQuery({ ...base, pkName: "we`ird" })).toThrow(
      /Unsupported primary-key column name/
    );
    expect(() => buildDiscoveryQuery({ ...base, pkName: "weird-pk" })).toThrow(
      /Unsupported primary-key column name/
    );
    expect(() => buildDiscoveryQuery({ ...base, pkName: "has'quote" })).toThrow(
      /Unsupported primary-key column name/
    );
    expect(() => buildDiscoveryQuery({ ...base, pkName: "1leading" })).toThrow(
      /Unsupported primary-key column name/
    );
    expect(() => buildDiscoveryQuery({ ...base, pkName: "" })).toThrow(
      /Unsupported primary-key column name/
    );
    // A plain identifier-shaped pk passes.
    expect(() => buildDiscoveryQuery({ ...base, pkName: "node_id2" })).not.toThrow();
  });

  it("unwraps boxed Number/String pk values into plain primitives", () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed = new String("boxed-id");
    const { params } = buildDiscoveryQuery({
      ...base,
      pkValueA: boxed,
      pkValueB: 123,
    });
    expect(typeof params.aid).toBe("string");
    expect(params.aid).toBe("boxed-id");
    expect(params.bid).toBe(123);
  });
});

describe("extractDiscoveryResult", () => {
  it("reports a found path with hop count and intermediate node arrays", () => {
    const response = {
      rows: [
        {
          // Two intermediates between the endpoints -> 3 hops.
          nodeIds: ["m1", "m2"],
          nodeLabels: ["Company", "Address"],
          relLabels: ["Directorship", "RegisteredAddress", "ResidentialAddress"],
        },
      ],
    };
    const result = extractDiscoveryResult(response);
    expect(result.found).toBe(true);
    expect(result.hops).toBe(3);
    expect(result.nodeIds).toEqual(["m1", "m2"]);
    expect(result.nodeLabels).toEqual(["Company", "Address"]);
    expect(result.relLabels).toEqual([
      "Directorship",
      "RegisteredAddress",
      "ResidentialAddress",
    ]);
  });

  it("handles a 1-hop path (adjacent endpoints, no intermediates)", () => {
    const response = {
      rows: [{ nodeIds: [], nodeLabels: [], relLabels: ["PersonOwnership"] }],
    };
    const result = extractDiscoveryResult(response);
    expect(result.found).toBe(true);
    expect(result.hops).toBe(1);
    expect(result.nodeIds).toEqual([]);
  });

  it("reports not-found for a zero-row response (no connection)", () => {
    expect(extractDiscoveryResult({ rows: [] })).toEqual({
      found: false,
      hops: 0,
      nodeIds: [],
      nodeLabels: [],
      relLabels: [],
    });
  });

  it("reports not-found for null/undefined response without throwing", () => {
    const nf = { found: false, hops: 0, nodeIds: [], nodeLabels: [], relLabels: [] };
    expect(extractDiscoveryResult(null)).toEqual(nf);
    expect(extractDiscoveryResult(undefined)).toEqual(nf);
  });

  it("reports not-found for malformed rows (missing / length-mismatched arrays)", () => {
    const nf = { found: false, hops: 0, nodeIds: [], nodeLabels: [], relLabels: [] };
    // No rel labels at all.
    expect(extractDiscoveryResult({ rows: [{ nodeIds: [], nodeLabels: [], relLabels: [] }] })).toEqual(nf);
    // Missing arrays.
    expect(extractDiscoveryResult({ rows: [{}] })).toEqual(nf);
    // nodeIds / nodeLabels lengths disagree.
    expect(
      extractDiscoveryResult({
        rows: [{ nodeIds: ["m1"], nodeLabels: [], relLabels: ["R"] }],
      })
    ).toEqual(nf);
    // Intermediate count must be hops - 1; here 2 hops should give 1 intermediate.
    expect(
      extractDiscoveryResult({
        rows: [{ nodeIds: [], nodeLabels: [], relLabels: ["R1", "R2"] }],
      })
    ).toEqual(nf);
  });
});

describe("buildHydrationQuery", () => {
  const nodeLabelSet = new Set(["Person", "Company", "Address"]);
  const relLabelSet = new Set([
    "Directorship",
    "RegisteredAddress",
    "PersonOwnership",
  ]);

  it("builds a typed, undirected, pk-pinned chain over endpoints + intermediates", () => {
    const { query, params } = buildHydrationQuery({
      a: { label: "Person", pk: "p1" },
      b: { label: "Address", pk: "a1" },
      nodeIds: ["c1"],
      nodeLabels: ["Company"],
      relLabels: ["Directorship", "RegisteredAddress"],
      pkName: "id",
      nodeLabelSet,
      relLabelSet,
    });
    expect(query).toBe(
      "MATCH (n0:`Person`)-[r0:`Directorship`]-(n1:`Company`)" +
        "-[r1:`RegisteredAddress`]-(n2:`Address`) " +
        "WHERE n0.`id` = $pk0 AND n1.`id` = $pk1 AND n2.`id` = $pk2 " +
        "RETURN n0, r0, n1, r1, n2 LIMIT 1;"
    );
    expect(params).toEqual({ pk0: "p1", pk1: "c1", pk2: "a1" });
  });

  it("builds a 1-hop chain (endpoints only, no intermediates)", () => {
    const { query, params } = buildHydrationQuery({
      a: { label: "Person", pk: "p1" },
      b: { label: "Company", pk: "c1" },
      nodeIds: [],
      nodeLabels: [],
      relLabels: ["PersonOwnership"],
      pkName: "id",
      nodeLabelSet,
      relLabelSet,
    });
    expect(query).toBe(
      "MATCH (n0:`Person`)-[r0:`PersonOwnership`]-(n1:`Company`) " +
        "WHERE n0.`id` = $pk0 AND n1.`id` = $pk1 " +
        "RETURN n0, r0, n1 LIMIT 1;"
    );
    expect(params).toEqual({ pk0: "p1", pk1: "c1" });
  });

  it("throws when a discovered node label is not a real node table", () => {
    expect(() =>
      buildHydrationQuery({
        a: { label: "Person", pk: "p1" },
        b: { label: "Ghost", pk: "g1" },
        nodeIds: [],
        nodeLabels: [],
        relLabels: ["PersonOwnership"],
        pkName: "id",
        nodeLabelSet,
        relLabelSet,
      })
    ).toThrow(/Unknown node label/);
  });

  it("throws when a discovered rel label is not a real rel table", () => {
    expect(() =>
      buildHydrationQuery({
        a: { label: "Person", pk: "p1" },
        b: { label: "Company", pk: "c1" },
        nodeIds: [],
        nodeLabels: [],
        relLabels: ["NotAReal Rel"],
        pkName: "id",
        nodeLabelSet,
        relLabelSet,
      })
    ).toThrow(/Unknown rel label/);
  });

  it("unwraps boxed pk values into plain primitives", () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed = new String("boxed");
    const { params } = buildHydrationQuery({
      a: { label: "Person", pk: boxed },
      b: { label: "Company", pk: 7 },
      nodeIds: [],
      nodeLabels: [],
      relLabels: ["PersonOwnership"],
      pkName: "id",
      nodeLabelSet,
      relLabelSet,
    });
    expect(typeof params.pk0).toBe("string");
    expect(params.pk0).toBe("boxed");
    expect(params.pk1).toBe(7);
  });
});

describe("findShortestPath (discovery -> hydration dispatch)", () => {
  const nodeLabelSet = new Set(["Person", "Company"]);
  const relLabelSet = new Set(["PersonOwnership"]);
  const baseArgs = {
    labelA: "Person",
    pkNameA: "id",
    pkValueA: "p1",
    labelB: "Company",
    pkNameB: "id",
    pkValueB: "c1",
    pkName: "id",
    nodeLabelSet,
    relLabelSet,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runs discovery then hydration and returns the hydration row + dataTypes", async () => {
    const discoveryResponse = {
      rows: [{ nodeIds: [], nodeLabels: [], relLabels: ["PersonOwnership"] }],
    };
    const hydrationRow = {
      n0: { _id: { table: 0, offset: 1 }, _label: "Person" },
      r0: { _id: { table: 2, offset: 3 }, _label: "PersonOwnership" },
      n1: { _id: { table: 1, offset: 2 }, _label: "Company" },
    };
    const hydrationResponse = {
      rows: [hydrationRow],
      dataTypes: { n0: "NODE", r0: "REL", n1: "NODE" },
    };
    const spy = vi
      .spyOn(PathFinder, "_runQuery")
      .mockResolvedValueOnce(discoveryResponse)
      .mockResolvedValueOnce(hydrationResponse);

    const result = await PathFinder.findShortestPath(baseArgs);
    expect(result.found).toBe(true);
    expect(result.hops).toBe(1);
    expect(result.maxHops).toBe(12);
    expect(result.row).toBe(hydrationRow);
    expect(result.dataTypes).toEqual({ n0: "NODE", r0: "REL", n1: "NODE" });

    // Two queries ran; discovery first with the bound endpoint params.
    expect(spy).toHaveBeenCalledTimes(2);
    const [discQuery, discParams] = spy.mock.calls[0];
    expect(discQuery).toContain("SHORTEST 1..12");
    expect(discParams).toEqual({ aid: "p1", bid: "c1" });
    const [, hydParams] = spy.mock.calls[1];
    expect(hydParams).toEqual({ pk0: "p1", pk1: "c1" });
  });

  it("returns no-path without hydrating when discovery finds nothing", async () => {
    const spy = vi.spyOn(PathFinder, "_runQuery").mockResolvedValue({ rows: [] });
    const result = await PathFinder.findShortestPath(baseArgs);
    expect(result).toEqual({ found: false, hops: 0, maxHops: 12 });
    // Only discovery ran — no second query.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("throws (not no-path) when discovery finds a path but hydration returns 0 rows", async () => {
    const discoveryResponse = {
      rows: [{ nodeIds: [], nodeLabels: [], relLabels: ["PersonOwnership"] }],
    };
    vi.spyOn(PathFinder, "_runQuery")
      .mockResolvedValueOnce(discoveryResponse)
      .mockResolvedValueOnce({ rows: [] });
    await expect(PathFinder.findShortestPath(baseArgs)).rejects.toThrow(
      /could not be hydrated/
    );
  });

  it("propagates query/network errors instead of swallowing them as no-path", async () => {
    vi.spyOn(PathFinder, "_runQuery").mockRejectedValue(new Error("boom"));
    await expect(PathFinder.findShortestPath(baseArgs)).rejects.toThrow("boom");
  });
});
