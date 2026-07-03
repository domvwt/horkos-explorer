/**
 * DisplayLabels - Human-facing display names for graph schema table names.
 *
 * The Kuzu polymorphic-COPY split produces actor-first rel table names
 * (PersonOwnership, CorporateInfluence, ...). For display we re-order them
 * relationship-first so the edge reads by what it means, and give internal
 * node tables (VirtualHub) a plain-English name. Raw table names remain the
 * keys for colors, settings, and queries — these mappings are display-only.
 */

export const REL_TYPE_DISPLAY_NAMES = {
  PersonOwnership: "OwnershipPerson",
  CorporateOwnership: "OwnershipCorporate",
  PersonInfluence: "InfluencePerson",
  CorporateInfluence: "InfluenceCorporate",
};

export const NODE_TYPE_DISPLAY_NAMES = {
  VirtualHub: "Virtual Hub",
};

export function relTypeDisplayName(name) {
  return REL_TYPE_DISPLAY_NAMES[name] || name;
}

export function nodeTypeDisplayName(name) {
  return NODE_TYPE_DISPLAY_NAMES[name] || name;
}
