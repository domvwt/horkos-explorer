import Axios from "@/utils/AxiosWrapper";
import DataDefinitionLanguage from "./DataDefinitionLanguage";

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

// Row count at (or above) which a batched neighbour query is ASSUMED to have hit
// the server's silent KUZU_QUERY_SIZE_LIMIT and dropped rows. The exact limit is
// a server-only env var not cleanly readable from this client, so we use its
// documented default (10000). `fetchNeighborsBatched` also projects `dst`, so a
// dense chunk can approach the cap; a chunk returning >= this many rows flags the
// merged result `truncated` (the batched analogue of the per-direction
// `rows.length >= sizeLimit` check in `fetchNeighbors`). An operator who sets
// KUZU_QUERY_SIZE_LIMIT lower should lower NEIGHBOR_COUNT_PK_CHUNK_SIZE to match.
const NEIGHBOR_BATCH_ROW_CAP = 10000;

// Kuzu cannot bind a wildcard relationship variable across edge tables whose
// same-named STRUCT properties differ in shape (e.g. the Ownership vs
// Influence `sources` structs), so every fetch here runs one query per
// concrete relationship type and merges the rows client-side.
class NeighborsFetcher {
  // A failed sub-query returns this sentinel instead of a bare `null`, so a
  // transport failure (load-shed 503, rate-limit 429, timeout 408, bad query
  // 400, or a network error) is DISTINGUISHABLE from a query that legitimately
  // matched zero rows. The sentinel has no `.rows`, so every existing
  // row-merging path (`result && result.rows` / `!result || !result.rows`)
  // still skips it — but `_mergeResults` and the callers can now count it and
  // flag the merged result `incomplete`. Without this, a shed sub-query looks
  // identical to "this node has no neighbours", and the caller silently
  // presents a partial result as complete.
  _isFailure(result) {
    return Boolean(result && result.__failed);
  }

  async _runQuery(query, params) {
    try {
      const response = await Axios.post("api/cypher", { query, params });
      return response.data;
    } catch (err) {
      console.error("Neighbor query failed", err);
      // err.response.status is present for an HTTP error (503/429/408/400);
      // absent for a network/transport error (err.response is undefined).
      return { __failed: true, status: (err && err.response && err.response.status) || null };
    }
  }

  // Assumes every result projects the same column set (all current callers
  // return exactly `r, dst`, `pk, r, dst`, or `r`), so the first result's
  // dataTypes apply.
  //
  // `incomplete` is computed from the RAW results array (before the null/
  // sentinel filter) so a failed sub-query is never silently dropped: if ANY
  // constituent query failed, the merged result carries `incomplete: true`.
  // When every sub-query failed there are no rows to key dataTypes off, so we
  // still return a result object (empty rows, `incomplete: true`) rather than
  // `null` — otherwise the honesty signal would be lost on a full shed. A
  // genuinely empty (all-succeeded, zero-row) merge still returns `null` for
  // backward compatibility.
  _mergeResults(results, sizeLimit) {
    const incomplete = results.some(result => this._isFailure(result));
    const valid = results.filter(result => result && result.rows);
    if (valid.length === 0) {
      return incomplete ? { rows: [], dataTypes: [], incomplete: true } : null;
    }
    const merged = { rows: [], dataTypes: valid[0].dataTypes };
    valid.forEach(result => merged.rows.push(...result.rows));
    if (typeof sizeLimit === "number") {
      merged.rows = merged.rows.slice(0, sizeLimit);
    }
    if (incomplete) {
      merged.incomplete = true;
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
      Promise.all(inboundQueries.map(query => this._runQuery(query, params))),
      Promise.all(outboundQueries.map(query => this._runQuery(query, params))),
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
    // If EITHER direction had a failed sub-query, the returned rows are not the
    // node's complete neighbour set. Surface it so callers can distinguish
    // "server was busy" from "this node has no neighbours" instead of silently
    // presenting a partial expansion as complete.
    const incomplete =
      Boolean(inbound && inbound.incomplete) ||
      Boolean(outbound && outbound.incomplete);
    if (!inbound) {
      if (outbound) {
        outbound.truncated = truncated;
        if (incomplete) {
          outbound.incomplete = true;
        }
      }
      return outbound;
    }
    if (outbound) {
      inbound.rows.push(...outbound.rows);
    }
    inbound.truncated = truncated;
    if (incomplete) {
      inbound.incomplete = true;
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
        queries.map(query => this._runQuery(query, { pks: chunk }))
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

  // Build one query per relationship type per direction that projects BOTH the
  // edge `r` AND the neighbour node `dst` — the batched analogue of the
  // per-node `fetchNeighbors` queries. `src.pk` is projected so the caller can
  // re-associate each neighbour/edge with the source node that introduced it
  // (needed for `nodeIntroducedBy` provenance, per-source `expansions` undo
  // entries, and the batch-expand history entry). Each query binds a single
  // concrete rel type, so the divergent-STRUCT wildcard-binding hazard never
  // arises. Pure over its inputs (no I/O), so it is unit-testable without a DB.
  _buildNeighborQueries({ tableName, primaryKeyName, relTables }) {
    if (!Array.isArray(relTables)) {
      throw new Error("_buildNeighborQueries requires relTables (schema.relTables)");
    }
    const escapedTable = DataDefinitionLanguage._escapeName(tableName);
    const escapedPk = DataDefinitionLanguage._escapeName(primaryKeyName);

    // Connectivity is matched on the raw table name; only escaped names are
    // interpolated into queries.
    const inbound = relTables
      .filter(t => (t.connectivity || []).some(c => c.dst === tableName))
      .map(t =>
        `UNWIND $pks AS pk MATCH (dst) -[r:${DataDefinitionLanguage._escapeName(t.name)}]-> (src:${escapedTable}) WHERE src.${escapedPk} = pk RETURN src.${escapedPk} AS pk, r, dst;`
      );
    const outbound = relTables
      .filter(t => (t.connectivity || []).some(c => c.src === tableName))
      .map(t =>
        `UNWIND $pks AS pk MATCH (src:${escapedTable}) -[r:${DataDefinitionLanguage._escapeName(t.name)}]-> (dst) WHERE src.${escapedPk} = pk RETURN src.${escapedPk} AS pk, r, dst;`
      );

    return [...inbound, ...outbound];
  }

  // Batched neighbour expansion for a set of source nodes that all live in one
  // node table. Runs the `UNWIND $pks` queries from `_buildNeighborQueries`
  // (one per rel type per direction, chunked at NEIGHBOR_COUNT_PK_CHUNK_SIZE)
  // and merges them into a SINGLE `{ rows, dataTypes, incomplete, truncated }`
  // result the caller can feed straight into the same `addDataWithQueryResult`
  // path the per-node expand uses — each row is `{ pk, r, dst }`, so the graph
  // extractor draws both the edge and the neighbour node.
  //
  // Request count scales with (rel types x directions x chunks), NOT with the
  // number of source nodes, so a large multi-node expand can no longer trip the
  // server's in-flight-query load-shed guard.
  //
  // - `incomplete` is true if ANY constituent sub-query failed (a shed/timeout/
  //   error), so the caller can bail all-or-nothing before touching the canvas.
  // - `truncated` is true if any chunk hit NEIGHBOR_BATCH_ROW_CAP (the server
  //   silently capped that chunk). There is deliberately NO per-source LIMIT: an
  //   UNWIND query can't cheaply apply one, and the caller pre-filters
  //   high-degree ("profligate") sources before calling, so per-source fan-out
  //   is already bounded.
  async fetchNeighborsBatched({
    tableName,
    primaryKeyName,
    primaryKeyValues,
    relTables,
  }) {
    if (!Array.isArray(primaryKeyValues)) {
      throw new Error("fetchNeighborsBatched requires primaryKeyValues array");
    }
    if (primaryKeyValues.length === 0) {
      return { rows: [], dataTypes: [], incomplete: false, truncated: false };
    }

    const queries = this._buildNeighborQueries({
      tableName,
      primaryKeyName,
      relTables,
    });
    const unwrappedPks = primaryKeyValues.map(v => this._unwrapPrimaryKeyValue(v));

    // Chunk the pk list so each request stays under the server's silent row cap.
    // Query text is identical across chunks — only the bound $pks param varies —
    // so pk VALUES are never interpolated, preserving injection safety.
    const chunks = [];
    for (let i = 0; i < unwrappedPks.length; i += NEIGHBOR_COUNT_PK_CHUNK_SIZE) {
      chunks.push(unwrappedPks.slice(i, i + NEIGHBOR_COUNT_PK_CHUNK_SIZE));
    }

    const results = await Promise.all(
      chunks.flatMap(chunk =>
        queries.map(query => this._runQuery(query, { pks: chunk }))
      )
    );

    // A chunk that returned at least the cap is assumed to have been truncated
    // by the server. Checked on the raw results (before _mergeResults) alongside
    // the incomplete flag it computes.
    const truncated = results.some(
      result => result && result.rows && result.rows.length >= NEIGHBOR_BATCH_ROW_CAP
    );

    // No sizeLimit: per-source fan-out is bounded by the caller's profligate
    // pre-filter, so a global slice would arbitrarily drop some sources' edges.
    const merged = this._mergeResults(results);
    if (!merged) {
      // All sub-queries succeeded and matched zero rows.
      return { rows: [], dataTypes: [], incomplete: false, truncated: false };
    }
    return {
      rows: merged.rows,
      dataTypes: merged.dataTypes,
      incomplete: Boolean(merged.incomplete),
      truncated,
    };
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
        requests.push(this._runQuery(query, { pk1, pks2: values }));
      });
    });

    if (requests.length === 0) {
      return null;
    }
    const results = await Promise.all(requests);
    return this._mergeResults(results);
  }

  // Build one query per relationship type that can connect `tableA` to
  // `tableB`, matching in EITHER direction. BOTH endpoint sets are bound as
  // lists ($pksA / $pksB) via nested UNWIND so every edge whose endpoints both
  // fall inside the two pk lists is fetched in a single request per rel type.
  // Each query projects only the relationship `r` — a single concrete type has
  // one property shape, so the divergent-STRUCT binding hazard never arises.
  //
  // Pure over its inputs (no I/O), so it is unit-testable without a DB.
  _buildRelsAmongPkListsQueries({
    tableA,
    pkNameA,
    tableB,
    pkNameB,
    relTables,
  }) {
    if (!Array.isArray(relTables)) {
      throw new Error("_buildRelsAmongPkListsQueries requires relTables (schema.relTables)");
    }
    const escapedA = DataDefinitionLanguage._escapeName(tableA);
    const escapedB = DataDefinitionLanguage._escapeName(tableB);
    const escapedPkA = DataDefinitionLanguage._escapeName(pkNameA);
    const escapedPkB = DataDefinitionLanguage._escapeName(pkNameB);

    // Connectivity is matched on the raw table names; only escaped names are
    // interpolated into queries. A rel type is relevant if it connects the two
    // tables in either direction.
    return relTables
      .filter(t =>
        (t.connectivity || []).some(
          c =>
            (c.src === tableA && c.dst === tableB) ||
            (c.src === tableB && c.dst === tableA)
        )
      )
      .map(t =>
        `UNWIND $pksA AS a_pk UNWIND $pksB AS b_pk MATCH (a:${escapedA}) -[r:${DataDefinitionLanguage._escapeName(t.name)}]- (b:${escapedB}) WHERE a.${escapedPkA} = a_pk AND b.${escapedPkB} = b_pk RETURN r;`
      );
  }

  // All edges AMONG a set of nodes — i.e. every edge whose BOTH endpoints are
  // inside the batch. `nodes` is an array of
  // { table, primaryKeyName, primaryKeyValues } — one entry per distinct
  // (table, pk-column) among the batch nodes (the same shape as `others` in
  // fetchRelsBetweenNodeAndMany). Returns a merged result of the shape
  // `{ rows: [{ r }], dataTypes }` (or null if nothing connects), matching
  // fetchRelsBetween/fetchRelsBetweenNodeAndMany so callers reuse the same
  // row-handling path.
  //
  // Requests scale with (rel types per table pairing) x (unordered table
  // pairings, including each table with itself), NOT with the number of batch
  // nodes: one query binds two whole pk lists via nested UNWIND. Each unordered
  // table pair is visited once (self-pairs handle same-table edges), and the
  // undirected `-[r]-` match catches both stored directions, so no pairing is
  // queried twice.
  async fetchRelsAmongNodes({
    nodes,
    relTables,
  }) {
    if (!Array.isArray(nodes)) {
      throw new Error("fetchRelsAmongNodes requires a nodes array");
    }
    // Keep only entries that actually carry bindable pk values.
    const groups = nodes
      .map(node => ({
        table: node.table,
        primaryKeyName: node.primaryKeyName,
        primaryKeyValues: (node.primaryKeyValues || [])
          .map(v => this._unwrapPrimaryKeyValue(v))
          .filter(v => v !== undefined && v !== null),
      }))
      .filter(group => group.primaryKeyValues.length > 0);

    const requests = [];
    // Visit each unordered pairing (i <= j) exactly once. j === i is the
    // self-pairing that fetches edges between two nodes of the same table.
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i; j < groups.length; j += 1) {
        const a = groups[i];
        const b = groups[j];
        const queries = this._buildRelsAmongPkListsQueries({
          tableA: a.table,
          pkNameA: a.primaryKeyName,
          tableB: b.table,
          pkNameB: b.primaryKeyName,
          relTables,
        });
        queries.forEach(query => {
          requests.push(
            this._runQuery(query, { pksA: a.primaryKeyValues, pksB: b.primaryKeyValues })
          );
        });
      }
    }

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
      queries.map(query => this._runQuery(query, params))
    );
    return this._mergeResults(results);
  }
}

export default new NeighborsFetcher();
