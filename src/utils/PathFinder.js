import Axios from "@/utils/AxiosWrapper";
import DataDefinitionLanguage from "./DataDefinitionLanguage";
import Kuzu from "./KuzuWasm";

/**
 * PathFinder — shortest-path discovery between two entities.
 *
 * Answers "how is entity A connected to entity B?" natively with Kuzu's
 * recursive SHORTEST path pattern, instead of the user expanding hop by hop.
 * The result is a RECURSIVE_REL row (`_nodes` / `_rels`) that flows through the
 * existing GraphResultExtractor -> addDataWithQueryResult canvas pipeline.
 *
 * The pure query-building / hop-clamping / result-shaping logic lives here so
 * it can be unit-tested without a DB, DOM or network — mirroring how
 * NeighborsFetcher isolates its query builders. The Vue side (ResultGraph) owns
 * canvas merge, highlight, focus, history and toasts.
 *
 * Safety:
 *   - The two primary keys are always bound as $aid / $bid parameters (never
 *     interpolated), so a pk value cannot inject Cypher — identical to how the
 *     server (Cypher.js) and WASM (KuzuWasm.query) prepare statements.
 *   - Label and primary-key-column identifiers ARE interpolated (params can't
 *     stand in for identifiers in Cypher), so they are escaped with the same
 *     DataDefinitionLanguage._escapeName helper NeighborsFetcher uses; callers
 *     are expected to pass schema-validated labels/columns.
 *   - The query is a plain read-only `MATCH ... RETURN ... LIMIT 1`, so it
 *     passes the read-only QueryValidator and is bounded by the existing
 *     per-query timeout and row cap.
 */

// Default upper hop bound for a first search. Deliberately conservative: most
// interesting connections in this domain are within a handful of hops, and a
// wide bound on a dense graph is expensive.
export const DEFAULT_MAX_HOPS = 4;

// Hard ceiling. "Search deeper" re-runs at this bound; there is no going past
// it (the recursive traversal cost climbs steeply and the timeout/row cap are
// the only other guardrails).
export const HARD_MAX_HOPS = 6;

// Lower bound of the recursive pattern. 1 = the two entities may be directly
// adjacent; we never look for a "zero-hop" path (that is the same-entity case,
// which callers guard before querying).
const MIN_HOPS = 1;

/**
 * Clamp a requested max-hop count to the supported range [MIN_HOPS,
 * HARD_MAX_HOPS], defaulting to DEFAULT_MAX_HOPS for anything non-integer or
 * non-positive. Pure and total so the caller can trust the bound it feeds into
 * a query is always sane.
 */
export function clampMaxHops(requested) {
  const n = Number(requested);
  if (!Number.isInteger(n) || n < MIN_HOPS) {
    return DEFAULT_MAX_HOPS;
  }
  if (n > HARD_MAX_HOPS) {
    return HARD_MAX_HOPS;
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

/**
 * Build the parameterised shortest-path query and its params. The path is
 * matched UNDIRECTED (`-[...]-`) so the connection is found regardless of edge
 * orientation, and `LIMIT 1` returns a single representative shortest path.
 *
 * Returns { query, params } where query text is stable for a given
 * (labelA, labelB, pkNames, maxHops) — the pk VALUES live only in params.
 *
 * @param {Object} args
 * @param {string} args.labelA     source node label (schema-validated)
 * @param {string} args.pkNameA    source node primary-key column
 * @param {*}      args.pkValueA    source node primary-key value
 * @param {string} args.labelB     target node label (schema-validated)
 * @param {string} args.pkNameB    target node primary-key column
 * @param {*}      args.pkValueB    target node primary-key value
 * @param {number} [args.maxHops]  requested upper hop bound (clamped)
 * @returns {{ query: string, params: Object, maxHops: number }}
 */
export function buildShortestPathQuery({
  labelA,
  pkNameA,
  pkValueA,
  labelB,
  pkNameB,
  pkValueB,
  maxHops = DEFAULT_MAX_HOPS,
}) {
  const escapedLabelA = DataDefinitionLanguage._escapeName(labelA);
  const escapedLabelB = DataDefinitionLanguage._escapeName(labelB);
  const escapedPkA = DataDefinitionLanguage._escapeName(pkNameA);
  const escapedPkB = DataDefinitionLanguage._escapeName(pkNameB);
  const hops = clampMaxHops(maxHops);

  const query =
    `MATCH p = (a:${escapedLabelA})-[* SHORTEST ${MIN_HOPS}..${hops}]-(b:${escapedLabelB}) ` +
    `WHERE a.${escapedPkA} = $aid AND b.${escapedPkB} = $bid RETURN p LIMIT 1;`;

  const params = {
    aid: unwrapPrimaryKeyValue(pkValueA),
    bid: unwrapPrimaryKeyValue(pkValueB),
  };

  return { query, params, maxHops: hops };
}

/**
 * Given a raw /api/cypher (or KuzuWasm.query) response, extract the single
 * recursive-path row's { _nodes, _rels } and count the hops.
 *
 * Distinguishes three outcomes for the caller:
 *   - a valid response with a path        -> { found: true, hops, row }
 *   - a valid response with NO path row   -> { found: false }
 *   - a null/undefined response (a query  -> throws is NOT this function's job;
 *     the caller decides error vs no-path from whether the fetch threw)
 *
 * The path column is `p` (the RETURN alias). Hop count is the number of
 * relationships in the recursive rel (`_rels.length`), which is what "connected
 * in N steps" means to a user.
 *
 * The returned `dataTypes` is the raw response's column-type map (passed
 * through so the caller can feed { rows:[row], dataTypes } straight into
 * GraphResultExtractor, which keys on dataTypes[column] === 'RECURSIVE_REL').
 *
 * @param {Object|null} response  raw query response ({ rows, dataTypes } shape)
 * @returns {{ found: boolean, hops: number, row: Object|null, dataTypes: Object }}
 */
export function extractPathResult(response) {
  const rows = response && Array.isArray(response.rows) ? response.rows : [];
  const dataTypes = (response && response.dataTypes) || {};
  if (rows.length === 0) {
    return { found: false, hops: 0, row: null, dataTypes };
  }
  const row = rows[0];
  const path = row && row.p;
  const rels = path && Array.isArray(path._rels) ? path._rels : null;
  const nodes = path && Array.isArray(path._nodes) ? path._nodes : null;
  // A genuine path has at least the two endpoint nodes and one rel (SHORTEST
  // 1..N can't return less); guard against an empty or malformed recursive-rel
  // struct being mistaken for a 0-hop "connection".
  if (!nodes || nodes.length === 0 || !rels || rels.length === 0) {
    return { found: false, hops: 0, row: null, dataTypes };
  }
  return { found: true, hops: rels.length, row, dataTypes };
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
   * Find a shortest path between two entities. Builds the parameterised query,
   * runs it in the appropriate mode, and shapes the result.
   *
   * Returns { found, hops, row, maxHops }. Query/network failures PROPAGATE
   * (are not swallowed) so the caller distinguishes error from no-path.
   *
   * @param {Object} args  the buildShortestPathQuery args, plus:
   * @param {boolean} [args.isWasm=false]  use the WASM query path
   */
  async findShortestPath(args) {
    const { query, params, maxHops } = buildShortestPathQuery(args);
    const response = await this._runQuery(query, params, Boolean(args.isWasm));
    const result = extractPathResult(response);
    return { ...result, maxHops };
  }
}

export default new PathFinder();
