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
    if (!inbound) {
      return outbound;
    }
    if (outbound) {
      inbound.rows.push(...outbound.rows);
    }
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
