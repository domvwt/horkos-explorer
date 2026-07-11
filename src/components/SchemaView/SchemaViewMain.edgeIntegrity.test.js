import { describe, it, expect, vi } from "vitest";

// The edge-integrity guard added at the end of SchemaViewMain.vue's
// extractGraphFromSchema, before returning { nodes, edges }. Schema nodes come
// only from schema.nodeTables (id = table name); schema edges come from
// relTables[].connectivity (conn.src/conn.dst) with only a truthiness check.
// A rel table whose connectivity names a node table NOT in nodeTables would emit
// a dangling edge, and G6 v5's setData (drawGraph/redrawGraph) throws an uncaught
// "Node not found for id: <id>" on it. The guard drops any edge whose source or
// target isn't a known node id and console.warns.
//
// SchemaViewMain.vue is a large SFC vitest doesn't compile cleanly, so (as with
// the sibling ResultGraph edge-integrity test) this locks the guard's semantics
// with a DB-free reference that mirrors the inline filter exactly.
function schemaIntegrityFilterEdges(nodes, edges) {
  const nodeIds = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      return true;
    }
    console.warn(
      `extractGraphFromSchema: dropping dangling edge ${e.id} (source=${e.source}, target=${e.target}) — endpoint node table not in schema`
    );
    return false;
  });
}

// Schema nodes are keyed by table name (id: n.name); edges reference tables by
// name in top-level .source/.target (id: `${src}-${dst}-${label}`).
const schemaNode = (name) => ({ id: name });
const connEdge = (src, dst, label) => ({ id: `${src}-${dst}-${label}`, source: src, target: dst });

describe("extractGraphFromSchema edge-integrity guard (SchemaViewMain.vue)", () => {
  it("keeps connectivity edges whose endpoints are both real node tables", () => {
    const nodes = [schemaNode("Person"), schemaNode("Company"), schemaNode("Address")];
    const edges = [
      connEdge("Person", "Company", "Directorship"),
      connEdge("Company", "Address", "RegisteredAddress"),
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const kept = schemaIntegrityFilterEdges(nodes, edges);

    expect(kept).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops an edge whose connectivity names a node table absent from the schema", () => {
    // A rel table connects Company to "Trust", but Trust is not in nodeTables.
    const nodes = [schemaNode("Person"), schemaNode("Company")];
    const edges = [
      connEdge("Person", "Company", "Directorship"),
      connEdge("Company", "Trust", "TrustControl"),
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const kept = schemaIntegrityFilterEdges(nodes, edges);

    expect(kept.map((e) => e.id)).toEqual(["Person-Company-Directorship"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Trust");
    warn.mockRestore();
  });

  it("drops an edge whose source table is absent and warns", () => {
    const nodes = [schemaNode("Company")];
    const edges = [connEdge("Ghost", "Company", "GhostRel")];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const kept = schemaIntegrityFilterEdges(nodes, edges);

    expect(kept).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
