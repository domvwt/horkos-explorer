import Axios from "@/utils/AxiosWrapper";
import DataDefinitionLanguage from "./DataDefinitionLanguage";
import Kuzu from "./KuzuWasm";

/**
 * PathFinder — shortest-path discovery between two entities.
 *
 * Answers "how is entity A connected to entity B?" natively with Kuzu's
 * recursive SHORTEST path pattern, instead of the user expanding hop by hop.
 *
 * Two-step design (discovery then hydration), because Horkos edge tables have
 * HETEROGENEOUS property structs (some carry control_type etc.). An untyped
 * recursive rel forces Kuzu to unify every edge table's property struct into
 * one, so materializing the path (`RETURN p`) throws a STRUCT-cast Conversion
 * exception. We avoid that in two stages:
 *
 *   1. DISCOVERY — an inline-projected recursive rel
 *      `-[e* SHORTEST 1..MAX (r, n | {}, {n.<pk>})]-` that carries ONLY the
 *      projected node primary key, so nothing forces the struct unification.
 *      It returns the intermediate node ids/labels and the per-hop rel labels
 *      (NOT the full path). `nodes(e)` EXCLUDES the two bound endpoints; the
 *      full node chain is [A, ...intermediates, B]. Hop count = relLabels.len.
 *
 *   2. HYDRATION — once a path is known, a plain chained MATCH over the exact
 *      node chain, with every hop TYPED with its discovered rel label and every
 *      node pk-pinned via a bound param. It returns plain NODE / REL columns
 *      with full properties, which GraphResultExtractor already handles — so it
 *      feeds straight into addDataWithQueryResult like any other result. No
 *      RECURSIVE_REL flows through this feature any more.
 *
 * The pure query-building / result-shaping logic lives here so it can be
 * unit-tested without a DB, DOM or network — mirroring how NeighborsFetcher
 * isolates its query builders. The Vue side (ResultGraph) owns canvas merge,
 * highlight, focus, history and the outcome banner.
 *
 * Safety:
 *   - The endpoint primary keys (discovery) and every node pk (hydration) are
 *     always bound as $-params (never interpolated), so a pk value cannot
 *     inject Cypher — identical to how the server (Cypher.js) and WASM
 *     (KuzuWasm.query) prepare statements.
 *   - Label, primary-key-column and rel-type identifiers ARE interpolated
 *     (params can't stand in for identifiers in Cypher), so they are escaped
 *     with DataDefinitionLanguage._escapeName; hydration additionally validates
 *     the discovered labels against the caller-supplied schema table sets
 *     (belt-and-braces) before interpolation.
 *   - Both queries are plain read-only `MATCH ... RETURN ... LIMIT 1`, so they
 *     pass the read-only QueryValidator and are bounded by the existing
 *     per-query timeout and row cap.
 */

// Single-stage upper hop bound. A found path is BFS early-stopped (flat cost
// regardless of the bound); the no-path case is bounded by KUZU_QUERY_TIMEOUT.
// 12 is a generous ceiling for interactive connection discovery on this graph.
export const MAX_HOPS = 12;

// Lower bound of the recursive pattern. 1 = the two entities may be directly
// adjacent; we never look for a "zero-hop" path (that is the same-entity case,
// which callers guard before querying).
const MIN_HOPS = 1;

/**
 * Clamp a requested max-hop count to the supported range [MIN_HOPS, MAX_HOPS],
 * defaulting to MAX_HOPS for anything non-integer or non-positive. Pure and
 * total so the caller can trust the bound it feeds into a query is always sane.
 */
export function clampMaxHops(requested) {
  const n = Number(requested);
  if (!Number.isInteger(n) || n < MIN_HOPS) {
    return MAX_HOPS;
  }
  if (n > MAX_HOPS) {
    return MAX_HOPS;
  }
  return n;
}

/**
 * Unwrap a boxed Number/String primary-key value (Kuzu can hand back boxed
 * primitives) so the bound param is a plain JS primitive. Same helper shape as
 * NeighborsFetcher._unwrapPrimaryKeyValue.
 */
function unwrapPrimaryKeyValue(value) {
  if (value instanceof Number || value instanceof String) {
    return value.valueOf();
  }
  return value;
}

// The pk name appears once in a STRING-LITERAL position (the second argument
// of properties(), which Kuzu reads as a raw property-name string — backtick
// escaping is NOT stripped there, so an escaped name would look up a property
// literally named `pk`, which doesn't exist). That position therefore takes
// the RAW name, guarded strictly instead of escaped: only plain
// identifier-shaped names are allowed through.
const SAFE_PK_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Assert a primary-key column name is safe to interpolate into a Cypher
 * STRING-LITERAL position (no escaping mechanism applies there). The pk is
 * schema-sourced, so anything failing the plain-identifier pattern is
 * unexpected — throw rather than build a query with an unguarded string
 * interpolation; the caller routes the throw to the error banner.
 */
function assertSafePkName(pkName) {
  if (typeof pkName !== "string" || !SAFE_PK_NAME.test(pkName)) {
    throw new Error(`Unsupported primary-key column name: ${pkName}`);
  }
  return pkName;
}

/**
 * Build the parameterised DISCOVERY query and its params. The path is matched
 * UNDIRECTED (`-[...]-`) so the connection is found regardless of edge
 * orientation, and `LIMIT 1` returns a single representative shortest path.
 *
 * The inline recursive-rel projection `(r, n | {}, {n.<pk>})` carries only the
 * node primary key, sidestepping the heterogeneous-struct unification that a
 * bare `RETURN p` would trigger. It requires ONE pk column name valid for ALL
 * node tables — the caller asserts that uniformity before calling here.
 *
 * The pk name is interpolated in two different position classes:
 *   - IDENTIFIER positions (the `{n.<pk>}` projection, the WHERE clauses) are
 *     backtick-escaped via _escapeName as usual;
 *   - the STRING-LITERAL position (properties()'s second argument) takes the
 *     RAW name, guarded by assertSafePkName — Kuzu does not strip backtick
 *     escaping inside a string literal.
 *
 * Returns { query, params, maxHops } where the query text is stable for a
 * given (labelA, labelB, pk, maxHops) — the pk VALUES live only in params.
 *
 * @param {Object} args
 * @param {string} args.labelA     source node label (schema-validated)
 * @param {string} args.pkNameA    source node primary-key column
 * @param {*}      args.pkValueA   source node primary-key value
 * @param {string} args.labelB     target node label (schema-validated)
 * @param {string} args.pkNameB    target node primary-key column
 * @param {*}      args.pkValueB   target node primary-key value
 * @param {string} args.pkName     the uniform node primary-key column (projected)
 * @param {number} [args.maxHops]  requested upper hop bound (clamped)
 * @returns {{ query: string, params: Object, maxHops: number }}
 */
export function buildDiscoveryQuery({
  labelA,
  pkNameA,
  pkValueA,
  labelB,
  pkNameB,
  pkValueB,
  pkName,
  maxHops = MAX_HOPS,
}) {
  const escapedLabelA = DataDefinitionLanguage._escapeName(labelA);
  const escapedLabelB = DataDefinitionLanguage._escapeName(labelB);
  const escapedPkA = DataDefinitionLanguage._escapeName(pkNameA);
  const escapedPkB = DataDefinitionLanguage._escapeName(pkNameB);
  // Identifier position (projection) — escaped. String-literal position
  // (properties() argument) — raw, guarded. See assertSafePkName.
  const escapedPk = DataDefinitionLanguage._escapeName(pkName);
  const rawPk = assertSafePkName(pkName);
  const hops = clampMaxHops(maxHops);

  const query =
    `MATCH (a:${escapedLabelA})-[e* SHORTEST ${MIN_HOPS}..${hops} ` +
    `(r, n | {}, {n.${escapedPk}})]-(b:${escapedLabelB}) ` +
    `WHERE a.${escapedPkA} = $aid AND b.${escapedPkB} = $bid ` +
    `RETURN properties(nodes(e), '${rawPk}') AS nodeIds, ` +
    `properties(nodes(e), '_label') AS nodeLabels, ` +
    `properties(rels(e), '_label') AS relLabels LIMIT 1;`;

  const params = {
    aid: unwrapPrimaryKeyValue(pkValueA),
    bid: unwrapPrimaryKeyValue(pkValueB),
  };

  return { query, params, maxHops: hops };
}

/**
 * Shape a raw DISCOVERY response into the intermediate node ids/labels and the
 * per-hop rel labels.
 *
 * Distinguishes:
 *   - a valid response with a path row -> { found: true, hops, nodeIds,
 *     nodeLabels, relLabels }; nodeIds/nodeLabels are the INTERMEDIATE nodes
 *     only (nodes(e) excludes the two endpoints), relLabels has one entry per
 *     hop so relLabels.length is the hop count;
 *   - a valid response with NO path row -> { found: false };
 *   - a malformed row (missing/short arrays) -> { found: false } (never
 *     mistaken for a 0-hop "connection").
 *
 * @param {Object|null} response  raw query response ({ rows } shape)
 * @returns {{ found: boolean, hops: number, nodeIds: Array, nodeLabels: Array, relLabels: Array }}
 */
export function extractDiscoveryResult(response) {
  const notFound = { found: false, hops: 0, nodeIds: [], nodeLabels: [], relLabels: [] };
  const rows = response && Array.isArray(response.rows) ? response.rows : [];
  if (rows.length === 0) {
    return notFound;
  }
  const row = rows[0];
  const nodeIds = row && Array.isArray(row.nodeIds) ? row.nodeIds : null;
  const nodeLabels = row && Array.isArray(row.nodeLabels) ? row.nodeLabels : null;
  const relLabels = row && Array.isArray(row.relLabels) ? row.relLabels : null;
  // A genuine path has at least one rel (SHORTEST 1..N can't return fewer), and
  // the intermediate node arrays must agree in length (one label per id).
  if (!relLabels || relLabels.length === 0 || !nodeIds || !nodeLabels) {
    return notFound;
  }
  if (nodeIds.length !== nodeLabels.length) {
    return notFound;
  }
  // Intermediates sit BETWEEN the endpoints, so a k-hop path has k-1 of them.
  if (nodeIds.length !== relLabels.length - 1) {
    return notFound;
  }
  return {
    found: true,
    hops: relLabels.length,
    nodeIds,
    nodeLabels,
    relLabels,
  };
}

/**
 * Build the parameterised HYDRATION query and its params from an endpoint pair
 * plus the discovered intermediate node chain and rel labels.
 *
 * Produces ONE chained MATCH over the full node chain [A, ...intermediates, B],
 * each hop TYPED with its discovered rel label and UNDIRECTED (a parallel
 * same-type reverse edge is investigatively equivalent, so we deliberately do
 * NOT pin direction), each node pk-pinned via a bound param $pk0..$pkk. Returns
 * plain NODE / REL columns so GraphResultExtractor materializes them directly.
 *
 * Every interpolated node label and rel type is validated against the supplied
 * schema table-name sets and escaped (belt-and-braces) before it reaches the
 * query text; an unknown identifier throws (the caller surfaces the error
 * banner rather than guessing).
 *
 * @param {Object} args
 * @param {{label:string, pk:*}} args.a   first endpoint
 * @param {{label:string, pk:*}} args.b   second endpoint
 * @param {Array<*>} args.nodeIds         intermediate node pk values (in order)
 * @param {Array<string>} args.nodeLabels intermediate node labels (in order)
 * @param {Array<string>} args.relLabels  per-hop rel labels (length = hops)
 * @param {string} args.pkName            the uniform node primary-key column
 * @param {Set<string>} args.nodeLabelSet valid node table names (schema)
 * @param {Set<string>} args.relLabelSet  valid rel table names (schema)
 * @returns {{ query: string, params: Object }}
 */
export function buildHydrationQuery({
  a,
  b,
  nodeIds,
  nodeLabels,
  relLabels,
  pkName,
  nodeLabelSet,
  relLabelSet,
}) {
  // Full node chain: endpoint A, the intermediates, endpoint B.
  const chainLabels = [a.label, ...nodeLabels, b.label];
  const chainPks = [a.pk, ...nodeIds, b.pk];
  const hopLabels = relLabels;

  if (chainLabels.length !== hopLabels.length + 1) {
    throw new Error("Hydration chain length does not match hop count");
  }

  const escapedPk = DataDefinitionLanguage._escapeName(pkName);

  const validateNode = (label) => {
    if (!nodeLabelSet || !nodeLabelSet.has(label)) {
      throw new Error(`Unknown node label in path: ${label}`);
    }
    return DataDefinitionLanguage._escapeName(label);
  };
  const validateRel = (label) => {
    if (!relLabelSet || !relLabelSet.has(label)) {
      throw new Error(`Unknown rel label in path: ${label}`);
    }
    return DataDefinitionLanguage._escapeName(label);
  };

  const nodePatterns = chainLabels.map(
    (label, i) => `(n${i}:${validateNode(label)})`
  );

  // Interleave node and rel patterns: n0 -[r?]- n1 -[r?]- ... nk. Rel variable
  // names are r0..r(k-1) so they stay distinct RETURN columns.
  let pattern = nodePatterns[0];
  const returnCols = ["n0"];
  hopLabels.forEach((label, i) => {
    pattern += `-[r${i}:${validateRel(label)}]-${nodePatterns[i + 1]}`;
    returnCols.push(`r${i}`);
    returnCols.push(`n${i + 1}`);
  });

  const whereClauses = chainLabels.map((_, i) => `n${i}.${escapedPk} = $pk${i}`);

  const params = {};
  chainPks.forEach((pk, i) => {
    params[`pk${i}`] = unwrapPrimaryKeyValue(pk);
  });

  const query =
    `MATCH ${pattern} WHERE ${whereClauses.join(" AND ")} ` +
    `RETURN ${returnCols.join(", ")} LIMIT 1;`;

  return { query, params };
}

class PathFinder {
  /**
   * Run a query through the same dual path NeighborsFetcher._runQuery uses:
   * KuzuWasm.query in WASM mode, POST /api/cypher otherwise. Both prepare the
   * statement and bind params, so the pk VALUES are never interpolated in
   * either mode. Unlike NeighborsFetcher._runQuery this RETHROWS on failure so
   * the caller can tell a query/network ERROR apart from a genuine no-path
   * result (a DB error must never masquerade as "no connection").
   */
  async _runQuery(query, params, isWasm) {
    if (isWasm) {
      return await Kuzu.query(query, params);
    }
    const response = await Axios.post("api/cypher", {
      query,
      params,
      updateHistory: false,
    });
    return response.data;
  }

  /**
   * Find a shortest path between two entities. Runs DISCOVERY, and — only when a
   * path is found — HYDRATION, returning the plain NODE/REL rows for the canvas.
   *
   * Returns:
   *   - found:   { found: true, hops, maxHops, row, dataTypes }
   *   - no-path: { found: false, hops: 0, maxHops }
   * where row/dataTypes are the hydration row and its column-type map, ready to
   * feed straight into addDataWithQueryResult.
   *
   * A discovery that finds a path but a hydration that then returns 0 rows is
   * NOT a no-path result — it is unexpected, so it throws (the caller surfaces
   * the error banner rather than "no connection"). Query/network failures also
   * PROPAGATE so the caller distinguishes error from no-path.
   *
   * @param {Object} args
   * @param {string} args.labelA / args.pkNameA / args.pkValueA  source endpoint
   * @param {string} args.labelB / args.pkNameB / args.pkValueB  target endpoint
   * @param {string} args.pkName            uniform node primary-key column
   * @param {Set<string>} args.nodeLabelSet valid node table names (schema)
   * @param {Set<string>} args.relLabelSet  valid rel table names (schema)
   * @param {number} [args.maxHops]         requested upper hop bound (clamped)
   * @param {boolean} [args.isWasm=false]   use the WASM query path
   */
  async findShortestPath(args) {
    const isWasm = Boolean(args.isWasm);
    const discovery = buildDiscoveryQuery(args);
    const discoveryResponse = await this._runQuery(
      discovery.query,
      discovery.params,
      isWasm
    );
    const found = extractDiscoveryResult(discoveryResponse);
    if (!found.found) {
      return { found: false, hops: 0, maxHops: discovery.maxHops };
    }

    const hydration = buildHydrationQuery({
      a: { label: args.labelA, pk: args.pkValueA },
      b: { label: args.labelB, pk: args.pkValueB },
      nodeIds: found.nodeIds,
      nodeLabels: found.nodeLabels,
      relLabels: found.relLabels,
      pkName: args.pkName,
      nodeLabelSet: args.nodeLabelSet,
      relLabelSet: args.relLabelSet,
    });
    const hydrationResponse = await this._runQuery(
      hydration.query,
      hydration.params,
      isWasm
    );
    const rows =
      hydrationResponse && Array.isArray(hydrationResponse.rows)
        ? hydrationResponse.rows
        : [];
    if (rows.length === 0) {
      // Discovery said a path exists but hydration produced nothing — an
      // internal inconsistency, never a "no connection". Let the caller show
      // the error banner.
      throw new Error("Connection path could not be hydrated");
    }
    return {
      found: true,
      hops: found.hops,
      maxHops: discovery.maxHops,
      row: rows[0],
      dataTypes: (hydrationResponse && hydrationResponse.dataTypes) || {},
    };
  }
}

export default new PathFinder();
