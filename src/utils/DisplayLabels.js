/**
 * DisplayLabels - Human-facing display names for graph schema table names.
 *
 * Raw table names remain the keys for colors, settings, and queries — these
 * mappings are display-only.
 */

export const REL_TYPE_DISPLAY_NAMES = {
  // The per-actor-type split (Person*/Corporate*) exists only because Kuzu
  // rel tables can't be polymorphic; it carries no meaning for users.
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

export const NODE_TYPE_DISPLAY_NAMES = {
  VirtualHub: "Possible Matches",
};

export function relTypeDisplayName(name) {
  return REL_TYPE_DISPLAY_NAMES[name] || name;
}

export function nodeTypeDisplayName(name) {
  return NODE_TYPE_DISPLAY_NAMES[name] || name;
}
