/**
 * Pure, framework-free helpers behind the node search panel (NodeSearch.vue).
 *
 * The component owns Vue lifecycle, the /api/suggest debounce and the DOM; this
 * module holds the one decision that has a contract worth testing in isolation:
 * what should happen when the analyst picks an autocomplete suggestion.
 *
 * Design: picking a suggestion is ADDITIVE — it routes to the active cell's
 * ResultGraph.handleSelectPinnedEntity({ label, pk }) so the entity is added to
 * (or focused on) the existing canvas instead of replacing it, exactly like a
 * pin click. That requires a stable primary key, which /api/suggest carries as
 * `clusterId`. A suggestion without one (only possible on legacy pre-contract
 * search tables, where the server returns cluster_id: null) cannot be navigated
 * to: it is rejected so the component can surface input feedback and do nothing
 * else. No suggestion pick ever runs a canvas-replacing query; the Search
 * button / Enter-to-search remain the way to run a name search.
 */

/**
 * Decide how a picked suggestion should be handled.
 *
 * Returns a discriminated result:
 *   - { mode: "select", label, pk }  route additively via handleSelectPinnedEntity;
 *   - { mode: "reject" }             no cluster id to navigate by - show input
 *                                    feedback (toast) and do nothing else.
 *
 * `label` is the currently selected node type (Person/Company/Address).
 */
export function planSuggestionSelect(suggestion, label) {
  if (suggestion && suggestion.clusterId != null && suggestion.clusterId !== "") {
    return { mode: "select", label, pk: suggestion.clusterId };
  }
  return { mode: "reject" };
}
