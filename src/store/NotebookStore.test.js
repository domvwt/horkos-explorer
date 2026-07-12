// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useNotebookStore, entityKey } from "./NotebookStore";

const STORAGE_KEY = "notebook";

function freshStore() {
  setActivePinia(createPinia());
  return useNotebookStore();
}

beforeEach(() => {
  localStorage.clear();
});

describe("entityKey", () => {
  it("joins label and pk with a pipe", () => {
    expect(entityKey("Person", "c123")).toBe("Person|c123");
  });
});

describe("bootstrap invariant", () => {
  it("constructs with one active empty notebook", () => {
    const store = freshStore();
    expect(store.notebookCount).toBe(1);
    expect(store.activeNotebook).toBeTruthy();
    expect(store.activeId).toBe(store.activeNotebook.id);
    expect(store.activeNotebook.name).toBe("Untitled notebook");
    expect(store.pinnedCount).toBe(0);
    expect(store.savedViewCount).toBe(0);
    expect(store.page).toBe("");
  });

  it("bootstraps an empty active notebook on an empty localStorage", () => {
    const store = freshStore();
    store.load();
    expect(store.notebookCount).toBe(1);
    expect(store.activeId).toBe(store.activeNotebook.id);
  });

  it("bootstraps an empty active notebook on corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    const store = freshStore();
    store.load();
    expect(store.notebookCount).toBe(1);
    expect(store.activeId).toBe(store.activeNotebook.id);
    expect(store.pinnedCount).toBe(0);
  });

  it("discards an unrecognised payload and starts fresh", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ some: "other shape", notebooks: "not-an-array" })
    );
    const store = freshStore();
    store.load();
    expect(store.notebookCount).toBe(1);
    expect(store.activeNotebook.name).toBe("Untitled notebook");
    expect(store.activeId).toBe(store.activeNotebook.id);
  });

  it("mints uuid ids for notebooks", () => {
    const store = freshStore();
    expect(store.activeNotebook.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

describe("pins", () => {
  it("pins and unpins an entity, reflected in getters", () => {
    const store = freshStore();
    expect(store.isPinned("Company", "c1")).toBe(false);

    store.pin("Company", "c1", "Acme Ltd");
    expect(store.isPinned("Company", "c1")).toBe(true);
    expect(store.pinnedCount).toBe(1);
    expect(store.pinnedEntities[0]).toMatchObject({
      label: "Company",
      pk: "c1",
      name: "Acme Ltd",
    });

    store.unpin("Company", "c1");
    expect(store.isPinned("Company", "c1")).toBe(false);
    expect(store.pinnedCount).toBe(0);
  });

  it("togglePin flips state", () => {
    const store = freshStore();
    store.togglePin("Person", "p1", "Jane");
    expect(store.isPinned("Person", "p1")).toBe(true);
    store.togglePin("Person", "p1", "Jane");
    expect(store.isPinned("Person", "p1")).toBe(false);
  });

  it("coerces numeric pk to a string key so lookups match", () => {
    const store = freshStore();
    store.pin("Company", 42, "Numbered Co");
    expect(store.isPinned("Company", 42)).toBe(true);
    expect(store.isPinned("Company", "42")).toBe(true);
  });

  it("ignores pins with a missing label or pk", () => {
    const store = freshStore();
    store.pin("", "c1", "no-label");
    store.pin("Company", null, "no-pk");
    expect(store.pinnedCount).toBe(0);
  });
});

describe("notes", () => {
  it("sets, updates and clears a note", () => {
    const store = freshStore();
    expect(store.noteFor("Person", "p1")).toBe("");

    store.setNote("Person", "p1", "  suspicious  ");
    expect(store.noteFor("Person", "p1")).toBe("suspicious");

    store.setNote("Person", "p1", "revised");
    expect(store.noteFor("Person", "p1")).toBe("revised");

    store.setNote("Person", "p1", "   ");
    expect(store.noteFor("Person", "p1")).toBe("");
  });

  it("records a captured display name alongside the note", () => {
    const store = freshStore();
    store.setNote("Company", "c1", "flagged", "Acme Ltd");
    expect(store.activeNotebook.noteLabels["Company|c1"]).toBe("Acme Ltd");
  });

  it("works without a name (legacy 3-arg call) and stores no label", () => {
    const store = freshStore();
    store.setNote("Company", "c1", "flagged");
    expect(store.noteFor("Company", "c1")).toBe("flagged");
    expect(store.activeNotebook.noteLabels["Company|c1"]).toBeUndefined();
  });

  it("clearing a note removes both the note and its captured label", () => {
    const store = freshStore();
    store.setNote("Company", "c1", "flagged", "Acme Ltd");
    store.setNote("Company", "c1", "");
    expect(store.noteFor("Company", "c1")).toBe("");
    expect(store.activeNotebook.notes["Company|c1"]).toBeUndefined();
    expect(store.activeNotebook.noteLabels["Company|c1"]).toBeUndefined();
  });

  it("clears a stale label when a note is re-set without a name", () => {
    const store = freshStore();
    store.setNote("Company", "c1", "flagged", "Acme Ltd");
    store.setNote("Company", "c1", "still flagged");
    expect(store.activeNotebook.noteLabels["Company|c1"]).toBeUndefined();
  });
});

describe("saved views", () => {
  it("saves views newest-first and removes by id", () => {
    const store = freshStore();
    const v1 = store.saveView("first", "HKS1:abc:Z");
    const v2 = store.saveView("second", "HKS1:def:Z");
    expect(store.savedViewCount).toBe(2);
    // unshift => newest first
    expect(store.savedViews[0].id).toBe(v2.id);
    expect(store.savedViews[0].name).toBe("second");

    store.removeView(v1.id);
    expect(store.savedViewCount).toBe(1);
    expect(store.savedViews[0].id).toBe(v2.id);
  });

  it("gives saved views uuid ids", () => {
    const store = freshStore();
    const v = store.saveView("first", "HKS1:abc:Z");
    expect(v.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("refuses to save an unnamed or stateless view", () => {
    const store = freshStore();
    expect(store.saveView("", "HKS1:x:Z")).toBeNull();
    expect(store.saveView("named", null)).toBeNull();
    expect(store.savedViewCount).toBe(0);
  });
});

describe("page", () => {
  it("sets and reads the active notebook's page", () => {
    const store = freshStore();
    expect(store.page).toBe("");
    store.setPage("Case narrative goes here.");
    expect(store.page).toBe("Case narrative goes here.");
    expect(store.activeNotebook.page).toBe("Case narrative goes here.");
  });

  it("coerces a non-string page to an empty string", () => {
    const store = freshStore();
    store.setPage(12345);
    expect(store.page).toBe("");
  });
});

describe("updatedAt tracking", () => {
  it("bumps the active notebook's updatedAt on mutation", async () => {
    const store = freshStore();
    const before = store.activeNotebook.updatedAt;
    // Ensure the clock advances.
    await new Promise((r) => setTimeout(r, 2));
    store.pin("Company", "c1", "Acme");
    expect(store.activeNotebook.updatedAt).toBeGreaterThan(before);
  });
});

describe("notebook lifecycle", () => {
  it("creates a notebook and switches to it", () => {
    const store = freshStore();
    const first = store.activeId;
    const nb = store.createNotebook("Matter B");
    expect(store.notebookCount).toBe(2);
    expect(store.activeId).toBe(nb.id);
    expect(store.activeId).not.toBe(first);
    expect(store.activeNotebook.name).toBe("Matter B");
  });

  it("renames a notebook", () => {
    const store = freshStore();
    const id = store.activeId;
    store.renameNotebook(id, "Renamed");
    expect(store.activeNotebook.name).toBe("Renamed");
  });

  it("switches between notebooks", () => {
    const store = freshStore();
    const a = store.activeId;
    const b = store.createNotebook("B");
    store.switchNotebook(a);
    expect(store.activeId).toBe(a);
    store.switchNotebook(b.id);
    expect(store.activeId).toBe(b.id);
  });

  it("ignores renames with a blank name or unknown id", () => {
    const store = freshStore();
    const id = store.activeId;
    store.renameNotebook(id, "   ");
    expect(store.activeNotebook.name).toBe("Untitled notebook");
    store.renameNotebook("no-such-id", "Ghost");
    expect(store.notebooks.some((n) => n.name === "Ghost")).toBe(false);
  });

  it("ignores a switch to an unknown or already-active notebook id", () => {
    const store = freshStore();
    const a = store.activeId;
    store.switchNotebook("no-such-id");
    expect(store.activeId).toBe(a);
    store.switchNotebook(a);
    expect(store.activeId).toBe(a);
    // Both are early returns: nothing was persisted.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("lists notebooks most-recently-updated first", async () => {
    const store = freshStore();
    const a = store.activeId;
    store.createNotebook("B");
    // Ensure the clock advances, then mutate the older notebook.
    await new Promise((r) => setTimeout(r, 2));
    store.switchNotebook(a);
    store.pin("Company", "c1", "Acme");
    expect(store.notebookList[0].id).toBe(a);
  });

  it("activates another notebook when the active one is deleted", () => {
    const store = freshStore();
    const a = store.activeId;
    const b = store.createNotebook("B");
    expect(store.activeId).toBe(b.id);
    store.deleteNotebook(b.id);
    expect(store.notebookCount).toBe(1);
    expect(store.activeId).toBe(a);
  });

  it("recreates a fresh empty notebook when the last one is deleted", () => {
    const store = freshStore();
    const only = store.activeId;
    store.pin("Company", "c1", "Acme");
    store.deleteNotebook(only);
    // Invariant: still exactly one active, empty notebook.
    expect(store.notebookCount).toBe(1);
    expect(store.activeId).toBe(store.activeNotebook.id);
    expect(store.activeId).not.toBe(only);
    expect(store.pinnedCount).toBe(0);
  });
});

describe("multi-notebook isolation", () => {
  it("keeps pins, notes and views separate per notebook", () => {
    const store = freshStore();
    store.pin("Person", "p1", "Jane");
    store.setNote("Person", "p1", "note in A");
    store.saveView("view-a", "HKS1:a:Z");

    store.createNotebook("B");
    // The new notebook starts clean.
    expect(store.isPinned("Person", "p1")).toBe(false);
    expect(store.noteFor("Person", "p1")).toBe("");
    expect(store.savedViewCount).toBe(0);

    // Same entity can be pinned independently in B.
    store.pin("Person", "p1", "Jane");
    store.setNote("Person", "p1", "note in B");
    expect(store.noteFor("Person", "p1")).toBe("note in B");
  });

  it("does not blend collections across notebooks after switching back", () => {
    const store = freshStore();
    const a = store.activeId;
    store.pin("Company", "c1", "Acme");

    store.createNotebook("B");
    store.pin("Company", "c2", "Other");

    store.switchNotebook(a);
    expect(store.isPinned("Company", "c1")).toBe(true);
    expect(store.isPinned("Company", "c2")).toBe(false);
    expect(store.pinnedCount).toBe(1);
  });
});

describe("localStorage persistence", () => {
  it("persists mutations and rehydrates via load()", () => {
    const store = freshStore();
    store.pin("Company", "c1", "Acme");
    store.setNote("Company", "c1", "flagged");
    store.setPage("narrative");
    store.saveView("view-a", "HKS1:code:Z");
    store.createNotebook("Matter B");
    const activeId = store.activeId;

    // Fresh store instance, same localStorage → load() restores everything.
    const reloaded = freshStore();
    reloaded.load();
    expect(reloaded.notebookCount).toBe(2);
    expect(reloaded.activeId).toBe(activeId);
    // Switch to the first notebook and confirm its data survived.
    const first = reloaded.notebooks.find((n) => n.name === "Untitled notebook");
    reloaded.switchNotebook(first.id);
    expect(reloaded.isPinned("Company", "c1")).toBe(true);
    expect(reloaded.noteFor("Company", "c1")).toBe("flagged");
    expect(reloaded.page).toBe("narrative");
    expect(reloaded.savedViewCount).toBe(1);
  });

  it("guards a quota failure: warns, never throws, and latches storageFullNotice once per session", () => {
    const store = freshStore();
    // happy-dom's localStorage is a Proxy whose ClassMethodBinder copies each
    // accessed method onto the instance on first use, so a prototype-level spy
    // stops taking effect after the first real setItem call in the file — spy
    // on the instance itself.
    const setItemSpy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(store.storageFullNotice).toBe(false);
    // A mutation that persists must not throw into the caller despite the
    // localStorage write failing.
    expect(() => store.pin("Company", "c1", "Acme")).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(store.storageFullNotice).toBe(true);

    // A second failure on a fresh store instance (new Pinia state) does not
    // re-latch — the flag is session-scoped (module-level), not per-store, so
    // a run of failed mutations only ever warns the UI once.
    const secondStore = freshStore();
    expect(secondStore.storageFullNotice).toBe(false);
    expect(() => secondStore.setNote("Person", "p1", "note")).not.toThrow();
    expect(secondStore.storageFullNotice).toBe(false);

    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe("export / import", () => {
  it("round-trips the active notebook through export/import", () => {
    const store = freshStore();
    store.pin("Person", "p1", "Jane");
    store.setNote("Person", "p1", "watch this one");
    store.setPage("the story so far");
    store.saveView("v", "HKS1:code:Z");

    const exported = store.exportNotebook();
    const json = JSON.stringify(exported);

    const target = freshStore();
    const result = target.importNotebook(json);
    expect(result.ok).toBe(true);
    // Import is additive: a fresh store starts with one notebook, now two.
    expect(target.notebookCount).toBe(2);
    // The imported notebook is active.
    expect(target.isPinned("Person", "p1")).toBe(true);
    expect(target.noteFor("Person", "p1")).toBe("watch this one");
    expect(target.page).toBe("the story so far");
    expect(target.savedViewCount).toBe(1);
  });

  it("import is additive and never replaces existing notebooks", () => {
    const store = freshStore();
    store.pin("Company", "c1", "Exported Co");
    const json = JSON.stringify(store.exportNotebook());

    const target = freshStore();
    target.pin("Company", "c99", "Pre-existing");
    const preExistingActive = target.activeId;
    target.importNotebook(json);

    expect(target.notebookCount).toBe(2);
    // Imported notebook is active and holds the exported pin.
    expect(target.isPinned("Company", "c1")).toBe(true);
    // The pre-existing notebook is untouched and retrievable.
    target.switchNotebook(preExistingActive);
    expect(target.isPinned("Company", "c99")).toBe(true);
    expect(target.isPinned("Company", "c1")).toBe(false);
  });

  it("suffixes the name on a collision so notebooks stay distinguishable", () => {
    const store = freshStore();
    store.renameNotebook(store.activeId, "Matter X");
    const json = JSON.stringify(store.exportNotebook());
    // Import into a store that already has a "Matter X".
    store.importNotebook(json);
    expect(store.activeNotebook.name).toBe("Matter X (imported)");
  });

  it("mints a fresh id for the imported notebook so it can't collide", () => {
    const store = freshStore();
    const json = JSON.stringify(store.exportNotebook());
    const originalId = store.activeNotebook.id;
    store.importNotebook(json);
    // Two distinct notebooks even though the export carried the original id.
    expect(store.notebookCount).toBe(2);
    const ids = store.notebooks.map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
    expect(store.activeNotebook.id).not.toBe(originalId);
  });

  it("rejects non-JSON input", () => {
    const store = freshStore();
    const result = store.importNotebook("this is not json");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not valid JSON/i);
  });

  it("rejects a JSON file that is not a notebook", () => {
    const store = freshStore();
    const result = store.importNotebook(JSON.stringify({ hello: "world" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/notebook/i);
  });

  it("rejects an envelope whose notebook carries no notebook fields", () => {
    const store = freshStore();
    const result = store.importNotebook(JSON.stringify({ v: 1, notebook: {} }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/notebook/i);
    expect(store.notebookCount).toBe(1);
  });

  it("rejects an over-cap file before parsing", () => {
    const store = freshStore();
    // Just over the 5 MB cap.
    const huge = "x".repeat(5 * 1024 * 1024 + 10);
    const result = store.importNotebook(huge);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it("accepts a bare notebook payload without the envelope", () => {
    const store = freshStore();
    const bare = { page: "loose page", pins: {}, notes: {}, savedViews: [] };
    const result = store.importNotebook(JSON.stringify(bare));
    expect(result.ok).toBe(true);
    expect(store.page).toBe("loose page");
  });
});

describe("hostile-file sanitisation", () => {
  it("gives same-named id-less imported views distinct ids so removeView is precise", () => {
    const store = freshStore();
    const dirty = {
      notebook: {
        savedViews: [
          { name: "dup", state: "HKS1:a:Z" },
          { name: "dup", state: "HKS1:b:Z" },
        ],
      },
    };
    store.importNotebook(JSON.stringify(dirty));
    expect(store.savedViewCount).toBe(2);
    const ids = store.savedViews.map((v) => v.id);
    expect(new Set(ids).size).toBe(2);
    // Removing one leaves the other intact (no id collision co-delete).
    store.removeView(ids[0]);
    expect(store.savedViewCount).toBe(1);
  });

  it("drops malformed entries inside a valid notebook envelope", () => {
    const store = freshStore();
    const dirty = {
      notebook: {
        page: "a real page",
        pins: {
          good: { label: "Person", pk: "p1", name: "Jane", pinnedAt: 1 },
          bad: { pk: "no-label" }, // missing label → dropped
          alsoBad: "not an object", // wrong type → dropped
        },
        notes: {
          keep: "real note",
          drop: 12345, // non-string → dropped
        },
        savedViews: [
          { name: "ok", state: "HKS1:c:Z" },
          { name: "missing-state" }, // no state → dropped
          "garbage", // wrong type → dropped
        ],
      },
    };
    const result = store.importNotebook(JSON.stringify(dirty));
    expect(result.ok).toBe(true);
    expect(store.pinnedCount).toBe(1);
    expect(store.isPinned("Person", "p1")).toBe(true);
    expect(Object.keys(store.activeNotebook.notes)).toEqual(["keep"]);
    expect(store.savedViewCount).toBe(1);
    expect(store.page).toBe("a real page");
  });

  it("coerces a non-string page to an empty string on import", () => {
    const store = freshStore();
    const dirty = { notebook: { page: { not: "a string" }, pins: {} } };
    store.importNotebook(JSON.stringify(dirty));
    expect(store.page).toBe("");
  });

  it("re-derives canonical keys for mis-keyed pins on import", () => {
    const store = freshStore();
    const dirty = {
      notebook: {
        pins: {
          "wrong-key": { label: "Company", pk: "c7", name: "Acme" },
        },
      },
    };
    store.importNotebook(JSON.stringify(dirty));
    expect(store.isPinned("Company", "c7")).toBe(true);
    expect(Object.keys(store.activeNotebook.pins)).toEqual(["Company|c7"]);
  });
});

describe("wipeAll", () => {
  it("wipes every notebook and leaves one fresh active notebook", () => {
    const store = freshStore();
    store.pin("Company", "c1", "Acme");
    store.setPage("narrative");
    store.createNotebook("B");
    store.pin("Company", "c2", "Other");
    expect(store.notebookCount).toBe(2);

    store.wipeAll();
    expect(store.notebookCount).toBe(1);
    expect(store.activeId).toBe(store.activeNotebook.id);
    expect(store.pinnedCount).toBe(0);
    expect(store.page).toBe("");
    expect(store.activeNotebook.name).toBe("Untitled notebook");
  });
});

describe("orphanNotes", () => {
  it("is empty when there are no notes", () => {
    const store = freshStore();
    expect(store.orphanNotes).toEqual([]);
    expect(store.orphanNoteCount).toBe(0);
  });

  it("excludes notes whose entity is pinned", () => {
    const store = freshStore();
    store.pin("Person", "p1", "Alice");
    store.setNote("Person", "p1", "pinned note");
    expect(store.orphanNotes).toEqual([]);
    expect(store.orphanNoteCount).toBe(0);
  });

  it("surfaces a note on an unpinned entity, decoding label and pk", () => {
    const store = freshStore();
    store.setNote("Company", "c9", "look into this shell");
    expect(store.orphanNoteCount).toBe(1);
    expect(store.orphanNotes).toEqual([
      { key: "Company|c9", label: "Company", pk: "c9", name: "", note: "look into this shell" },
    ]);
  });

  it("surfaces the captured display name when one was recorded", () => {
    const store = freshStore();
    store.setNote("Company", "c9", "look into this shell", "Shell Holdings Ltd");
    expect(store.orphanNotes[0].name).toBe("Shell Holdings Ltd");
  });

  it("falls back to an empty name for a legacy note with no captured label", () => {
    const store = freshStore();
    store.setNote("Company", "c9", "look into this shell");
    expect(store.orphanNotes[0].name).toBe("");
  });

  it("keeps orphan membership correct as a noted entity is pinned then unpinned", () => {
    const store = freshStore();
    store.setNote("Person", "p2", "watch", "Bob Smith");
    expect(store.orphanNoteCount).toBe(1);
    expect(store.orphanNotes[0].name).toBe("Bob Smith");
    store.pin("Person", "p2", "Bob Smith");
    expect(store.orphanNoteCount).toBe(0);
    store.unpin("Person", "p2");
    expect(store.orphanNoteCount).toBe(1);
    expect(store.orphanNotes[0].name).toBe("Bob Smith");
  });

  it("round-trips the captured name through export/import", () => {
    const store = freshStore();
    store.setNote("Company", "c9", "look into this shell", "Shell Holdings Ltd");
    const exported = store.exportNotebook();
    expect(exported.notebook.noteLabels["Company|c9"]).toBe("Shell Holdings Ltd");

    const target = freshStore();
    const result = target.importNotebook(JSON.stringify(exported));
    expect(result.ok).toBe(true);
    expect(target.orphanNotes[0].name).toBe("Shell Holdings Ltd");
  });

  it("drops a stored noteLabels entry with no matching note on load", () => {
    const store = freshStore();
    const id = store.activeNotebook.id;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        activeId: id,
        notebooks: [
          {
            id,
            name: "N",
            page: "",
            pins: {},
            notes: { "Company|c1": "kept" },
            // Orphan label: no note at this key → dropped on load.
            noteLabels: { "Company|c1": "Kept Co", "Company|ghost": "Ghost Co" },
            savedViews: [],
          },
        ],
      })
    );
    const reloaded = freshStore();
    reloaded.load();
    expect(reloaded.activeNotebook.noteLabels["Company|c1"]).toBe("Kept Co");
    expect(reloaded.activeNotebook.noteLabels["Company|ghost"]).toBeUndefined();
  });

  it("moves a note between pinned and orphan as the pin toggles", () => {
    const store = freshStore();
    store.setNote("Person", "p2", "watch");
    expect(store.orphanNoteCount).toBe(1);
    store.pin("Person", "p2", "Bob");
    expect(store.orphanNoteCount).toBe(0);
    store.unpin("Person", "p2");
    expect(store.orphanNoteCount).toBe(1);
    expect(store.orphanNotes[0].pk).toBe("p2");
  });

  it("returns orphan notes sorted stably by key", () => {
    const store = freshStore();
    store.setNote("Person", "p3", "n3");
    store.setNote("Company", "c1", "n1");
    store.setNote("Address", "a2", "n2");
    expect(store.orphanNotes.map((o) => o.key)).toEqual([
      "Address|a2",
      "Company|c1",
      "Person|p3",
    ]);
  });

  it("is per-notebook: orphan notes don't bleed across notebooks", () => {
    const store = freshStore();
    store.setNote("Company", "c1", "matter A note");
    expect(store.orphanNoteCount).toBe(1);
    store.createNotebook("B");
    expect(store.orphanNoteCount).toBe(0);
  });
});
