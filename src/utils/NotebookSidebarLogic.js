/**
 * Pure, framework-free helpers behind the notebook sidebar.
 *
 * The sidebar component (NotebookSidebar.vue) owns Vue lifecycle, DOM and the
 * Pinia store; this module holds the decision logic on the sidebar's live
 * paths so it can be unit-tested without @vue/test-utils:
 *
 *   - the blur-commit "page" draft pattern (copied from EntityPinPanel's note
 *     handling): a local draft is committed to the store only when it actually
 *     differs from what's stored, and flushed on unmount so no edit is lost;
 *   - the select-entity / save-view / restore-view actions THROUGH a shell
 *     cell. ShellMainView resolves the active cell's ResultGraph and passes it
 *     here as `graph`; these helpers validate the request, invoke the graph's
 *     handler, and normalise the outcome to { ok, reason } so the sidebar can
 *     give feedback instead of silently no-opping. In tests, `graph` is a mock
 *     exposing the same handler surface.
 *
 * Reasons:
 *   - "empty-name"  save: blank view name (the UI disables the button; this
 *                   guards programmatic calls);
 *   - "no-view"     restore: malformed view (missing its state code);
 *   - "no-entity"   select: malformed target (missing label/pk);
 *   - "no-graph"    no mounted graph canvas to act on (table/code view, or no
 *                   cells) — the sidebar surfaces a hint for this one;
 *   - "empty-graph" save: a canvas exists but holds nothing to save —
 *                   ResultGraph already shows its own toast for this.
 */

/**
 * Commit a page draft to the store iff it differs from the stored page. Returns
 * true when a write happened. Used both on textarea blur and on unmount flush,
 * so a pending edit is never dropped when the sidebar is torn down without a
 * blur firing (same failure mode EntityPinPanel guards against).
 */
export function commitPageDraft(store, draft) {
  const next = typeof draft === "string" ? draft : "";
  const current = store.page || "";
  if (next === current) {
    return false;
  }
  store.setPage(next);
  return true;
}

/**
 * Save the current canvas as a named view. The heavy lifting (reading the live
 * G6 canvas, serialising it, writing the store, toasting) lives in
 * ResultGraph.handleSaveCurrentView, which returns whether a view was actually
 * saved (false for an empty canvas).
 */
export function saveViewThroughCell(graph, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty-name" };
  }
  if (!graph || typeof graph.handleSaveCurrentView !== "function") {
    return { ok: false, reason: "no-graph" };
  }
  const saved = graph.handleSaveCurrentView(trimmed);
  return saved ? { ok: true, reason: null } : { ok: false, reason: "empty-graph" };
}

/**
 * Restore a previously-saved view onto the cell's canvas via
 * ResultGraph.handleRestoreSavedView (async; parse failures are toasted by
 * ResultGraph itself, so a dispatched restore counts as ok here).
 */
export function restoreViewThroughCell(graph, view) {
  if (!view || !view.state) {
    return { ok: false, reason: "no-view" };
  }
  if (!graph || typeof graph.handleRestoreSavedView !== "function") {
    return { ok: false, reason: "no-graph" };
  }
  graph.handleRestoreSavedView(view);
  return { ok: true, reason: null };
}

/**
 * Route a pinned/noted entity click to the cell's pin-navigation handler
 * (ResultGraph.handleSelectPinnedEntity — it already handles on-canvas /
 * hidden / off-canvas / not-found).
 */
export function selectEntityThroughCell(graph, target) {
  if (!target || !target.label || target.pk == null) {
    return { ok: false, reason: "no-entity" };
  }
  if (!graph || typeof graph.handleSelectPinnedEntity !== "function") {
    return { ok: false, reason: "no-graph" };
  }
  graph.handleSelectPinnedEntity({ label: target.label, pk: target.pk });
  return { ok: true, reason: null };
}
