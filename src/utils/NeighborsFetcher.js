import Axios from "@/utils/AxiosWrapper";
import DataDefinitionLanguage from "./DataDefinitionLanguage";
import Kuzu from "./KuzuWasm";

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
