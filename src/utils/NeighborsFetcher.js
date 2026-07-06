import Axios from "@/utils/AxiosWrapper";
import DataDefinitionLanguage from "./DataDefinitionLanguage";
import Kuzu from "./KuzuWasm";

// Max number of source pks bound into a single batched neighbour-count query.
//
// Each batched query returns ONE row per (source pk, neighbour node) pair for a
// single rel type, and the server hard-caps every result to
// KUZU_QUERY_SIZE_LIMIT (default 10000 rows) and SILENTLY truncates the rest.
// So a chunk's row count is `chunkSize x (max neighbours of one rel type per
// source node)`. Chunking the pk list keeps each request well under the cap so
// a dense group can't be truncated and undercounted.
//
// 25 leaves generous headroom: a chunk only risks the 10000-row cap if a single
// source node has more than ~400 neighbours of ONE concrete rel type (10000/25),
// far beyond anything in this domain (a company's directors, a person's
// directorships, an address's residents). Requests now scale with
// (ceil(N/25) x rel types) instead of rel types alone, but for a typical canvas
// of a few dozen leaf nodes that is one or two chunks. Results merge safely
// because they are keyed by source pk (see fetchNeighborNodesBatched).
//
// Assumes the default KUZU_QUERY_SIZE_LIMIT of 10000; the server-only limit is
// not cleanly readable from this client-side fetcher, so an operator who sets
// that env var substantially lower would need a correspondingly smaller chunk
// size to keep chunks under the cap. Undercounting only degrades an advisory
// badge, so this is an accepted LOW-severity tradeoff.
const NEIGHBOR_COUNT_PK_CHUNK_SIZE = 25;

// Kuzu cannot bind a wildcard relationship variable across edge tables whose
// same-named STRUCT properties differ in shape (e.g. the Ownership vs
// Influence `sources` structs), so every fetch here runs one query per
// concrete relationship type and merges the rows client-side.
class NeighborsFetcher {
  async _runQuery(query, params, isWasm) {
    try {
      if (isWasm) {
        return await Kuzu.query(query, params);
      }
      const response = await Axios.post("api/cypher", { query, params });
      return response.data;
    } catch (err) {
      console.error("Neighbor query failed", err);
      return null;
    }
  }

  // Assumes every result projects the same column set (all current callers
  // return exactly `r, dst` or `r`), so the first result's dataTypes apply.
  _mergeResults(results, sizeLimit) {
    const valid = results.filter(result => result && result.rows);
    if (valid.length === 0) {
      return null;
    }
    const merged = { rows: [], dataTypes: valid[0].dataTypes };
    valid.forEach(result => merged.rows.push(...result.rows));
    if (typeof sizeLimit === "number") {
      merged.rows = merged.rows.slice(0, sizeLimit);
    }
    return merged;
  }

  _unwrapPrimaryKeyValue(value) {
    if (value instanceof Number || value instanceof String) {
      return value.valueOf();
    }
    return value;
  }

  async fetchNeighbors({
    tableName,
    primaryKeyName,
    primaryKeyValue,
    relTables,
    sizeLimit = 100,
    isWasm = false,
  }) {
    if (!Array.isArray(relTables)) {
      throw new Error("fetchNeighbors requires relTables (schema.relTables)");
    }
    // sizeLimit is interpolated into the query text, so it must be a number
    sizeLimit = Number(sizeLimit);
    if (!Number.isInteger(sizeLimit) || sizeLimit <= 0) {
      throw new Error("fetchNeighbors requires a positive integer sizeLimit");
    }
    const escapedTable = DataDefinitionLanguage._escapeName(tableName);
    const escapedPk = DataDefinitionLanguage._escapeName(primaryKeyName);
    const params = { pk: this._unwrapPrimaryKeyValue(primaryKeyValue) };

    // Connectivity is matched on the raw table name; only escaped names are
    // interpolated into queries.
    const inboundQueries = relTables
      .filter(t => (t.connectivity || []).some(c => c.dst === tableName))
      .map(t =>
        `MATCH (dst) -[r:${DataDefinitionLanguage._escapeName(t.name)}]-> (src:${escapedTable}) WHERE src.${escapedPk} = $pk RETURN r, dst LIMIT ${sizeLimit};`
      );
    const outboundQueries = relTables
      .filter(t => (t.connectivity || []).some(c => c.src === tableName))
      .map(t =>
        `MATCH (src:${escapedTable}) -[r:${DataDefinitionLanguage._escapeName(t.name)}]-> (dst) WHERE src.${escapedPk} = $pk RETURN r, dst LIMIT ${sizeLimit};`
      );

    const [inboundResults, outboundResults] = await Promise.all([
      Promise.all(inboundQueries.map(query => this._runQuery(query, params, isWasm))),
      Promise.all(outboundQueries.map(query => this._runQuery(query, params, isWasm))),
    ]);

    // Cap each direction at sizeLimit so the per-type LIMITs don't multiply
    // the per-direction total.
    const inbound = this._mergeResults(inboundResults, sizeLimit);
    const outbound = this._mergeResults(outboundResults, sizeLimit);
    // A direction whose merged rows fill the whole window may have had edges
    // cut off by the per-type LIMITs or the merge cap, so the returned rows
    // cannot be treated as the node's complete edge set. Surfaced as
    // `truncated` because callers that derive ENTITY counts from these EDGE
    // rows can collapse below any entity-level cap even when edges were
    // dropped — raw row counts are the only honest truncation signal.
    const truncated =
      Boolean(inbound && inbound.rows.length >= sizeLimit) ||
      Boolean(outbound && outbound.rows.length >= sizeLimit);
    if (!inbound) {
      if (outbound) {
        outbound.truncated = truncated;
      }
      return outbound;
    }
    if (outbound) {
      inbound.rows.push(...outbound.rows);
    }
    inbound.truncated = truncated;
    return inbound;
  }

  // Build one count-query per relationship type for a batch of source nodes
  // that all share a single node table + primary-key column. Each query takes
  // the whole pk list via `UNWIND $pks AS pk` and returns one row per
  // (source pk, neighbour node) pair as `pk, dst`.
  //
  // We project the neighbour NODE (`dst`) — never the relationship `r` or its
  // `sources` STRUCT — so the divergent-struct binding problem never arises: a
  // single concrete rel type has one shape, and we bind it anonymously. This is
  // what lets us count all N nodes in M requests (one per rel type) instead of
  // N x M. The neighbour node is needed (rather than a raw `count(*)`) so the
  // caller can encode each neighbour's internal id and apply the same
  // "new neighbours only" filter the per-node path uses.
  _buildNeighborCountQueries({ tableName, primaryKeyName, relTables }) {
    if (!Array.isArray(relTables)) {
      throw new Error("_buildNeighborCountQueries requires relTables (schema.relTables)");
    }
    const escapedTable = DataDefinitionLanguage._escapeName(tableName);
    const escapedPk = DataDefinitionLanguage._escapeName(primaryKeyName);

    // Connectivity is matched on the raw table name; only escaped names are
    // interpolated into queries.
    const inbound = relTables
      .filter(t => (t.connectivity || []).some(c => c.dst === tableName))
      .map(t =>
        `UNWIND $pks AS pk MATCH (dst) -[:${DataDefinitionLanguage._escapeName(t.name)}]-> (src:${escapedTable}) WHERE src.${escapedPk} = pk RETURN src.${escapedPk} AS pk, dst;`
      );
    const outbound = relTables
      .filter(t => (t.connectivity || []).some(c => c.src === tableName))
      .map(t =>
        `UNWIND $pks AS pk MATCH (src:${escapedTable}) -[:${DataDefinitionLanguage._escapeName(t.name)}]-> (dst) WHERE src.${escapedPk} = pk RETURN src.${escapedPk} AS pk, dst;`
      );

    return [...inbound, ...outbound];
  }

  // Batched neighbour lookup for a set of source nodes that all live in one
  // node table. Returns a map of `primaryKeyValue -> [neighbourNode, ...]`
  // (every distinct neighbour node found across all rel types for that source),
  // so the caller can encode ids, drop neighbours already on the canvas, and
  // count. Requests scale with the number of rel types, NOT the number of
  // source nodes.
  async fetchNeighborNodesBatched({
    tableName,
    primaryKeyName,
    primaryKeyValues,
    relTables,
    isWasm = false,
  }) {
    if (!Array.isArray(primaryKeyValues)) {
      throw new Error("fetchNeighborNodesBatched requires primaryKeyValues array");
    }
    const neighborsByPk = {};
    if (primaryKeyValues.length === 0) {
      return neighborsByPk;
    }

    const queries = this._buildNeighborCountQueries({
      tableName,
      primaryKeyName,
      relTables,
    });
    const unwrappedPks = primaryKeyValues.map(v => this._unwrapPrimaryKeyValue(v));

    // Split the pk list into chunks so each batched request stays well under the
    // server's silent KUZU_QUERY_SIZE_LIMIT row cap (see the constant above).
    // The query text is identical across chunks — only the bound $pks param
    // varies — so pk VALUES are never interpolated, preserving injection safety.
    // Results merge into a single per-pk map, which is order-independent and
    // free of double-counting because rows are keyed by their source pk.
    const chunks = [];
    for (let i = 0; i < unwrappedPks.length; i += NEIGHBOR_COUNT_PK_CHUNK_SIZE) {
      chunks.push(unwrappedPks.slice(i, i + NEIGHBOR_COUNT_PK_CHUNK_SIZE));
    }

    const results = await Promise.all(
      chunks.flatMap(chunk =>
        queries.map(query => this._runQuery(query, { pks: chunk }, isWasm))
      )
    );

    results.forEach(result => {
      if (!result || !result.rows) {
        return;
      }
      result.rows.forEach(row => {
        const pk = row.pk;
        const neighbor = row.dst;
        if (pk === undefined || pk === null || !neighbor || !neighbor._id) {
          return;
        }
        const key = String(pk);
        if (!neighborsByPk[key]) {
          neighborsByPk[key] = [];
        }
        neighborsByPk[key].push(neighbor);
      });
    });

    return neighborsByPk;
  }

  // Build one query per relationship type that can connect the focus node's
  // table to `otherTable`, matching in EITHER direction. The focus node is
  // pinned by its single primary key ($pk1); the other endpoints are bound as a
  // list ($pks2) via UNWIND so all edges between the focus node and every canvas
  // node of one table are fetched in a single request per rel type. Each query
  // projects only the relationship `r` — a single concrete type has one property
  // shape, so the divergent-STRUCT binding hazard never arises.
  //
  // Pure over its inputs (no I/O), so it is unit-testable without a DB.
  _buildRelsBetweenNodeAndPksQueries({
    focusTable,
    focusPkName,
    otherTable,
    otherPkName,
    relTables,
  }) {
    if (!Array.isArray(relTables)) {
      throw new Error("_buildRelsBetweenNodeAndPksQueries requires relTables (schema.relTables)");
    }
    const escapedFocus = DataDefinitionLanguage._escapeName(focusTable);
    const escapedOther = DataDefinitionLanguage._escapeName(otherTable);
    const escapedFocusPk = DataDefinitionLanguage._escapeName(focusPkName);
    const escapedOtherPk = DataDefinitionLanguage._escapeName(otherPkName);

    // Connectivity is matched on the raw table names; only escaped names are
    // interpolated into queries. A rel type is relevant if it connects the two
    // tables in either direction.
    return relTables
      .filter(t =>
        (t.connectivity || []).some(
          c =>
            (c.src === focusTable && c.dst === otherTable) ||
            (c.src === otherTable && c.dst === focusTable)
        )
      )
      .map(t =>
        `UNWIND $pks2 AS pk2 MATCH (a:${escapedFocus}) -[r:${DataDefinitionLanguage._escapeName(t.name)}]- (b:${escapedOther}) WHERE a.${escapedFocusPk} = $pk1 AND b.${escapedOtherPk} = pk2 RETURN r;`
      );
  }

  // All edges between one focus node and a set of other nodes already on the
  // canvas, grouped by the other nodes' table. `others` is an array of
  // { table, primaryKeyName, primaryKeyValues } — one entry per distinct
  // (table, pk-column) among the canvas nodes. Returns a merged result of the
  // shape `{ rows: [{ r }], dataTypes }` (or null if nothing connects), matching
  // fetchRelsBetween so callers can reuse the same row-handling path.
  //
  // Requests scale with (rel types per table pairing) x (distinct canvas
  // tables), NOT with the number of canvas nodes.
  //
  // Unlike fetchNeighborNodesBatched, $pks2 is deliberately NOT chunked: every
  // returned row is an edge incident to the ONE focus node, so a query's row
  // count is bounded by the focus node's degree for that single rel type — not
  // by |pks2|. The KUZU_QUERY_SIZE_LIMIT truncation hazard that forced chunking
  // there (rows ~ chunkSize x per-source degree) therefore doesn't apply here.
  async fetchRelsBetweenNodeAndMany({
    focusTable,
    focusPkName,
    focusPkValue,
    others,
    relTables,
    isWasm = false,
  }) {
    if (!Array.isArray(others)) {
      throw new Error("fetchRelsBetweenNodeAndMany requires an others array");
    }
    const pk1 = this._unwrapPrimaryKeyValue(focusPkValue);
    const requests = [];
    others.forEach(other => {
      const values = (other.primaryKeyValues || [])
        .map(v => this._unwrapPrimaryKeyValue(v))
        .filter(v => v !== undefined && v !== null);
      if (values.length === 0) {
        return;
      }
      const queries = this._buildRelsBetweenNodeAndPksQueries({
        focusTable,
        focusPkName,
        otherTable: other.table,
        otherPkName: other.primaryKeyName,
        relTables,
      });
      queries.forEach(query => {
        requests.push(this._runQuery(query, { pk1, pks2: values }, isWasm));
      });
    });

    if (requests.length === 0) {
      return null;
    }
    const results = await Promise.all(requests);
    return this._mergeResults(results);
  }

  // All edges between two specific nodes, in either direction. Undirected
  // per-type matches are safe: a single bound type has one property shape.
  async fetchRelsBetween({
    tableA,
    primaryKeyNameA,
    primaryKeyValueA,
    tableB,
    primaryKeyNameB,
    primaryKeyValueB,
    relTables,
    isWasm = false,
  }) {
    if (!Array.isArray(relTables)) {
      throw new Error("fetchRelsBetween requires relTables (schema.relTables)");
    }
    const escapedA = DataDefinitionLanguage._escapeName(tableA);
    const escapedB = DataDefinitionLanguage._escapeName(tableB);
    const escapedPkA = DataDefinitionLanguage._escapeName(primaryKeyNameA);
    const escapedPkB = DataDefinitionLanguage._escapeName(primaryKeyNameB);
    const params = {
      pk1: this._unwrapPrimaryKeyValue(primaryKeyValueA),
      pk2: this._unwrapPrimaryKeyValue(primaryKeyValueB),
    };
    const queries = relTables
      .filter(t =>
        (t.connectivity || []).some(
          c =>
            (c.src === tableA && c.dst === tableB) ||
            (c.src === tableB && c.dst === tableA)
        )
      )
      .map(t =>
        `MATCH (a:${escapedA}) -[r:${DataDefinitionLanguage._escapeName(t.name)}]- (b:${escapedB}) WHERE a.${escapedPkA} = $pk1 AND b.${escapedPkB} = $pk2 RETURN r;`
      );

    const results = await Promise.all(
      queries.map(query => this._runQuery(query, params, isWasm))
    );
    return this._mergeResults(results);
  }
}

export default new NeighborsFetcher();
