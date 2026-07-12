import { describe, it, expect } from "vitest";
import {
  INTERNAL_FIELD_NAMES,
  QUALITY_LEVEL_FIELD,
  hideInternalProperties,
  relTypeDisplayName,
  nodeTypeDisplayName,
  relationshipRoleLabel,
  entityGroupLabel,
  parseListValue,
  formatShareValue,
  extractOwnershipShare,
  sourceSystemDisplayName,
  countRecordsBySystem,
  isPscOnlyProvenance,
  AMBIGUOUS_REL_TYPE_NAMES,
  VIRTUAL_NODE_TYPE_NAMES,
  isAmbiguousRelType,
  isVirtualNodeType,
  POSSIBLE_MATCH_LABEL_PREFIX,
  REL_TYPE_DISPLAY_NAMES,
  NODE_TYPE_DISPLAY_NAMES,
} from "./DisplayPolicy";

describe("internal-field filter", () => {
  it("hides every internal field name", () => {
    const props = [
      { name: "name", value: "Acme" },
      { name: "quality_level", value: "HIGH" },
      { name: "quality_concerns", value: "hub pattern" },
      { name: "id", value: "c1" },
    ];
    const out = hideInternalProperties(props);
    const names = out.map((p) => p.name);
    expect(names).toEqual(["name", "id"]);
    // The leaked resolver strings are gone.
    expect(names).not.toContain("quality_level");
    expect(names).not.toContain("quality_concerns");
  });

  it("hides source-system/source-records fields (duplicated by the provenance panel)", () => {
    const props = [
      { name: "name", value: "Acme" },
      { name: "source_systems", value: "['companies_house', 'psc']" },
      { name: "source_records", value: "['companies-house:1', 'psc:2']" },
      { name: "id", value: "c1" },
    ];
    const out = hideInternalProperties(props);
    const names = out.map((p) => p.name);
    expect(names).toEqual(["name", "id"]);
    expect(names).not.toContain("source_systems");
    expect(names).not.toContain("source_records");
  });

  it("does not hide unrelated properties that merely mention 'source'", () => {
    const props = [
      { name: "name", value: "Acme" },
      { name: "source_systems", value: "['psc']" },
    ];
    const out = hideInternalProperties(props);
    expect(out.map((p) => p.name)).toEqual(["name"]);
  });

  it("keeps the synthetic type/label row by default (hover tooltip behaviour)", () => {
    const props = [
      { name: "Entity Type", value: "Company", isLabel: true },
      { name: "name", value: "Acme" },
      { name: "quality_level", value: "HIGH" },
    ];
    const out = hideInternalProperties(props);
    expect(out.map((p) => p.name)).toEqual(["Entity Type", "name"]);
  });

  it("drops the label row when dropLabel is set (side-panel behaviour)", () => {
    const props = [
      { name: "Entity Type", value: "Company", isLabel: true },
      { name: "name", value: "Acme" },
      { name: "quality_concerns", value: "hub pattern" },
    ];
    const out = hideInternalProperties(props, { dropLabel: true });
    expect(out.map((p) => p.name)).toEqual(["name"]);
  });

  it("does not mutate its input", () => {
    const props = [{ name: "quality_level", value: "HIGH" }];
    hideInternalProperties(props);
    expect(props).toHaveLength(1);
  });

  it("returns [] for non-array input", () => {
    expect(hideInternalProperties(null)).toEqual([]);
    expect(hideInternalProperties(undefined)).toEqual([]);
  });

  it("exposes the internal field list and quality-level constant", () => {
    expect(INTERNAL_FIELD_NAMES).toContain("quality_level");
    expect(INTERNAL_FIELD_NAMES).toContain("quality_concerns");
    expect(INTERNAL_FIELD_NAMES).toContain("source_systems");
    expect(INTERNAL_FIELD_NAMES).toContain("source_records");
    expect(QUALITY_LEVEL_FIELD).toBe("quality_level");
  });
});

describe("rel-type display names", () => {
  it("collapses the actor-type split to one user-facing name", () => {
    expect(relTypeDisplayName("PersonOwnership")).toBe("Ownership");
    expect(relTypeDisplayName("CorporateOwnership")).toBe("Ownership");
    expect(relTypeDisplayName("PersonInfluence")).toBe("Influence");
    expect(relTypeDisplayName("CorporateInfluence")).toBe("Influence");
    expect(relTypeDisplayName("RegisteredAddress")).toBe("Location");
    expect(relTypeDisplayName("CorrespondenceAddress")).toBe("Location");
    expect(relTypeDisplayName("PersonAmbiguousLink")).toBe("Possible Match");
    expect(relTypeDisplayName("CompanyAmbiguousLink")).toBe("Possible Match");
    expect(relTypeDisplayName("AddressAmbiguousLink")).toBe("Possible Match");
  });

  it("falls back to the raw name for unknown types", () => {
    expect(relTypeDisplayName("SomethingElse")).toBe("SomethingElse");
  });
});

describe("node-type display names", () => {
  it("maps internal node tables to a plain-English name", () => {
    expect(nodeTypeDisplayName("VirtualHub")).toBe("Possible Matches");
  });

  it("passes real entity types through unchanged (so their name shows)", () => {
    expect(nodeTypeDisplayName("Person")).toBe("Person");
    expect(nodeTypeDisplayName("Company")).toBe("Company");
    expect(nodeTypeDisplayName("Address")).toBe("Address");
  });
});

describe("direction-aware relationship role labels", () => {
  it("returns forward role by default", () => {
    expect(relationshipRoleLabel("PersonOwnership")).toBe("Owner");
    expect(relationshipRoleLabel("CorporateInfluence")).toBe("Controls");
    expect(relationshipRoleLabel("RegisteredAddress")).toBe("Registered at");
    expect(relationshipRoleLabel("CorrespondenceAddress")).toBe("Correspondence at");
  });

  it("returns reverse role when the neighbour is the edge source", () => {
    expect(relationshipRoleLabel("PersonOwnership", { reverse: true })).toBe("Owned by");
    expect(relationshipRoleLabel("CorporateInfluence", { reverse: true })).toBe("Controlled by");
    expect(relationshipRoleLabel("RegisteredAddress", { reverse: true })).toBe("Registered Address");
    expect(relationshipRoleLabel("CorrespondenceAddress", { reverse: true })).toBe("Correspondence Address");
  });

  it("uses the same neutral copy in both directions for match candidates", () => {
    expect(relationshipRoleLabel("PersonAmbiguousLink")).toBe("Possible match");
    expect(relationshipRoleLabel("PersonAmbiguousLink", { reverse: true })).toBe("Possible match");
    expect(relationshipRoleLabel("CompanyAmbiguousLink", { reverse: true })).toBe("Possible match");
    expect(relationshipRoleLabel("AddressAmbiguousLink")).toBe("Possible match");
  });

  it("falls back to the raw edge label for unknown types, both directions", () => {
    expect(relationshipRoleLabel("Weird")).toBe("Weird");
    expect(relationshipRoleLabel("Weird", { reverse: true })).toBe("Weird");
  });

  it("is genuinely distinct from the rel-type display name", () => {
    // Role labels name the neighbour's role; type names name the edge type.
    expect(relationshipRoleLabel("PersonOwnership")).not.toBe(
      relTypeDisplayName("PersonOwnership")
    );
  });
});

describe("entity group labels", () => {
  it("pluralises real entity types for group headings", () => {
    expect(entityGroupLabel("Person")).toBe("People");
    expect(entityGroupLabel("Company")).toBe("Companies");
    expect(entityGroupLabel("Address")).toBe("Addresses");
  });

  it("agrees with the node-type map on VirtualHub", () => {
    expect(entityGroupLabel("VirtualHub")).toBe("Possible Matches");
    expect(entityGroupLabel("VirtualHub")).toBe(nodeTypeDisplayName("VirtualHub"));
  });

  it("falls back to the raw label for unknown types", () => {
    expect(entityGroupLabel("Ship")).toBe("Ship");
  });
});

describe("list-value parsing", () => {
  it("returns arrays untouched", () => {
    expect(parseListValue(["psc", "companies_house"])).toEqual([
      "psc",
      "companies_house",
    ]);
  });

  it("strips brackets/quotes and splits string representations", () => {
    expect(parseListValue("['psc', 'companies_house']")).toEqual([
      "psc",
      "companies_house",
    ]);
    expect(parseListValue('["a","b"]')).toEqual(["a", "b"]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(parseListValue("a, b ,,c")).toEqual(["a", "b", "c"]);
  });

  it("treats NULL / non-string non-array as empty", () => {
    expect(parseListValue("NULL")).toEqual([]);
    expect(parseListValue(null)).toEqual([]);
    expect(parseListValue(undefined)).toEqual([]);
    expect(parseListValue(42)).toEqual([]);
  });
});

describe("formatShareValue", () => {
  it("renders PSC nature-of-control bands as ranges", () => {
    expect(formatShareValue("25-to-50-percent")).toBe("25–50%");
    expect(formatShareValue("75-to-100-percent")).toBe("75–100%");
  });

  it("suffixes plain numeric values with %", () => {
    expect(formatShareValue("50")).toBe("50%");
    expect(formatShareValue("12.5")).toBe("12.5%");
    expect(formatShareValue(50)).toBe("50%");
  });

  it("passes unrecognised values through verbatim (trimmed)", () => {
    expect(formatShareValue("  majority  ")).toBe("majority");
    expect(formatShareValue("unknown")).toBe("unknown");
  });
});

describe("extractOwnershipShare", () => {
  it("returns null when there is no sources array", () => {
    expect(extractOwnershipShare({})).toBeNull();
    expect(extractOwnershipShare(null)).toBeNull();
    expect(extractOwnershipShare({ sources: "nope" })).toBeNull();
  });

  it("returns null when no source carries a percentage", () => {
    expect(
      extractOwnershipShare({ sources: [{}, { percentage: null }, { percentage: "" }] })
    ).toBeNull();
  });

  it("formats and de-duplicates distinct bands from multiple sources", () => {
    const rel = {
      sources: [
        { percentage: "25-to-50-percent" },
        { percentage: "25-to-50-percent" },
        { percentage: "75" },
      ],
    };
    expect(extractOwnershipShare(rel)).toBe("25–50%, 75%");
  });
});

describe("source-system record counting", () => {
  it("maps normalised system ids to display names", () => {
    expect(sourceSystemDisplayName("companies_house")).toBe("Companies House");
    expect(sourceSystemDisplayName("psc")).toBe("PSC Register");
  });

  it("passes unknown systems through as their raw value", () => {
    expect(sourceSystemDisplayName("mystery")).toBe("mystery");
  });

  it("counts records per system, normalising hyphen prefixes to underscores", () => {
    const records = [
      "companies-house:123",
      "companies-house:456",
      "psc:789",
    ];
    expect(countRecordsBySystem(records)).toEqual({
      companies_house: 2,
      psc: 1,
    });
  });

  it("accepts a string representation of the record list", () => {
    expect(
      countRecordsBySystem("['companies-house:1', 'psc:2', 'psc:3']")
    ).toEqual({ companies_house: 1, psc: 2 });
  });

  it("returns {} for empty / NULL input", () => {
    expect(countRecordsBySystem("NULL")).toEqual({});
    expect(countRecordsBySystem(null)).toEqual({});
    expect(countRecordsBySystem([])).toEqual({});
  });
});

describe("PSC-only provenance detection", () => {
  it("is true when provenance is PSC-only (no Companies House record)", () => {
    expect(
      isPscOnlyProvenance({ source_records: "['psc:1', 'psc:2']" })
    ).toBe(true);
    expect(
      isPscOnlyProvenance({ source_records: ["psc:1"] })
    ).toBe(true);
  });

  it("is false when a Companies House record is present", () => {
    expect(
      isPscOnlyProvenance({ source_records: "['companies-house:1']" })
    ).toBe(false);
    // CH present alongside PSC (linked controller) — still no caveat.
    expect(
      isPscOnlyProvenance({ source_records: "['companies-house:1', 'psc:2']" })
    ).toBe(false);
  });

  it("is false when provenance is missing, empty, or unparseable", () => {
    expect(isPscOnlyProvenance({})).toBe(false);
    expect(isPscOnlyProvenance({ source_records: "NULL" })).toBe(false);
    expect(isPscOnlyProvenance({ source_records: [] })).toBe(false);
    expect(isPscOnlyProvenance(null)).toBe(false);
    expect(isPscOnlyProvenance(undefined)).toBe(false);
  });
});

describe("possible-matches layer membership", () => {
  it("classifies exactly the three AmbiguousLink rel types", () => {
    expect(AMBIGUOUS_REL_TYPE_NAMES).toHaveLength(3);
    AMBIGUOUS_REL_TYPE_NAMES.forEach((name) => {
      expect(isAmbiguousRelType(name)).toBe(true);
    });
    expect(isAmbiguousRelType("PersonOwnership")).toBe(false);
    expect(isAmbiguousRelType("RegisteredAddress")).toBe(false);
    expect(isAmbiguousRelType("")).toBe(false);
    expect(isAmbiguousRelType(undefined)).toBe(false);
  });

  it("classifies VirtualHub as the only virtual node type", () => {
    VIRTUAL_NODE_TYPE_NAMES.forEach((name) => {
      expect(isVirtualNodeType(name)).toBe(true);
    });
    expect(isVirtualNodeType("Person")).toBe(false);
    expect(isVirtualNodeType("")).toBe(false);
  });

  it("keeps layer membership in sync with the display-name maps", () => {
    // Every layer member must already have a neutral display name; a new
    // ambiguous rel table added to one map but not the other would let the
    // canvas styling and the copy disagree about the layer.
    AMBIGUOUS_REL_TYPE_NAMES.forEach((name) => {
      expect(REL_TYPE_DISPLAY_NAMES[name]).toBe("Possible Match");
    });
    VIRTUAL_NODE_TYPE_NAMES.forEach((name) => {
      expect(NODE_TYPE_DISPLAY_NAMES[name]).toBe("Possible Matches");
    });
  });

  it("uses the ≈ glyph as the hub canvas-label prefix", () => {
    expect(POSSIBLE_MATCH_LABEL_PREFIX).toBe("≈ ");
  });
});
