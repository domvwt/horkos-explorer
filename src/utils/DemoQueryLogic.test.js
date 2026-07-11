import { describe, it, expect } from "vitest";
import {
  buildDemoQuery,
  hasHorkosDemoSchema,
  hasSchemaForDemo,
} from "./DemoQueryLogic";

// Realistic Horkos schema shape: /api/schema returns nodeTables/relTables
// sorted alphabetically by name (Database.js), so relTables[0] is
// CorporateOwnership, NOT PersonOwnership - the preferred branch must win
// over first-rel-table derivation.
const horkosSchema = {
  nodeTables: [
    { name: "Address" },
    { name: "Company" },
    { name: "Person" },
  ],
  relTables: [
    { name: "CorporateOwnership" },
    { name: "Directorship" },
    { name: "PersonOwnership" },
    { name: "RegisteredAddress" },
    { name: "ResidentialAddress" },
  ],
};

const HORKOS_DEMO_QUERY = `// Example: the busiest company and its direct owners. Edit or clear this to start your own research.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (c:Company)-[:PersonOwnership]-()
WITH c, count(*) AS links
ORDER BY links DESC
LIMIT 1
MATCH (c)-[owns:PersonOwnership]-(neighbour)
RETURN c, owns, neighbour
LIMIT 50;`;

describe("buildDemoQuery", () => {
  it("returns the curated Horkos example when Person, Company and PersonOwnership all exist", () => {
    // Exact-text pin: this is user-facing first-run copy and the query must
    // stay a cheap, fully typed, bounded read (passes the READ_ONLY
    // allowlist). Do not loosen this assertion to a substring match.
    expect(buildDemoQuery(horkosSchema)).toBe(HORKOS_DEMO_QUERY);
  });

  it("prefers the curated example over the alphabetically-first rel table", () => {
    // relTables[0] is CorporateOwnership on the Horkos schema; the demo must
    // not target it when the curated branch applies.
    expect(buildDemoQuery(horkosSchema)).not.toContain("CorporateOwnership");
  });

  it("derives from the first rel table on a non-Horkos schema", () => {
    const schema = {
      nodeTables: [{ name: "User" }],
      relTables: [{ name: "Follows" }],
    };
    expect(buildDemoQuery(schema)).toBe(`// Query to retrieve 5 "Follows" relationships from the graph.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (a)-[r:Follows]->(b) RETURN a, r, b LIMIT 5;`);
  });

  it("requires ALL three Horkos tables - PersonOwnership alone is not enough", () => {
    const schema = {
      nodeTables: [{ name: "Company" }],
      relTables: [{ name: "PersonOwnership" }],
    };
    // Person node table missing: fall through to first-rel-table derivation.
    expect(buildDemoQuery(schema)).toContain(
      "MATCH (a)-[r:PersonOwnership]->(b) RETURN a, r, b LIMIT 5;"
    );
    expect(buildDemoQuery(schema)).not.toContain("start your own research");
  });

  it("requires the PersonOwnership rel table - Person/Company nodes alone are not enough", () => {
    const schema = {
      nodeTables: [{ name: "Company" }, { name: "Person" }],
      relTables: [{ name: "Directorship" }],
    };
    expect(buildDemoQuery(schema)).toContain(
      "MATCH (a)-[r:Directorship]->(b) RETURN a, r, b LIMIT 5;"
    );
  });

  it("falls back to the node-only query when no schema is loaded", () => {
    const fallback = `// Query to retrieve 5 nodes from the graph.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (n) RETURN n LIMIT 5;`;
    expect(buildDemoQuery(null)).toBe(fallback);
    expect(buildDemoQuery(undefined)).toBe(fallback);
    expect(buildDemoQuery({ nodeTables: [], relTables: [] })).toBe(fallback);
  });

  it("falls back when the first rel table has no usable name", () => {
    // A malformed schema payload must never produce `[r:undefined]`.
    const schema = { nodeTables: [], relTables: [{ name: "" }] };
    expect(buildDemoQuery(schema)).toContain("MATCH (n) RETURN n LIMIT 5;");
  });
});

describe("hasHorkosDemoSchema", () => {
  it("is true only when all three tables are present", () => {
    expect(hasHorkosDemoSchema(horkosSchema)).toBe(true);
    expect(hasHorkosDemoSchema(null)).toBe(false);
    expect(hasHorkosDemoSchema({
      nodeTables: [{ name: "Person" }, { name: "Company" }],
      relTables: [{ name: "Directorship" }],
    })).toBe(false);
    expect(hasHorkosDemoSchema({
      nodeTables: [{ name: "Person" }],
      relTables: [{ name: "PersonOwnership" }],
    })).toBe(false);
  });
});

describe("hasSchemaForDemo", () => {
  it("treats the curated Horkos branch as final", () => {
    expect(hasSchemaForDemo(horkosSchema)).toBe(true);
  });

  it("treats the single-rel-type derivation as final", () => {
    expect(hasSchemaForDemo({
      nodeTables: [],
      relTables: [{ name: "Follows" }],
    })).toBe(true);
  });

  it("is false while only the node-only fallback is derivable", () => {
    expect(hasSchemaForDemo(null)).toBe(false);
    expect(hasSchemaForDemo({ nodeTables: [], relTables: [] })).toBe(false);
    expect(hasSchemaForDemo({ nodeTables: [], relTables: [{ name: "" }] })).toBe(false);
  });
});
