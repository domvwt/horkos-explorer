import { describe, it, expect, vi } from "vitest";

// NeighborsFetcher pulls in the Axios wrapper at load time; it is
// browser-only. Stub it so the pure query-builder / merge logic can be
// exercised under node without a DOM or network. Every test that touches
// _runQuery spies on it directly, so the stub is never called.
vi.mock("@/utils/AxiosWrapper", () => ({ default: { post: vi.fn() } }));

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
  it("emits exactly two queries (one per direction), independent of rel-type count", () => {
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables,
    });
    // A wildcard `-[]-` binds every incident rel type in one traversal, so the
    // query count is one inbound + one outbound regardless of how many rel types
    // touch Company. The same holds for a single rel type or a dozen.
    expect(queries).toHaveLength(2);
    const single = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
    });
    expect(single).toHaveLength(2);
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
      // struct — the relationship is bound anonymously, so only NODE columns
      // cross the wire.
      expect(q).not.toMatch(/\br\b/);
      expect(q).not.toContain("sources");
      // The relationship is bound anonymously via a wildcard `-[]->`.
      expect(q).toMatch(/-\[\]->/);
    });
  });

  it("escapes the node table and primary-key identifiers", () => {
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Weird Table",
      primaryKeyName: "pk name",
      relTables: [{ name: "Rel Type", connectivity: [{ src: "Weird Table", dst: "Other" }] }],
    });
    expect(queries).toHaveLength(2);
    queries.forEach(q => {
      expect(q).toContain("(src:`Weird Table`)");
      expect(q).toContain("`pk name`");
    });
  });

  it("produces the correct inbound and outbound wildcard query shapes", () => {
    const queries = NeighborsFetcher._buildNeighborCountQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables,
    });
    expect(queries).toEqual([
      "UNWIND $pks AS pk MATCH (dst) -[]-> (src:`Company`) WHERE src.`id` = pk RETURN src.`id` AS pk, dst;",
      "UNWIND $pks AS pk MATCH (src:`Company`) -[]-> (dst) WHERE src.`id` = pk RETURN src.`id` AS pk, dst;",
    ]);
  });

  it("throws when relTables is not an array", () => {
    expect(() =>
      NeighborsFetcher._buildNeighborCountQueries({ tableName: "Company", primaryKeyName: "id" })
    ).toThrow();
  });
});

describe("fetchNeighborNodesBatched", () => {
  it("binds the whole pk list as a single $pks param, once per direction", async () => {
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

    // One wildcard query per direction (inbound + outbound) -> exactly 2
    // requests, regardless of the 2 rel types or the 3 pks.
    expect(runSpy).toHaveBeenCalledTimes(2);
    runSpy.mock.calls.forEach(([, params]) => {
      expect(params).toEqual({ pks: ["c1", "c2", "c3"] });
    });
    runSpy.mockRestore();
  });

  it("issues two requests per chunk regardless of how many rel types touch the node", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: {} });

    // The full Horkos-shaped set touches Company via several rel types, but the
    // wildcard collapses them to one inbound + one outbound query -> 2 requests
    // for a single chunk of pks.
    await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: ["c1", "c2", "c3"],
      relTables,
    });
    expect(runSpy).toHaveBeenCalledTimes(2);
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

  it("chunks a pk list larger than the chunk size into multiple requests per direction", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: {} });

    // 60 pks with a chunk size of 25 -> 3 chunks (25 + 25 + 10). Two wildcard
    // direction-queries per chunk -> 6 requests total (not 3, and never 60).
    const pks = Array.from({ length: 60 }, (_, i) => `c${i}`);
    await NeighborsFetcher.fetchNeighborNodesBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: pks,
      relTables: [
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
    });

    expect(runSpy).toHaveBeenCalledTimes(6);
    // Each direction-query for a chunk carries that chunk's pks; the DISTINCT
    // chunks partition the full pk list exactly (no pk dropped, none duplicated).
    // Two queries per chunk means each chunk's pk list appears twice, so dedupe
    // consecutive pairs before checking the partition.
    const chunks = runSpy.mock.calls.map(([, params]) => params.pks);
    // Chunk boundaries: [25, 25, 10] each appearing twice (inbound + outbound).
    expect(chunks.map(c => c.length)).toEqual([25, 25, 25, 25, 10, 10]);
    const distinctChunks = [chunks[0], chunks[2], chunks[4]];
    expect(distinctChunks.flat()).toEqual(pks);
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

    // 2 chunks x 2 wildcard direction-queries = 4 requests; only the first two
    // return rows (the rest resolve undefined and are tolerated). Rows key by
    // their source pk, so which query returned them is irrelevant to the merge.
    expect(runSpy).toHaveBeenCalledTimes(4);
    expect(byPk.c0.map(n => encodeId(n._id)).sort()).toEqual(["1_10", "1_11"]);
    expect(byPk.c25.map(n => encodeId(n._id))).toEqual(["1_12"]);
    runSpy.mockRestore();
  });

  it("accumulates neighbours for a pk that recurs across chunks (multi rel type)", async () => {
    const nodeA = { _id: { table: 1, offset: 10 }, _label: "Address" };
    const nodeP = { _id: { table: 2, offset: 5 }, _label: "Person" };

    // A single pk with two wildcard direction-queries * one chunk = two
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

describe("_buildRelsBetweenNodeAndPksQueries", () => {
  it("emits one query per rel type that connects the two tables, in either direction", () => {
    // Directorship connects Person<->Company (Person is focus here, Company the
    // other), CorporateOwnership is Company<->Company (irrelevant to a Person
    // focus), ResidentialAddress is Person<->Address (irrelevant to a Company
    // other). Only Directorship qualifies.
    const queries = NeighborsFetcher._buildRelsBetweenNodeAndPksQueries({
      focusTable: "Person",
      focusPkName: "id",
      otherTable: "Company",
      otherPkName: "id",
      relTables,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("-[r:`Directorship`]-");
  });

  it("binds the focus pk as $pk1 and the other endpoints as an UNWIND $pks2 list", () => {
    const queries = NeighborsFetcher._buildRelsBetweenNodeAndPksQueries({
      focusTable: "Person",
      focusPkName: "id",
      otherTable: "Company",
      otherPkName: "id",
      relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
    });
    expect(queries[0]).toBe(
      "UNWIND $pks2 AS pk2 MATCH (a:`Person`) -[r:`Directorship`]- (b:`Company`) WHERE a.`id` = $pk1 AND b.`id` = pk2 RETURN r;"
    );
  });

  it("matches undirected so it finds edges regardless of stored direction", () => {
    // Company as focus, Company as other, via CorporateOwnership (Company<->
    // Company). The undirected `-[r]-` pattern means one query catches both
    // ownership directions.
    const queries = NeighborsFetcher._buildRelsBetweenNodeAndPksQueries({
      focusTable: "Company",
      focusPkName: "id",
      otherTable: "Company",
      otherPkName: "id",
      relTables: [{ name: "CorporateOwnership", connectivity: [{ src: "Company", dst: "Company" }] }],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("(a:`Company`) -[r:`CorporateOwnership`]- (b:`Company`)");
  });

  it("escapes identifiers and returns no queries for an unconnected table pair", () => {
    expect(
      NeighborsFetcher._buildRelsBetweenNodeAndPksQueries({
        focusTable: "Person",
        focusPkName: "id",
        otherTable: "Address",
        otherPkName: "id",
        relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
      })
    ).toHaveLength(0);

    const escaped = NeighborsFetcher._buildRelsBetweenNodeAndPksQueries({
      focusTable: "Weird Table",
      focusPkName: "pk name",
      otherTable: "Other Table",
      otherPkName: "other pk",
      relTables: [{ name: "Rel Type", connectivity: [{ src: "Weird Table", dst: "Other Table" }] }],
    });
    expect(escaped[0]).toContain("(a:`Weird Table`)");
    expect(escaped[0]).toContain("(b:`Other Table`)");
    expect(escaped[0]).toContain("a.`pk name` = $pk1");
    expect(escaped[0]).toContain("b.`other pk` = pk2");
    expect(escaped[0]).toContain("-[r:`Rel Type`]-");
  });

  it("throws when relTables is not an array", () => {
    expect(() =>
      NeighborsFetcher._buildRelsBetweenNodeAndPksQueries({
        focusTable: "Person",
        focusPkName: "id",
        otherTable: "Company",
        otherPkName: "id",
      })
    ).toThrow();
  });
});

describe("fetchRelsBetweenNodeAndMany", () => {
  it("runs one request per (rel type x other-table) and merges the rows", async () => {
    const rel1 = { _id: { table: 5, offset: 1 }, _label: "Directorship" };
    const rel2 = { _id: { table: 6, offset: 2 }, _label: "ResidentialAddress" };
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      // Person focus -> Company others (Directorship)
      .mockResolvedValueOnce({ rows: [{ r: rel1 }], dataTypes: { r: "REL" } })
      // Person focus -> Address others (ResidentialAddress)
      .mockResolvedValueOnce({ rows: [{ r: rel2 }], dataTypes: { r: "REL" } });

    const merged = await NeighborsFetcher.fetchRelsBetweenNodeAndMany({
      focusTable: "Person",
      focusPkName: "id",
      focusPkValue: "p1",
      others: [
        { table: "Company", primaryKeyName: "id", primaryKeyValues: ["c1", "c2"] },
        { table: "Address", primaryKeyName: "id", primaryKeyValues: ["a1"] },
      ],
      relTables,
    });

    // Person connects to Company via Directorship (1 query) and to Address via
    // ResidentialAddress (1 query) -> 2 requests.
    expect(runSpy).toHaveBeenCalledTimes(2);
    // Focus pk is bound once as $pk1; the other endpoints ride as $pks2.
    runSpy.mock.calls.forEach(([, params]) => {
      expect(params.pk1).toBe("p1");
      expect(Array.isArray(params.pks2)).toBe(true);
    });
    expect(merged.rows.map(row => encodeId(row.r._id)).sort()).toEqual(["5_1", "6_2"]);
    runSpy.mockRestore();
  });

  it("makes no request and returns null when no other table connects to the focus", async () => {
    const runSpy = vi.spyOn(NeighborsFetcher, "_runQuery");
    // Address focus with only a Company other, but the only rel type given is
    // Directorship (Person<->Company) which never touches Address.
    const merged = await NeighborsFetcher.fetchRelsBetweenNodeAndMany({
      focusTable: "Address",
      focusPkName: "id",
      focusPkValue: "a1",
      others: [{ table: "Company", primaryKeyName: "id", primaryKeyValues: ["c1"] }],
      relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
    });
    expect(merged).toBeNull();
    expect(runSpy).not.toHaveBeenCalled();
    runSpy.mockRestore();
  });

  it("skips other-table entries with an empty pk list without querying them", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: { r: "REL" } });
    await NeighborsFetcher.fetchRelsBetweenNodeAndMany({
      focusTable: "Person",
      focusPkName: "id",
      focusPkValue: "p1",
      others: [
        { table: "Company", primaryKeyName: "id", primaryKeyValues: [] },
        { table: "Address", primaryKeyName: "id", primaryKeyValues: ["a1"] },
      ],
      relTables,
    });
    // Company has no pks -> only the Address (ResidentialAddress) query runs.
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0][0]).toContain("-[r:`ResidentialAddress`]-");
    runSpy.mockRestore();
  });

  it("throws when others is not an array", async () => {
    await expect(
      NeighborsFetcher.fetchRelsBetweenNodeAndMany({
        focusTable: "Person",
        focusPkName: "id",
        focusPkValue: "p1",
        relTables,
      })
    ).rejects.toThrow();
  });
});

describe("_buildRelsAmongPkListsQueries", () => {
  it("emits one query per rel type that connects the two tables, in either direction", () => {
    // Person<->Company is connected only by Directorship among the set.
    const queries = NeighborsFetcher._buildRelsAmongPkListsQueries({
      tableA: "Person",
      pkNameA: "id",
      tableB: "Company",
      pkNameB: "id",
      relTables,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("-[r:`Directorship`]-");
  });

  it("binds both endpoint sets as UNWIND $pksA / $pksB lists", () => {
    const queries = NeighborsFetcher._buildRelsAmongPkListsQueries({
      tableA: "Person",
      pkNameA: "id",
      tableB: "Company",
      pkNameB: "id",
      relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
    });
    expect(queries[0]).toBe(
      "UNWIND $pksA AS a_pk UNWIND $pksB AS b_pk MATCH (a:`Person`) -[r:`Directorship`]- (b:`Company`) WHERE a.`id` = a_pk AND b.`id` = b_pk RETURN r;"
    );
  });

  it("matches undirected so a same-table self-pairing finds edges regardless of stored direction", () => {
    const queries = NeighborsFetcher._buildRelsAmongPkListsQueries({
      tableA: "Company",
      pkNameA: "id",
      tableB: "Company",
      pkNameB: "id",
      relTables: [{ name: "CorporateOwnership", connectivity: [{ src: "Company", dst: "Company" }] }],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("(a:`Company`) -[r:`CorporateOwnership`]- (b:`Company`)");
  });

  it("escapes identifiers and returns no queries for an unconnected table pair", () => {
    expect(
      NeighborsFetcher._buildRelsAmongPkListsQueries({
        tableA: "Person",
        pkNameA: "id",
        tableB: "Address",
        pkNameB: "id",
        relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
      })
    ).toHaveLength(0);

    const escaped = NeighborsFetcher._buildRelsAmongPkListsQueries({
      tableA: "Weird Table",
      pkNameA: "pk name",
      tableB: "Other Table",
      pkNameB: "other pk",
      relTables: [{ name: "Rel Type", connectivity: [{ src: "Weird Table", dst: "Other Table" }] }],
    });
    expect(escaped[0]).toContain("(a:`Weird Table`)");
    expect(escaped[0]).toContain("(b:`Other Table`)");
    expect(escaped[0]).toContain("a.`pk name` = a_pk");
    expect(escaped[0]).toContain("b.`other pk` = b_pk");
    expect(escaped[0]).toContain("-[r:`Rel Type`]-");
  });

  it("throws when relTables is not an array", () => {
    expect(() =>
      NeighborsFetcher._buildRelsAmongPkListsQueries({
        tableA: "Person",
        pkNameA: "id",
        tableB: "Company",
        pkNameB: "id",
      })
    ).toThrow();
  });
});

describe("fetchRelsAmongNodes", () => {
  it("visits each unordered table pairing once (incl. self-pairs) and merges rows", async () => {
    const rel1 = { _id: { table: 5, offset: 1 }, _label: "Directorship" };
    const rel2 = { _id: { table: 7, offset: 3 }, _label: "CorporateOwnership" };
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: { r: "REL" } });
    // Person-Person self-pair: no rel type connects Person<->Person -> 0 queries.
    // Person-Company pair: Directorship -> 1 query.
    // Company-Company self-pair: CorporateOwnership -> 1 query.
    runSpy
      .mockResolvedValueOnce({ rows: [{ r: rel1 }], dataTypes: { r: "REL" } })
      .mockResolvedValueOnce({ rows: [{ r: rel2 }], dataTypes: { r: "REL" } });

    const merged = await NeighborsFetcher.fetchRelsAmongNodes({
      nodes: [
        { table: "Person", primaryKeyName: "id", primaryKeyValues: ["p1", "p2"] },
        { table: "Company", primaryKeyName: "id", primaryKeyValues: ["c1", "c2", "c3"] },
      ],
      relTables,
    });

    // Pairings: Person-Person (0), Person-Company (Directorship, 1),
    // Company-Company (CorporateOwnership, 1) -> 2 requests total. Crucially
    // this is independent of the 5 pk values in the batch.
    expect(runSpy).toHaveBeenCalledTimes(2);
    runSpy.mock.calls.forEach(([, params]) => {
      expect(Array.isArray(params.pksA)).toBe(true);
      expect(Array.isArray(params.pksB)).toBe(true);
    });
    expect(merged.rows.map(row => encodeId(row.r._id)).sort()).toEqual(["5_1", "7_3"]);
    runSpy.mockRestore();
  });

  it("keeps query count bounded and independent of the number of nodes", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: { r: "REL" } });

    const makeNodes = n => [
      {
        table: "Person",
        primaryKeyName: "id",
        primaryKeyValues: Array.from({ length: n }, (_, i) => `p${i}`),
      },
      {
        table: "Company",
        primaryKeyName: "id",
        primaryKeyValues: Array.from({ length: n }, (_, i) => `c${i}`),
      },
    ];

    await NeighborsFetcher.fetchRelsAmongNodes({ nodes: makeNodes(3), relTables });
    const callsForSmall = runSpy.mock.calls.length;
    runSpy.mockClear();

    await NeighborsFetcher.fetchRelsAmongNodes({ nodes: makeNodes(500), relTables });
    const callsForLarge = runSpy.mock.calls.length;

    // Same two tables, same rel-type connectivity: the request count must not
    // grow with the batch size (no per-entity or per-pair query burst).
    expect(callsForLarge).toBe(callsForSmall);
    // Concretely: Person-Person (0) + Person-Company (Directorship, 1) +
    // Company-Company (CorporateOwnership, 1) = 2 requests, regardless of N.
    expect(callsForLarge).toBe(2);
    runSpy.mockRestore();
  });

  it("skips node entries with an empty pk list and makes no request when nothing connects", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: { r: "REL" } });
    const merged = await NeighborsFetcher.fetchRelsAmongNodes({
      nodes: [
        { table: "Person", primaryKeyName: "id", primaryKeyValues: [] },
        { table: "Address", primaryKeyName: "id", primaryKeyValues: ["a1"] },
      ],
      relTables,
    });
    // Person dropped (no pks); only the Address self-pair remains, and no rel
    // type connects Address<->Address -> no requests, null result.
    expect(runSpy).not.toHaveBeenCalled();
    expect(merged).toBeNull();
    runSpy.mockRestore();
  });

  it("throws when nodes is not an array", async () => {
    await expect(
      NeighborsFetcher.fetchRelsAmongNodes({ relTables })
    ).rejects.toThrow();
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

describe("fetchNeighbors query collapse", () => {
  // A schema-realistic set where the focus table is incident to MANY rel types
  // in both directions — the fan-out the wildcard collapse targets. Company is
  // src of RegisteredAddress + both self-referential rels, and dst of two more.
  const denseRels = [
    { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
    { name: "PersonOwnership", connectivity: [{ src: "Person", dst: "Company" }] },
    { name: "PersonInfluence", connectivity: [{ src: "Person", dst: "Company" }] },
    { name: "CorporateOwnership", connectivity: [{ src: "Company", dst: "Company" }] },
    { name: "CorporateInfluence", connectivity: [{ src: "Company", dst: "Company" }] },
    { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
    { name: "CompanyAmbiguousLink", connectivity: [{ src: "Company", dst: "VirtualHub" }] },
  ];

  it("issues exactly two queries (one per direction) instead of one per rel type", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: { r: "REL", dst: "NODE" } });

    // Pre-collapse this would have been ~9 queries (one per incident rel type
    // per direction); the wildcard collapses it to a fixed 2.
    await NeighborsFetcher.fetchNeighbors({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValue: "c1",
      relTables: denseRels,
      sizeLimit: 100,
    });

    expect(runSpy).toHaveBeenCalledTimes(2);
    // One inbound wildcard, one outbound wildcard — no rel-type label bound.
    const [inboundQuery] = runSpy.mock.calls[0];
    const [outboundQuery] = runSpy.mock.calls[1];
    expect(inboundQuery).toBe(
      "MATCH (dst) -[r]-> (src:`Company`) WHERE src.`id` = $pk RETURN r, dst LIMIT 100;"
    );
    expect(outboundQuery).toBe(
      "MATCH (src:`Company`) -[r]-> (dst) WHERE src.`id` = $pk RETURN r, dst LIMIT 100;"
    );
    // The pk value is always bound, never interpolated.
    runSpy.mock.calls.forEach(([, params]) => expect(params).toEqual({ pk: "c1" }));
    runSpy.mockRestore();
  });

  it("merges a heterogeneous wildcard result (edges of several rel types) into one row set", async () => {
    // The core premise of the collapse: a single wildcard query returns edges of
    // MULTIPLE rel types (with divergent property shapes) in one REL column. The
    // fetcher must merge them without dropping any, keyed only by row shape.
    const ownership = { r: { _id: { table: 7, offset: 1 }, _label: "CorporateOwnership" }, dst: { _id: { table: 3, offset: 1 }, _label: "Company" } };
    const influence = { r: { _id: { table: 8, offset: 1 }, _label: "CorporateInfluence" }, dst: { _id: { table: 3, offset: 2 }, _label: "Company" } };
    const address = { r: { _id: { table: 6, offset: 1 }, _label: "RegisteredAddress" }, dst: { _id: { table: 1, offset: 1 }, _label: "Address" } };
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      // inbound: empty; outbound: a single wildcard result carrying 3 rel types.
      .mockResolvedValueOnce({ rows: [], dataTypes: { r: "REL", dst: "NODE" } })
      .mockResolvedValueOnce({
        rows: [ownership, influence, address],
        dataTypes: { r: "REL", dst: "NODE" },
      });

    const result = await NeighborsFetcher.fetchNeighbors({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValue: "c1",
      relTables: denseRels,
      sizeLimit: 100,
    });

    expect(result.rows).toHaveLength(3);
    const relLabels = result.rows.map(row => row.r._label).sort();
    expect(relLabels).toEqual(["CorporateInfluence", "CorporateOwnership", "RegisteredAddress"]);
    expect(result.truncated).toBe(false);
    expect(result.incomplete).toBeFalsy();
    runSpy.mockRestore();
  });
});

describe("fetchNeighbors truncation flag", () => {
  // Neighbour fixtures: a handful of DISTINCT nodes that many edge rows point
  // at, so a full fetch window can collapse to far fewer entities.
  const person1 = { _id: { table: 2, offset: 1 }, _label: "Person" };
  const person2 = { _id: { table: 2, offset: 2 }, _label: "Person" };

  const makeRows = (count, targets) =>
    Array.from({ length: count }, (_, i) => ({
      r: { _id: { table: 5, offset: i }, _label: "Directorship" },
      dst: targets[i % targets.length],
    }));

  it("flags truncated when a direction fills the whole window, even if rows collapse to few distinct entities", async () => {
    // 5 edge rows (= sizeLimit) over only 2 distinct neighbours: an
    // entity-level consumer collapsing these lands well below any entity cap,
    // but edges beyond the window were never fetched — truncated must be true.
    // The inbound wildcard query fills the window; the outbound one is empty.
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValueOnce({
        rows: makeRows(5, [person1, person2]),
        dataTypes: { r: "REL", dst: "NODE" },
      })
      .mockResolvedValueOnce({ rows: [], dataTypes: { r: "REL", dst: "NODE" } });

    const result = await NeighborsFetcher.fetchNeighbors({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValue: "c1",
      relTables: [
        { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
      ],
      sizeLimit: 5,
    });

    expect(result.rows).toHaveLength(5);
    const distinct = new Set(result.rows.map(row => encodeId(row.dst._id)));
    expect(distinct.size).toBe(2); // collapsed count is far below the window
    expect(result.truncated).toBe(true);
    runSpy.mockRestore();
  });

  it("does not flag truncated when both directions come back under the window", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      // inbound Directorship: 2 rows, outbound RegisteredAddress: 1 row
      .mockResolvedValueOnce({
        rows: makeRows(2, [person1, person2]),
        dataTypes: { r: "REL", dst: "NODE" },
      })
      .mockResolvedValueOnce({
        rows: [
          {
            r: { _id: { table: 6, offset: 0 }, _label: "RegisteredAddress" },
            dst: { _id: { table: 1, offset: 9 }, _label: "Address" },
          },
        ],
        dataTypes: { r: "REL", dst: "NODE" },
      });

    const result = await NeighborsFetcher.fetchNeighbors({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValue: "c1",
      relTables: [
        { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
      sizeLimit: 5,
    });

    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(false);
    runSpy.mockRestore();
  });

  it("flags truncated when only the OUTBOUND direction fills its window", async () => {
    const addr = { _id: { table: 1, offset: 9 }, _label: "Address" };
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      // inbound Directorship: 1 row (under), outbound RegisteredAddress: 3 rows (at cap)
      .mockResolvedValueOnce({
        rows: makeRows(1, [person1]),
        dataTypes: { r: "REL", dst: "NODE" },
      })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 3 }, (_, i) => ({
          r: { _id: { table: 6, offset: i }, _label: "RegisteredAddress" },
          dst: addr,
        })),
        dataTypes: { r: "REL", dst: "NODE" },
      });

    const result = await NeighborsFetcher.fetchNeighbors({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValue: "c1",
      relTables: [
        { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
      sizeLimit: 3,
    });

    expect(result.truncated).toBe(true);
    runSpy.mockRestore();
  });
});

describe("_buildNeighborQueries", () => {
  it("emits exactly two queries (one per direction), independent of rel-type count", () => {
    const queries = NeighborsFetcher._buildNeighborQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables,
    });
    // A wildcard `-[r]-` binds every incident rel type in one traversal, so it
    // is one inbound + one outbound query regardless of how many rel types touch
    // Company — and the same for a single rel type.
    expect(queries).toHaveLength(2);
    const single = NeighborsFetcher._buildNeighborQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
    });
    expect(single).toHaveLength(2);
  });

  it("projects the pk, the edge r, AND the neighbour node dst", () => {
    const queries = NeighborsFetcher._buildNeighborQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables,
    });
    queries.forEach(q => {
      expect(q).toContain("UNWIND $pks AS pk");
      // Unlike the count builder, this one binds AND returns the edge var `r`
      // alongside dst so edges draw. `r` is a wildcard (no rel-type label), which
      // binds all incident rel types at once.
      expect(q).toContain("RETURN src.`id` AS pk, r, dst;");
      expect(q).toMatch(/-\[r\]->/);
    });
  });

  it("produces correct inbound and outbound wildcard query shapes", () => {
    const queries = NeighborsFetcher._buildNeighborQueries({
      tableName: "Company",
      primaryKeyName: "id",
      relTables,
    });
    expect(queries).toEqual([
      "UNWIND $pks AS pk MATCH (dst) -[r]-> (src:`Company`) WHERE src.`id` = pk RETURN src.`id` AS pk, r, dst;",
      "UNWIND $pks AS pk MATCH (src:`Company`) -[r]-> (dst) WHERE src.`id` = pk RETURN src.`id` AS pk, r, dst;",
    ]);
  });

  it("escapes the node table and primary-key identifiers", () => {
    const queries = NeighborsFetcher._buildNeighborQueries({
      tableName: "Weird Table",
      primaryKeyName: "pk name",
      relTables: [{ name: "Rel Type", connectivity: [{ src: "Weird Table", dst: "Other" }] }],
    });
    expect(queries).toHaveLength(2);
    queries.forEach(q => {
      expect(q).toContain("(src:`Weird Table`)");
      expect(q).toContain("`pk name`");
    });
  });

  it("throws when relTables is not an array", () => {
    expect(() =>
      NeighborsFetcher._buildNeighborQueries({ tableName: "Company", primaryKeyName: "id" })
    ).toThrow();
  });
});

describe("fetchNeighborsBatched", () => {
  const companyRels = [
    { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
    { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
  ];

  it("binds the whole pk list as a single $pks param, once per direction, and merges rows", async () => {
    const rowP = { pk: "c1", r: { _id: { table: 5, offset: 1 }, _label: "Directorship" }, dst: { _id: { table: 2, offset: 1 }, _label: "Person" } };
    const rowA = { pk: "c1", r: { _id: { table: 6, offset: 1 }, _label: "RegisteredAddress" }, dst: { _id: { table: 1, offset: 1 }, _label: "Address" } };
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValueOnce({ rows: [rowP], dataTypes: { pk: "STRING", r: "REL", dst: "NODE" } })
      .mockResolvedValueOnce({ rows: [rowA], dataTypes: { pk: "STRING", r: "REL", dst: "NODE" } });

    const result = await NeighborsFetcher.fetchNeighborsBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: ["c1", "c2", "c3"],
      relTables: companyRels,
    });

    // 2 rel types (1 inbound + 1 outbound) -> 2 requests, regardless of 3 pks.
    expect(runSpy).toHaveBeenCalledTimes(2);
    runSpy.mock.calls.forEach(([, params]) => {
      expect(params).toEqual({ pks: ["c1", "c2", "c3"] });
    });
    // Merged rows carry both r and dst, and the source pk for re-association.
    expect(result.rows).toHaveLength(2);
    expect(result.dataTypes).toEqual({ pk: "STRING", r: "REL", dst: "NODE" });
    expect(result.incomplete).toBe(false);
    expect(result.truncated).toBe(false);
    runSpy.mockRestore();
  });

  it("chunks a pk list larger than the chunk size into multiple requests per direction", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: { pk: "STRING", r: "REL", dst: "NODE" } });

    // 60 pks, chunk size 25 -> 3 chunks. Two wildcard direction-queries per
    // chunk -> 6 requests.
    const pks = Array.from({ length: 60 }, (_, i) => `c${i}`);
    await NeighborsFetcher.fetchNeighborsBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: pks,
      relTables: [{ name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] }],
    });

    expect(runSpy).toHaveBeenCalledTimes(6);
    const chunks = runSpy.mock.calls.map(([, params]) => params.pks);
    // Each chunk's pks appear twice (inbound + outbound). Dedupe consecutive
    // pairs to recover the exact partition of the pk list.
    expect(chunks.map(c => c.length)).toEqual([25, 25, 25, 25, 10, 10]);
    const distinctChunks = [chunks[0], chunks[2], chunks[4]];
    expect(distinctChunks.flat()).toEqual(pks);
    runSpy.mockRestore();
  });

  it("flags incomplete when ANY sub-query fails (shed), so the caller can bail all-or-nothing", async () => {
    // Directorship succeeds with a row; RegisteredAddress is shed (failure
    // sentinel from _runQuery). The merged result must report incomplete.
    const rowP = { pk: "c1", r: { _id: { table: 5, offset: 1 }, _label: "Directorship" }, dst: { _id: { table: 2, offset: 1 }, _label: "Person" } };
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValueOnce({ rows: [rowP], dataTypes: { pk: "STRING", r: "REL", dst: "NODE" } })
      .mockResolvedValueOnce({ __failed: true, status: 503 });

    const result = await NeighborsFetcher.fetchNeighborsBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: ["c1"],
      relTables: companyRels,
    });

    expect(result.incomplete).toBe(true);
    runSpy.mockRestore();
  });

  it("flags incomplete even when every sub-query fails (full shed) rather than returning empty", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ __failed: true, status: 503 });

    const result = await NeighborsFetcher.fetchNeighborsBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: ["c1"],
      relTables: companyRels,
    });

    expect(result.incomplete).toBe(true);
    expect(result.rows).toEqual([]);
    runSpy.mockRestore();
  });

  it("flags truncated when a chunk returns at least the row cap", async () => {
    // Fabricate a chunk result at the cap size to simulate a server-side cap.
    const capRows = Array.from({ length: 10000 }, (_, i) => ({
      pk: "c1",
      r: { _id: { table: 6, offset: i }, _label: "RegisteredAddress" },
      dst: { _id: { table: 1, offset: i }, _label: "Address" },
    }));
    // The inbound wildcard query returns the capped chunk; the outbound one
    // returns an honest empty result (so incomplete stays false).
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValueOnce({ rows: capRows, dataTypes: { pk: "STRING", r: "REL", dst: "NODE" } })
      .mockResolvedValueOnce({ rows: [], dataTypes: { pk: "STRING", r: "REL", dst: "NODE" } });

    const result = await NeighborsFetcher.fetchNeighborsBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: ["c1"],
      relTables: [{ name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] }],
    });

    expect(result.truncated).toBe(true);
    expect(result.incomplete).toBe(false);
    runSpy.mockRestore();
  });

  it("returns an empty, complete result for an empty pk list without querying", async () => {
    const runSpy = vi.spyOn(NeighborsFetcher, "_runQuery");
    const result = await NeighborsFetcher.fetchNeighborsBatched({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValues: [],
      relTables: companyRels,
    });
    expect(result).toEqual({ rows: [], dataTypes: [], incomplete: false, truncated: false });
    expect(runSpy).not.toHaveBeenCalled();
    runSpy.mockRestore();
  });

  it("throws when primaryKeyValues is not an array", async () => {
    await expect(
      NeighborsFetcher.fetchNeighborsBatched({
        tableName: "Company",
        primaryKeyName: "id",
        relTables: companyRels,
      })
    ).rejects.toThrow();
  });
});

describe("fetchNeighbors incomplete flag", () => {
  const person = { _id: { table: 2, offset: 1 }, _label: "Person" };

  it("does NOT flag incomplete when queries legitimately return zero rows", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ rows: [], dataTypes: { r: "REL", dst: "NODE" } });

    const result = await NeighborsFetcher.fetchNeighbors({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValue: "c1",
      relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
      sizeLimit: 5,
    });
    // All sub-queries succeeded and matched zero rows. The result must NOT be
    // flagged incomplete — a genuine empty neighbour set is honest, not a shed.
    expect(result === null || !result.incomplete).toBe(true);
    runSpy.mockRestore();
  });

  it("flags incomplete when a sub-query fails, distinguishing shed from empty", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      // inbound Directorship succeeds with a row
      .mockResolvedValueOnce({ rows: [{ r: { _id: { table: 5, offset: 1 }, _label: "Directorship" }, dst: person }], dataTypes: { r: "REL", dst: "NODE" } })
      // outbound RegisteredAddress is shed
      .mockResolvedValueOnce({ __failed: true, status: 503 });

    const result = await NeighborsFetcher.fetchNeighbors({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValue: "c1",
      relTables: [
        { name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] },
        { name: "RegisteredAddress", connectivity: [{ src: "Company", dst: "Address" }] },
      ],
      sizeLimit: 5,
    });

    expect(result).not.toBeNull();
    expect(result.incomplete).toBe(true);
    runSpy.mockRestore();
  });

  it("flags incomplete on a full shed rather than looking like an empty neighbour set", async () => {
    const runSpy = vi
      .spyOn(NeighborsFetcher, "_runQuery")
      .mockResolvedValue({ __failed: true, status: 429 });

    const result = await NeighborsFetcher.fetchNeighbors({
      tableName: "Company",
      primaryKeyName: "id",
      primaryKeyValue: "c1",
      relTables: [{ name: "Directorship", connectivity: [{ src: "Person", dst: "Company" }] }],
      sizeLimit: 5,
    });

    // A full shed must NOT collapse to null (which reads as "no neighbours").
    expect(result).not.toBeNull();
    expect(result.incomplete).toBe(true);
    runSpy.mockRestore();
  });
});
