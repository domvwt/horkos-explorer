/**
 * Pure, framework-free helpers behind the shell's first-run demo query
 * (ShellMainView.vue).
 *
 * The component owns the Vue lifecycle, the Monaco cell and the
 * schema-arrival upgrade machinery; this module holds the query-derivation
 * contract so it can be unit tested without mounting the SFC.
 *
 * Derivation order:
 *   1. Preferred: when the loaded schema contains the Horkos core tables
 *      (Person and Company node tables plus the PersonOwnership rel table),
 *      return a curated example showing people and the companies they own.
 *      The branch is gated on the live schema, so it can never target tables
 *      that don't exist - on any other database it simply never fires.
 *   2. Derived: otherwise target the schema's first relationship table with
 *      a single concrete rel type. A wildcard `MATCH (a)-[r]->(b) RETURN *`
 *      spanning every relationship table can fail on graphs where different
 *      rel tables have divergent property (STRUCT) shapes, since Kuzu then
 *      has to cast/union them into one result shape; a single typed rel
 *      avoids that entirely and keeps the demo schema-agnostic.
 *   3. Fallback: with no usable schema (not loaded yet, or no rel tables),
 *      a node-only query, which can never hit the cross-type cast.
 */

// The busiest company by PersonOwnership links, plus its direct owners. The
// anchor is found at runtime (ORDER BY ... LIMIT 1) so no company name is
// hardcoded and the result is never empty on any graph that has a single
// PersonOwnership edge. The hop is pinned to the SINGLE PersonOwnership rel
// type on purpose: an untyped hop (`-[]-`) forces Kuzu to union the graph's
// heterogeneous rel tables, whose divergent property structs cannot be
// combined - that fails at execution, not parse time. One typed hop keeps the
// demo a cheap, bounded read that passes the READ_ONLY allowlist.
const HORKOS_DEMO_QUERY = `// Example: the busiest company and its direct owners. Edit or clear this to start your own research.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (c:Company)-[:PersonOwnership]-()
WITH c, count(*) AS links
ORDER BY links DESC
LIMIT 1
MATCH (c)-[owns:PersonOwnership]-(neighbour)
RETURN c, owns, neighbour
LIMIT 50;`;

function hasTable(tables, name) {
  return Array.isArray(tables) && tables.some((table) => !!table && table.name === name);
}

/**
 * True when the loaded schema contains every table the curated Horkos demo
 * query targets: Person and Company node tables and the PersonOwnership rel
 * table.
 */
export function hasHorkosDemoSchema(schema) {
  return !!(
    schema &&
    hasTable(schema.nodeTables, "Person") &&
    hasTable(schema.nodeTables, "Company") &&
    hasTable(schema.relTables, "PersonOwnership")
  );
}

/**
 * Build the demo query for the given schema (see derivation order above).
 */
export function buildDemoQuery(schema) {
  if (hasHorkosDemoSchema(schema)) {
    return HORKOS_DEMO_QUERY;
  }
  const relType = schema && schema.relTables && schema.relTables[0]
    ? schema.relTables[0].name
    : null;
  // Only build the single-type query when the first rel table actually
  // has a non-empty name; a malformed schema payload would otherwise
  // produce `[r:undefined]`. In that case fall back to the node-only
  // query, which can never hit the cross-type cast either.
  if (relType) {
    return `// Query to retrieve 5 "${relType}" relationships from the graph.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (a)-[r:${relType}]->(b) RETURN a, r, b LIMIT 5;`;
  }
  return `// Query to retrieve 5 nodes from the graph.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (n) RETURN n LIMIT 5;`;
}

/**
 * Whether the schema is loaded enough to derive a FINAL demo query - the
 * curated Horkos example or the single-rel-type derivation - as opposed to
 * the node-only fallback. Used to decide when the demo query is final and
 * no further schema-arrival upgrade is needed.
 *
 * The Horkos check is listed explicitly even though it implies a non-empty
 * relTables array: the preferred branch must always count as final,
 * independent of how the derived branch's gate might evolve.
 */
export function hasSchemaForDemo(schema) {
  return (
    hasHorkosDemoSchema(schema) ||
    !!(schema && schema.relTables && schema.relTables[0] && schema.relTables[0].name)
  );
}
