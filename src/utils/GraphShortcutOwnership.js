/**
 * Tracks which mounted ResultGraph instance currently owns the global graph
 * keyboard shortcuts (undo/redo, Delete).
 *
 * Every ResultGraph registers its own window-level keydown listener, and
 * instances stay mounted while hidden (Table/Code tabs, other notebook
 * cells). A visibility check alone is not enough of a gate: in the
 * non-maximized notebook layout several graphs are visible at once, so a
 * single Ctrl+Z would fire undo on every one of them. Ownership narrows the
 * shortcuts to the one graph the user last interacted with — claimed on
 * pointerdown inside a graph's result container and on programmatic adds
 * (node search, notebook pins), released when the instance unmounts.
 */

let owner = null;

export function claimGraphShortcuts(instance) {
  if (instance) {
    owner = instance;
  }
}

export function ownsGraphShortcuts(instance) {
  return instance != null && owner === instance;
}

/**
 * Releases only if this instance still holds the claim, so unmounting an old
 * cell cannot strip ownership from the graph the user has since moved to.
 */
export function releaseGraphShortcuts(instance) {
  if (owner === instance) {
    owner = null;
  }
}
