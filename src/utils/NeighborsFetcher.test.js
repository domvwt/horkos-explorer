import { describe, it, expect, vi } from "vitest";

// NeighborsFetcher pulls in the Axios wrapper and the Kuzu WASM module at load
// time; both are browser-only. Stub them so the pure query-builder / merge
// logic can be exercised under node without a DOM or network. Every test that
// touches _runQuery spies on it directly, so these stubs are never called.
vi.mock("@/utils/AxiosWrapper", () => ({ default: { post: vi.fn() } }));
vi.mock("./KuzuWasm", () => ({ default: { query: vi.fn() } }));

import NeighborsFetcher from "./NeighborsFetcher";
import { encodeId } from "./GraphResultExtractor";

// A small Horkos-shaped rel-table set: two rel types, one inbound and one
// outbound relative to the Company table, plus one unrelated rel type that
// touches neither the src nor dst of Company.
const relTables = [
  {
    name: "Directorship",
    connectivity: [{ src: "Person", dst: "Company" }],
  },
  {
    name: "CorporateOwnership",
    connectivity: [{ src: "Company", dst: "Company" }],
  },
  {
    name: "RegisteredAddress",
    connectivity: [{ src: "Company", dst: "Address" }],
  },
  {
    name: "ResidentialAddress",
    connectivity: [{ src: "Person", dst: "Address" }],
  },
];

describe("_buildNeighborCountQueries", () => {
  it("emits one query per relevant rel type (never per node)", () => {
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables,
    });
    // Company is dst of Directorship (inbound), and src of CorporateOwnership
    // + RegisteredAddress (outbound). CorporateOwnership has Company as BOTH
    // src and dst, so it appears inbound AND outbound (both directions are
    // distinct traversals). ResidentialAddress touches neither -> excluded.
    // inbound: Directorship, CorporateOwnership  (2)
    // outbound: CorporateOwnership, RegisteredAddress (2)
    expect(queries).toHaveLength(4);
  });

  it("does not scale query count with the number of source nodes", () => {
    // The pk list is bound as a single $pks param, so the number of generated
    // queries is identical whether we count 1 node or 25.
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables,
    });
    // No query contains any literal pk value; all use UNWIND $pks.
    queries.forEach(q => {
      expect(q).toContain("UNWIND $pks AS pk");
      expect(q).toContain("WHERE src.`id` = pk");
    });
  });

  it("projects the neighbour node (dst) and the pk, never the relationship or its struct", () => {
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables,
    });
    queries.forEach(q => {
      // Returns pk + dst node only.
      expect(q).toContain("RETURN src.`id` AS pk, dst;");
      // Never binds or returns the relationship variable `r` or a `sources`
      // struct (the divergent-STRUCT binding hazard).
      expect(q).not.toMatch(/\br\b/);
      expect(q).not.toContain("sources");
      // The relationship is bound anonymously, one concrete type at a time.
      expect(q).toMatch(/-\[:`[A-Za-z]+`\]->/);
    });
  });

  it("escapes the node table and primary-key identifiers", () => {
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Weird Table",
      primaryKeyName: "pk name",
      relTables: [{ name: "Rel Type", connectivity: [{ src: "Weird Table", dst: "Other" }] }],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("(src:`Weird Table`)");
    expect(queries[0]).toContain("`pk name`");
    expect(queries[0]).toContain("-[:`Rel Type`]->");
  });

  it("produces a correct inbound query shape", () => {
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toBe(
      "UNWIND $pks AS pk MATCH (dst) -[:`Directorship`]-> (src:`Company`) WHERE src.`id` = pk RETURN src.`id` AS pk, dst;"
    );
  });

  it("produces a correct outbound query shape", () => {
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables: [{ name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] }],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toBe(
      "UNWIND $pks AS pk MATCH (src:`Company`) -[:`RegisteredAddress`]-> (dst) WHERE src.`id` = pk RETURN src.`id` AS pk, dst;"
    );
  });

  it("throws when relTables is not an array", () => {
    expect(() =>
      NeighborsFetcher._buildNeighborCountQueries({ tableName: "Company", primaryKeyName: "id" })
    ).toThrow();
  });
});

describe("fetchNeighborNodesBatched", () => {
  it("binds the whole pk list as a single $pks param, once per rel type", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: {} });

    const pks = ["c1", "c2", "c3"];
    await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: pks,
      relTables: [
        { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
    });

    // 2 rel types -> exactly 2 requests, regardless of the 3 pks.
    expect(runSpy).toHaveBeenCalledTimes(2);
    runSpy.mock.calls.forEach(([, params]) => {
      expect(params).toEqual({ pks: ["c1", "c2", "c3"] });
    });
    runSpy.mockRestore();
  });

  it("groups returned neighbour nodes by their source pk", async () => {
    const nodeA1 = { _id: { table: 1, offset: 10 }, _label: "Address" };
    const nodeA2 = { _id: { table: 1, offset: 11 }, _label: "Address" };
    const nodeP1 = { _id: { table: 2, offset: 5 }, _label: "Person" };

    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      // outbound RegisteredAddress result
      .mockResolvedValueOnce({
        rows: [
          { pk: "c1", dst: nodeA1 },
          { pk: "c1", dst: nodeA2 },
          { pk: "c2", dst: nodeA1 },
        ],
        dataTypes: { pk: "STRING", dst: "NODE" },
      })
      // inbound Directorship result
      .mockResolvedValueOnce({
        rows: [{ pk: "c1", dst: nodeP1 }],
        dataTypes: { pk: "STRING", dst: "NODE" },
      });

    const byPk = await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: ["c1", "c2"],
      relTables: [
        { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
    });

    expect(byPk.c1.map(n => encodeId(n._id)).sort()).toEqual(["1_10", "1_11", "2_5"]);
    expect(byPk.c2.map(n => encodeId(n._id))).toEqual(["1_10"]);
    runSpy.mockRestore();
  });

  it("chunks a pk list larger than the chunk size into multiple requests per rel type", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: {} });

    // 60 pks with a chunk size of 25 -> 3 chunks (25 + 25 + 10). One rel type
    // means one query per chunk, so 3 requests total (not 1, and not 60).
    const pks = Array.from({ length: 60 }, (_, i) => `c${i}`);
    await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: pks,
      relTables: [
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
    });

    expect(runSpy).toHaveBeenCalledTimes(3);
    // Each chunk stays at or below the chunk size, and the chunks partition the
    // full pk list exactly (no pk dropped, none duplicated across chunks).
    const chunks = runSpy.mock.calls.map(([, params]) => params.pks);
    expect(chunks.map(c => c.length)).toEqual([25, 25, 10]);
    expect(chunks.flat()).toEqual(pks);
    runSpy.mockRestore();
  });

  it("merges per-pk neighbours across chunks without dropping or double-counting", async () => {
    const nodeA = { _id: { table: 1, offset: 10 }, _label: "Address" };
    const nodeB = { _id: { table: 1, offset: 11 }, _label: "Address" };
    const nodeC = { _id: { table: 1, offset: 12 }, _label: "Address" };

    // 26 pks -> 2 chunks (25 + 1). A source pk that appears in the FIRST chunk
    // (c0) and one that appears in the SECOND chunk (c25) must both land in the
    // merged map, and neighbours for the same pk from different chunk results
    // must accumulate rather than overwrite.
    const pks = Array.from({ length: 26 }, (_, i) => `c${i}`);
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      // chunk 1 result (pks c0..c24)
      .mockResolvedValueOnce({
        rows: [
          { pk: "c0", dst: nodeA },
          { pk: "c0", dst: nodeB },
        ],
        dataTypes: { pk: "STRING", dst: "NODE" },
      })
      // chunk 2 result (pk c25)
      .mockResolvedValueOnce({
        rows: [{ pk: "c25", dst: nodeC }],
        dataTypes: { pk: "STRING", dst: "NODE" },
      });

    const byPk = await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: pks,
      relTables: [
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
    });

    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(byPk.c0.map(n => encodeId(n._id)).sort()).toEqual(["1_10", "1_11"]);
    expect(byPk.c25.map(n => encodeId(n._id))).toEqual(["1_12"]);
    runSpy.mockRestore();
  });

  it("accumulates neighbours for a pk that recurs across chunks (multi rel type)", async () => {
    const nodeA = { _id: { table: 1, offset: 10 }, _label: "Address" };
    const nodeP = { _id: { table: 2, offset: 5 }, _label: "Person" };

    // A single pk with two rel types produces two queries * one chunk = two
    // requests. Both results carry the same source pk and must accumulate.
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValueOnce({
        rows: [{ pk: "c1", dst: nodeA }],
        dataTypes: { pk: "STRING", dst: "NODE" },
      })
      .mockResolvedValueOnce({
        rows: [{ pk: "c1", dst: nodeP }],
        dataTypes: { pk: "STRING", dst: "NODE" },
      });

    const byPk = await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: ["c1"],
      relTables: [
        { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
    });

    expect(byPk.c1.map(n => encodeId(n._id)).sort()).toEqual(["1_10", "2_5"]);
    runSpy.mockRestore();
  });

  it("short-circuits with no requests for an empty pk list", async () => {
    const runSpy = vi.spyOn(NeighborsFetcher, "_runQuery");
    const byPk = await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: [],
      relTables,
    });
    expect(byPk).toEqual({});
    expect(runSpy).not.toHaveBeenCalled();
    runSpy.mockRestore();
  });

  it("tolerates a failed (null) query result without throwing", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        rows: [{ pk: "c1", dst: { _id: { table: 1, offset: 1 }, _label: "Address" } }],
        dataTypes: { pk: "STRING", dst: "NODE" },
      });
    const byPk = await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: ["c1"],
      relTables: [
        { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
    });
    expect(byPk.c1).toHaveLength(1);
    runSpy.mockRestore();
  });
});

// The "new neighbours only" count is a pure function of a neighbour-node list
// and the set of node ids already on the canvas. This mirrors the component's
// countNewNeighborNodes: encode each neighbour to its {table}_{offset} g6 id,
// dedupe, and count only those absent from the graph. Kept here as a pure
// reference so the semantics (dedupe + new-only + >10 badge threshold) are
// locked by a DB-free test.
function countNewNeighborNodes(neighborNodes, presentIds) {
  const seen = new Set();
  let newCount = 0;
  neighborNodes.forEach(neighbor => {
    if (!neighbor || !neighbor._id) return;
    const id = encodeId(neighbor._id);
    if (seen.has(id)) return;
    seen.add(id);
    if (!presentIds.has(id)) newCount++;
  });
  return newCount;
}

describe("new-only neighbour count semantics", () => {
  it("counts only neighbours not already on the canvas", () => {
    const neighbors = [
      { _id: { table: 1, offset: 1 } }, // new
      { _id: { table: 1, offset: 2 } }, // already present
      { _id: { table: 1, offset: 3 } }, // new
    ];
    const present = new Set(["1_2"]);
    expect(countNewNeighborNodes(neighbors, present)).toBe(2);
  });

  it("dedupes a neighbour reached via multiple rel types before counting", () => {
    const neighbors = [
      { _id: { table: 1, offset: 7 } },
      { _id: { table: 1, offset: 7 } }, // same neighbour, second rel type
      { _id: { table: 1, offset: 8 } },
    ];
    expect(countNewNeighborNodes(neighbors, new Set())).toBe(2);
  });

  it("crosses the >10 profligate threshold only above 10 NEW neighbours", () => {
    const make = n =>
      Array.from({ length: n }, (_, i) => ({ _id: { table: 9, offset: i } }));
    expect(countNewNeighborNodes(make(10), new Set())).toBe(10); // not profligate
    expect(countNewNeighborNodes(make(11), new Set())).toBe(11); // profligate (>10)
  });

  it("ignores malformed neighbour entries", () => {
    const neighbors = [null, {}, { _id: { table: 1, offset: 1 } }];
    expect(countNewNeighborNodes(neighbors, new Set())).toBe(1);
  });
});
