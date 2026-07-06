/**
 * DisplayPolicy - The single source of truth for how graph entities are
 * presented to the user.
 *
 * Every rendering surface (graph side panel, hover tooltip, connected-entities
 * list, provenance badges) MUST derive its display decisions from this module
 * rather than hard-coding its own filter lists or label maps. Keeping the policy
 * in one place is what prevents disclosure leaks — e.g. an internal resolver
 * field being filtered on one surface but rendered raw on another.
 *
 * Raw table/property names remain the keys used for colours, settings, and
 * queries; the maps here are display-only.
 */

/**
 * Internal/technical property names written onto entities by the resolver that
 * must NEVER be shown as raw property rows in the UI. They are surfaced through
 * purpose-built widgets instead (e.g. the confidence chip reads `quality_level`).
 *
 * This is the allowlist-of-what-to-hide that every surface filters against.
 */
export const INTERNAL_FIELD_NAMES = ["quality_level", "quality_concerns"];

/**
 * The property name carrying the resolver's merge-quality band, read by the
 * confidence indicator. Exposed as a named constant so the one surface that
 * legitimately consumes this internal field references the shared policy rather
 * than re-typing the literal.
 */
export const QUALITY_LEVEL_FIELD = "quality_level";

/**
 * Remove internal/technical fields from a beautified property list.
 *
 * @param {Array<{name: string, isLabel?: boolean}>} properties
 * @param {Object} [options]
 * @param {boolean} [options.dropLabel=false] - Also drop the synthetic
 *   entity/relationship-type "label" row (the graph side panel shows it as a
 *   header badge instead, so it filters the row out; the hover tooltip keeps
 *   the row, so it does not).
 * @returns {Array} Filtered properties (a new array; input is not mutated).
 */
export function hideInternalProperties(properties, options = {}) {
  const { dropLabel = false } = options;
  if (!Array.isArray(properties)) {
    return [];
  }
  return properties.filter((p) => {
    if (INTERNAL_FIELD_NAMES.includes(p.name)) {
      return false;
    }
    if (dropLabel && p.isLabel) {
      return false;
    }
    return true;
  });
}

/**
 * Display names for relationship (edge) TYPES.
 *
 * The per-actor-type split (Person/Corporate variants) exists only because
 * Kuzu rel tables can't be polymorphic; it carries no meaning for users, so
 * both halves collapse to one user-facing type name.
 */
export const REL_TYPE_DISPLAY_NAMES = {
  PersonOwnership: "Ownership",
  CorporateOwnership: "Ownership",
  PersonInfluence: "Influence",
  CorporateInfluence: "Influence",
  RegisteredAddress: "Location",
  CorrespondenceAddress: "Location",
  PersonAmbiguousLink: "Possible Match",
  CompanyAmbiguousLink: "Possible Match",
  AddressAmbiguousLink: "Possible Match",
};

/**
 * Display names for node TYPES that carry no human-readable property (internal
 * node tables). Real entity types (Person/Company/Address) are intentionally
 * absent so they fall through to their actual name.
 */
export const NODE_TYPE_DISPLAY_NAMES = {
  VirtualHub: "Possible Matches",
};

export function relTypeDisplayName(name) {
  return REL_TYPE_DISPLAY_NAMES[name] || name;
}

export function nodeTypeDisplayName(name) {
  return NODE_TYPE_DISPLAY_NAMES[name] || name;
}

/**
 * Direction-aware relationship ROLE labels used by the connected-entities list.
 *
 * These are distinct from REL_TYPE_DISPLAY_NAMES: that map names the edge TYPE
 * ("Ownership"), whereas these name the ROLE a neighbour plays relative to the
 * clicked entity, and differ by direction ("Owner" vs "Owned by").
 */
export const RELATIONSHIP_ROLE_LABELS = {
  PersonOwnership: { forward: "Owner", reverse: "Owned by" },
  CorporateOwnership: { forward: "Owner", reverse: "Owned by" },
  PersonInfluence: { forward: "Controls", reverse: "Controlled by" },
  CorporateInfluence: { forward: "Controls", reverse: "Controlled by" },
  RegisteredAddress: { forward: "Registered at", reverse: "Registered Address" },
  CorrespondenceAddress: {
    forward: "Correspondence at",
    reverse: "Correspondence Address",
  },
  // Match candidates (entity <-> VirtualHub); neutral copy, deliberately
  // distinct from the confirmed relationship labels above.
  PersonAmbiguousLink: { forward: "Possible match", reverse: "Possible match" },
  CompanyAmbiguousLink: { forward: "Possible match", reverse: "Possible match" },
  AddressAmbiguousLink: { forward: "Possible match", reverse: "Possible match" },
};

/**
 * Resolve a direction-aware relationship role label.
 *
 * @param {string} edgeLabel - Raw rel table name.
 * @param {Object} [options]
 * @param {boolean} [options.reverse=false] - True when the neighbour is the
 *   edge SOURCE (so the clicked node is the target).
 * @returns {string} The role label; falls back to the raw edge label when the
 *   type is unknown.
 */
export function relationshipRoleLabel(edgeLabel, options = {}) {
  const { reverse = false } = options;
  const mapping = RELATIONSHIP_ROLE_LABELS[edgeLabel] || {
    forward: edgeLabel,
    reverse: edgeLabel,
  };
  return reverse ? mapping.reverse : mapping.forward;
}

/**
 * Plural group-heading labels for entity types in the connected-entities list.
 *
 * Kept distinct from NODE_TYPE_DISPLAY_NAMES: this map pluralises real entity
 * types for use as GROUP HEADINGS, whereas NODE_TYPE_DISPLAY_NAMES is used where
 * a single entity's type name is shown. VirtualHub agrees across both.
 */
export const ENTITY_GROUP_LABELS = {
  Person: "People",
  Company: "Companies",
  Address: "Addresses",
  VirtualHub: "Possible Matches",
};

export function entityGroupLabel(name) {
  return ENTITY_GROUP_LABELS[name] || name;
}

/**
 * Parse a list-valued property that may arrive as an actual array or as a
 * string representation like "['psc', 'companies_house']".
 *
 * @param {*} value
 * @returns {Array} Parsed list (empty for NULL/absent/non-list values).
 */
export function parseListValue(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value !== "NULL") {
    const cleaned = value.replace(/[[\]'"]/g, "");
    return cleaned
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s);
  }
  return [];
}

/**
 * Format a single ownership/nature-of-control share value for display.
 *
 * PSC nature-of-control bands arrive as strings like "25-to-50-percent" and
 * render as "25–50%". Plain numeric values get a "%" suffix. Unrecognised
 * values pass through verbatim.
 *
 * @param {*} raw
 * @returns {string}
 */
export function formatShareValue(raw) {
  const value = String(raw).trim();
  const bandMatch = value.match(/^(\d+)-to-(\d+)-percent$/);
  if (bandMatch) {
    return `${bandMatch[1]}–${bandMatch[2]}%`;
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    return `${value}%`;
  }
  return value;
}

/**
 * Derive the distinct set of ownership-share values carried by a relationship.
 *
 * Ownership share lives inside the rel's `sources` STRUCT array (one entry per
 * contributing source record). An edge can carry several entries with differing
 * bands (multi-source convergence), so the distinct set is returned.
 *
 * @param {Object} rel - Raw relationship object.
 * @returns {string|null} Comma-separated distinct formatted shares, or null.
 */
export function extractOwnershipShare(rel) {
  if (!rel || !Array.isArray(rel.sources)) {
    return null;
  }
  const values = rel.sources
    .map((source) => source && source.percentage)
    .filter((value) => value !== null && value !== undefined && value !== "");
  if (values.length === 0) {
    return null;
  }
  return [...new Set(values.map(formatShareValue))].join(", ");
}

/**
 * Display names for provenance source systems. Keys are the normalised system
 * identifiers found in `source_systems`; values are the user-facing labels.
 */
export const SOURCE_SYSTEM_DISPLAY_NAMES = {
  companies_house: "Companies House",
  psc: "PSC Register",
};

export function sourceSystemDisplayName(system) {
  return SOURCE_SYSTEM_DISPLAY_NAMES[system] || system;
}

/**
 * Count source records per system from a list of record ids.
 *
 * Record ids are prefixed "system:..." — note the prefix spells systems with
 * hyphens ("companies-house") where `source_systems` uses underscores, so the
 * prefix is normalised to underscores before counting.
 *
 * @param {*} records - Array or string representation of record ids.
 * @returns {Object<string, number>} Map of normalised system -> record count.
 */
export function countRecordsBySystem(records) {
  const recordCounts = {};
  parseListValue(records).forEach((record) => {
    const system = String(record).split(":")[0].replace(/-/g, "_");
    recordCounts[system] = (recordCounts[system] || 0) + 1;
  });
  return recordCounts;
}
