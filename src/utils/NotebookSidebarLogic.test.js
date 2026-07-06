import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_NOTEBOOK_NAME,
  decideCreateCommit,
  decideRenameCommit,
  commitPageDraft,
  saveViewThroughCell,
  restoreViewThroughCell,
  selectEntityThroughCell,
} from "./NotebookSidebarLogic";

// A minimal stand-in for the NotebookStore's page surface used by
// commitPageDraft: a `page` value and a `setPage` action that records writes.
function mockStore(page = "") {
  return {
    page,
    setPage(text) {
      this.page = text;
    },
  };
}

// A stand-in for the active cell's ResultGraph — the exact delegate
// ShellMainView.{saveNotebookView,restoreNotebookView,selectNotebookEntity}
// resolve via activeResultGraph() and pass to these helpers in production.
// It exposes the same handler surface and emulates its contract:
// handleSaveCurrentView returns whether a view was actually written (false for
// an empty canvas, where the real component toasts "Nothing to save").
function mockGraph({ empty = false, savedViews = [] } = {}) {
  return {
    savedViews,
    saveCalls: [],
    restoreCalls: [],
    selectCalls: [],
    handleSaveCurrentView(name) {
      this.saveCalls.push(name);
      if (empty) return false;
      const view = {
        id: `v${this.savedViews.length + 1}`,
        name,
        state: "HKS1:stub:Z",
      };
      this.savedViews.push(view);
      return true;
    },
    handleRestoreSavedView(view) {
      this.restoreCalls.push(view);
    },
    handleSelectPinnedEntity(target) {
      this.selectCalls.push(target);
    },
  };
}

describe("decideCreateCommit (inline new-notebook input)", () => {
  it("commits the trimmed name on Enter", () => {
    expect(decideCreateCommit("  Acme research  ", "enter")).toEqual({
      commit: true,
      name: "Acme research",
    });
  });

  it("commits the default name when Enter is pressed on an empty input", () => {
    expect(decideCreateCommit("", "enter")).toEqual({
      commit: true,
      name: DEFAULT_NOTEBOOK_NAME,
    });
    expect(decideCreateCommit("   ", "enter")).toEqual({
      commit: true,
      name: DEFAULT_NOTEBOOK_NAME,
    });
  });

  it("cancels on Esc (no create) even with text typed", () => {
    expect(decideCreateCommit("Half-typed name", "escape")).toEqual({
      commit: false,
    });
  });

  it("cancels on blur (a blur must never accidentally create)", () => {
    expect(decideCreateCommit("Acme research", "blur")).toEqual({
      commit: false,
    });
    expect(decideCreateCommit("", "blur")).toEqual({ commit: false });
  });

  it("coerces a non-string draft to the default name on Enter", () => {
    expect(decideCreateCommit(undefined, "enter")).toEqual({
      commit: true,
      name: DEFAULT_NOTEBOOK_NAME,
    });
  });
});

describe("decideRenameCommit (inline rename input)", () => {
  it("commits the trimmed name on Enter", () => {
    expect(decideRenameCommit("  New name  ", "enter")).toEqual({
      commit: true,
      name: "New name",
    });
  });

  it("commits on blur (editing existing content commits, like the note draft)", () => {
    expect(decideRenameCommit("New name", "blur")).toEqual({
      commit: true,
      name: "New name",
    });
  });

  it("commits an empty name (the store guards empty; caller just closes)", () => {
    expect(decideRenameCommit("   ", "enter")).toEqual({
      commit: true,
      name: "",
    });
  });

  it("cancels on Esc (keep the current name)", () => {
    expect(decideRenameCommit("New name", "escape")).toEqual({
      commit: false,
    });
  });

  it("coerces a non-string draft to empty on commit", () => {
    expect(decideRenameCommit(undefined, "blur")).toEqual({
      commit: true,
      name: "",
    });
  });
});

describe("commitPageDraft (blur-commit draft pattern)", () => {
  it("writes the draft when it differs from the stored page", () => {
    const store = mockStore("old narrative");
    const wrote = commitPageDraft(store, "new narrative");
    expect(wrote).toBe(true);
    expect(store.page).toBe("new narrative");
  });

  it("does not write when the draft equals the stored page (no thrash)", () => {
    const store = mockStore("same");
    const setPage = vi.spyOn(store, "setPage");
    const wrote = commitPageDraft(store, "same");
    expect(wrote).toBe(false);
    expect(setPage).not.toHaveBeenCalled();
  });

  it("coerces a non-string draft to empty string", () => {
    const store = mockStore("something");
    const wrote = commitPageDraft(store, undefined);
    expect(wrote).toBe(true);
    expect(store.page).toBe("");
  });

  it("flush-on-unmount semantics: a pending edit still commits", () => {
    // Simulate the beforeUnmount path: draft was edited but blur never fired.
    const store = mockStore("");
    const draft = "half-written note that would otherwise be lost";
    const wrote = commitPageDraft(store, draft);
    expect(wrote).toBe(true);
    expect(store.page).toBe(draft);
  });
});

describe("saveViewThroughCell", () => {
  it("rejects a blank name without touching the graph", () => {
    const graph = mockGraph();
    const result = saveViewThroughCell(graph, "   ");
    expect(result).toEqual({ ok: false, reason: "empty-name" });
    expect(graph.saveCalls).toEqual([]);
  });

  it("reports no-graph when there is no mounted canvas (table/code view)", () => {
    expect(saveViewThroughCell(null, "View")).toEqual({
      ok: false,
      reason: "no-graph",
    });
    // A graph-less object (missing the handler) is also a miss.
    expect(saveViewThroughCell({}, "View")).toEqual({
      ok: false,
      reason: "no-graph",
    });
  });

  it("delegates a trimmed name to the graph and succeeds when it saves", () => {
    const graph = mockGraph();
    const result = saveViewThroughCell(graph, "  Ownership chain  ");
    expect(result).toEqual({ ok: true, reason: null });
    expect(graph.saveCalls).toEqual(["Ownership chain"]);
    expect(graph.savedViews).toHaveLength(1);
    expect(graph.savedViews[0].name).toBe("Ownership chain");
  });

  it("reports empty-graph when the canvas has nothing to save", () => {
    const graph = mockGraph({ empty: true });
    const result = saveViewThroughCell(graph, "View");
    expect(result).toEqual({ ok: false, reason: "empty-graph" });
    expect(graph.saveCalls).toEqual(["View"]);
    expect(graph.savedViews).toHaveLength(0);
  });
});

describe("restoreViewThroughCell", () => {
  it("rejects a view without a state code", () => {
    const graph = mockGraph();
    expect(restoreViewThroughCell(graph, null)).toEqual({
      ok: false,
      reason: "no-view",
    });
    expect(restoreViewThroughCell(graph, { name: "x" })).toEqual({
      ok: false,
      reason: "no-view",
    });
    expect(graph.restoreCalls).toEqual([]);
  });

  it("reports no-graph when there is no canvas to restore onto", () => {
    const view = { id: "v1", name: "V", state: "HKS1:stub:Z" };
    expect(restoreViewThroughCell(null, view)).toEqual({
      ok: false,
      reason: "no-graph",
    });
  });

  it("delegates restore of a well-formed view to the graph", () => {
    const graph = mockGraph();
    const view = { id: "v1", name: "Ownership chain", state: "HKS1:stub:Z" };
    const result = restoreViewThroughCell(graph, view);
    expect(result).toEqual({ ok: true, reason: null });
    expect(graph.restoreCalls).toEqual([view]);
  });
});

describe("selectEntityThroughCell", () => {
  it("rejects a malformed target", () => {
    const graph = mockGraph();
    expect(selectEntityThroughCell(graph, null)).toEqual({
      ok: false,
      reason: "no-entity",
    });
    expect(selectEntityThroughCell(graph, { label: "Person" })).toEqual({
      ok: false,
      reason: "no-entity",
    });
    expect(graph.selectCalls).toEqual([]);
  });

  it("reports no-graph when no canvas is mounted", () => {
    expect(selectEntityThroughCell(null, { label: "Person", pk: "p1" })).toEqual({
      ok: false,
      reason: "no-graph",
    });
  });

  it("routes the entity to the graph's pin-navigation handler", () => {
    const graph = mockGraph();
    const result = selectEntityThroughCell(graph, { label: "Person", pk: "p1" });
    expect(result).toEqual({ ok: true, reason: null });
    expect(graph.selectCalls).toEqual([{ label: "Person", pk: "p1" }]);
  });
});

describe("save-view -> restore-view round-trip through the sidebar", () => {
  it("saves the current view and restores the same view via the graph delegate", () => {
    // One graph + a shared savedViews list stands in for the store the
    // ResultGraph handlers write to. Save produces a view; restore hands that
    // exact view back through the cell.
    const savedViews = [];
    const graph = mockGraph({ savedViews });

    const save = saveViewThroughCell(graph, "Beneficial owners");
    expect(save.ok).toBe(true);
    expect(savedViews).toHaveLength(1);

    const view = savedViews[0];
    expect(view.name).toBe("Beneficial owners");

    const restore = restoreViewThroughCell(graph, view);
    expect(restore.ok).toBe(true);
    // The very view that was saved is the one routed back to the cell.
    expect(graph.restoreCalls[0]).toBe(view);
  });
});
