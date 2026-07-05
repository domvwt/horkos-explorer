import { describe, it, expect, vi, beforeEach } from "vitest";

// PathFinder pulls in the Axios wrapper and the Kuzu WASM module at load time;
// both are browser-only. Stub them so the pure query-builder / result-shaping
// logic can be exercised under node without DOM or network. The findShortestPath
// tests spy on _runQuery directly, so the stubs stay uncalled there.
vi.mock("@/utils/AxiosWrapper", () => ({ default: { post: vi.fn() } }));
vi.mock("./KuzuWasm", () => ({ default: { query: vi.fn() } }));

import PathFinder, {
  buildShortestPathQuery,
  extractPathResult,
  clampMaxHops,
  DEFAULT_MAX_HOPS,
  HARD_MAX_HOPS,
} from "./PathFinder";

describe("clampMaxHops", () => {
  it("passes valid in-range hop counts through", () => {
    expect(clampMaxHops(1)).toBe(1);
    expect(clampMaxHops(4)).toBe(4);
    expect(clampMaxHops(6)).toBe(6);
  });

  it("clamps above the hard max down to the ceiling", () => {
    expect(clampMaxHops(7)).toBe(HARD_MAX_HOPS);
    expect(clampMaxHops(100)).toBe(HARD_MAX_HOPS);
  });

  it("defaults non-positive / non-integer / missing to the default", () => {
    expect(clampMaxHops(0)).toBe(DEFAULT_MAX_HOPS);
    expect(clampMaxHops(-3)).toBe(DEFAULT_MAX_HOPS);
    expect(clampMaxHops(2.5)).toBe(DEFAULT_MAX_HOPS);
    expect(clampMaxHops(undefined)).toBe(DEFAULT_MAX_HOPS);
    expect(clampMaxHops("nope")).toBe(DEFAULT_MAX_HOPS);
    expect(clampMaxHops(NaN)).toBe(DEFAULT_MAX_HOPS);
  });
});

describe("buildShortestPathQuery", () => {
  it("emits the exact parameterised, undirected, hop-bounded query", () => {
    const { query, params, maxHops } = buildShortestPathQuery({
      labelA: "Person",
      pkNameA: "id",
      pkValueA: "p1",
      labelB: "Company",
      pkNameB: "id",
      pkValueB: "c1",
    });
    expect(query).toBe(
      "MATCH p = (a:`Person`)-[* SHORTEST 1..4]-(b:`Company`) " +
        "WHERE a.`id` = $aid AND b.`id` = $bid RETURN p LIMIT 1;"
    );
    // pk VALUES flow ONLY through params — never interpolated into the text.
    expect(params).toEqual({ aid: "p1", bid: "c1" });
    expect(query).not.toContain("p1");
    expect(query).not.toContain("c1");
    expect(maxHops).toBe(4);
  });

  it("defaults to 4 hops and honours an explicit deeper bound up to 6", () => {
    const shallow = buildShortestPathQuery({
      labelA: "Person",
      pkNameA: "id",
      pkValueA: "a",
      labelB: "Company",
      pkNameB: "id",
      pkValueB: "b",
    });
    expect(shallow.query).toContain("[* SHORTEST 1..4]");

    const deeper = buildShortestPathQuery({
      labelA: "Person",
      pkNameA: "id",
      pkValueA: "a",
      labelB: "Company",
      pkNameB: "id",
      pkValueB: "b",
      maxHops: 6,
    });
    expect(deeper.query).toContain("[* SHORTEST 1..6]");
    expect(deeper.maxHops).toBe(6);
  });

  it("clamps an over-large requested bound to the hard max of 6", () => {
    const { query, maxHops } = buildShortestPathQuery({
      labelA: "Person",
      pkNameA: "id",
      pkValueA: "a",
      labelB: "Company",
      pkNameB: "id",
      pkValueB: "b",
      maxHops: 42,
    });
    expect(query).toContain("[* SHORTEST 1..6]");
    expect(maxHops).toBe(6);
  });

  it("escapes label and primary-key identifiers (backtick injection safe)", () => {
    const { query } = buildShortestPathQuery({
      labelA: "Odd`Label",
      pkNameA: "we`ird",
      pkValueA: "a",
      labelB: "Company",
      pkNameB: "id",
      pkValueB: "b",
    });
    // A backtick inside an identifier is doubled, keeping the identifier quoted.
    expect(query).toContain("(a:`Odd``Label`)");
    expect(query).toContain("a.`we``ird` = $aid");
  });

  it("unwraps boxed Number/String pk values into plain primitives", () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed = new String("boxed-id");
    const { params } = buildShortestPathQuery({
      labelA: "Person",
      pkNameA: "id",
      pkValueA: boxed,
      labelB: "Company",
      pkNameB: "id",
      pkValueB: 123,
    });
    expect(typeof params.aid).toBe("string");
    expect(params.aid).toBe("boxed-id");
    expect(params.bid).toBe(123);
  });
});

describe("extractPathResult (RECURSIVE_REL shaping)", () => {
  it("counts hops from _rels and returns the row + dataTypes when a path exists", () => {
    const row = {
      p: {
        _nodes: [{ _id: { table: 0, offset: 1 } }, { _id: { table: 0, offset: 2 } }, { _id: { table: 1, offset: 9 } }],
        _rels: [{ _id: { table: 2, offset: 5 } }, { _id: { table: 3, offset: 7 } }],
      },
    };
    const result = extractPathResult({ rows: [row], dataTypes: { p: "RECURSIVE_REL" } });
    expect(result.found).toBe(true);
    // 2 relationships between 3 nodes = "connected in 2 steps".
    expect(result.hops).toBe(2);
    expect(result.row).toBe(row);
    // dataTypes passes through so the caller can hand the row straight to the
    // graph extractor, which keys on RECURSIVE_REL.
    expect(result.dataTypes).toEqual({ p: "RECURSIVE_REL" });
  });

  it("reports not-found for a zero-row response (no connection)", () => {
    expect(extractPathResult({ rows: [] })).toEqual({
      found: false,
      hops: 0,
      row: null,
      dataTypes: {},
    });
  });

  it("reports not-found for a null/undefined response without throwing", () => {
    expect(extractPathResult(null)).toEqual({ found: false, hops: 0, row: null, dataTypes: {} });
    expect(extractPathResult(undefined)).toEqual({
      found: false,
      hops: 0,
      row: null,
      dataTypes: {},
    });
  });

  it("reports not-found for a malformed path struct (no nodes/rels)", () => {
    expect(extractPathResult({ rows: [{ p: {} }] })).toEqual({
      found: false,
      hops: 0,
      row: null,
      dataTypes: {},
    });
    expect(extractPathResult({ rows: [{ p: { _nodes: [], _rels: [] } }] })).toEqual({
      found: false,
      hops: 0,
      row: null,
      dataTypes: {},
    });
    // Nodes without rels is not a path either (SHORTEST 1..N guarantees >=1 rel).
    expect(
      extractPathResult({ rows: [{ p: { _nodes: [{ id: "a" }, { id: "b" }], _rels: [] } }] })
    ).toEqual({
      found: false,
      hops: 0,
      row: null,
      dataTypes: {},
    });
  });
});

describe("findShortestPath (dual server/WASM dispatch)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const pathResponse = {
    rows: [
      {
        p: {
          _nodes: [{ _id: { table: 0, offset: 1 } }, { _id: { table: 1, offset: 2 } }],
          _rels: [{ _id: { table: 2, offset: 3 } }],
        },
      },
    ],
    dataTypes: { p: "RECURSIVE_REL" },
  };

  it("runs the query, shapes the result, and reports the clamped bound", async () => {
    const spy = vi.spyOn(PathFinder, "_runQuery").mockResolvedValue(pathResponse);
    const result = await PathFinder.findShortestPath({
      labelA: "Person",
      pkNameA: "id",
      pkValueA: "p1",
      labelB: "Company",
      pkNameB: "id",
      pkValueB: "c1",
      maxHops: 4,
      isWasm: false,
    });
    expect(result).toEqual({
      found: true,
      hops: 1,
      row: pathResponse.rows[0],
      dataTypes: { p: "RECURSIVE_REL" },
      maxHops: 4,
    });
    // Same query text + params object passed to _runQuery regardless of mode.
    expect(spy).toHaveBeenCalledTimes(1);
    const [query, params, isWasm] = spy.mock.calls[0];
    expect(query).toBe(
      "MATCH p = (a:`Person`)-[* SHORTEST 1..4]-(b:`Company`) " +
        "WHERE a.`id` = $aid AND b.`id` = $bid RETURN p LIMIT 1;"
    );
    expect(params).toEqual({ aid: "p1", bid: "c1" });
    expect(isWasm).toBe(false);
  });

  it("passes the isWasm flag through so the WASM query path is used", async () => {
    const spy = vi.spyOn(PathFinder, "_runQuery").mockResolvedValue({ rows: [] });
    const result = await PathFinder.findShortestPath({
      labelA: "Person",
      pkNameA: "id",
      pkValueA: "p1",
      labelB: "Company",
      pkNameB: "id",
      pkValueB: "c1",
      isWasm: true,
    });
    expect(result.found).toBe(false);
    expect(spy.mock.calls[0][2]).toBe(true);
  });

  it("propagates query/network errors instead of swallowing them as no-path", async () => {
    vi.spyOn(PathFinder, "_runQuery").mockRejectedValue(new Error("boom"));
    await expect(
      PathFinder.findShortestPath({
        labelA: "Person",
        pkNameA: "id",
        pkValueA: "p1",
        labelB: "Company",
        pkNameB: "id",
        pkValueB: "c1",
      })
    ).rejects.toThrow("boom");
  });
});
