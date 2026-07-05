// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useInvestigationStore, entityKey } from "./InvestigationStore";

const STORAGE_KEY = "investigation";

function freshStore() {
  setActivePinia(createPinia());
  return useInvestigationStore();
}

beforeEach(() => {
  localStorage.clear();
});

describe("entityKey", () => {
  it("joins label and pk with a pipe", () => {
    expect(entityKey("Person", "c123")).toBe("Person|c123");
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

  it("coerces a numeric pk to a string key so lookups match", () => {
    const store = freshStore();
    store.pin("Company", 42, "Numbered Co");
    // Looking up with either a number or a string finds the same pin.
    expect(store.isPinned("Company", 42)).toBe(true);
    expect(store.isPinned("Company", "42")).toBe(true);
  });

  it("ignores a pin with no label or pk", () => {
    const store = freshStore();
    store.pin("", "c1", "x");
    store.pin("Company", null, "x");
    expect(store.pinnedCount).toBe(0);
  });
});

describe("notes", () => {
  it("sets, updates, and clears a note", () => {
    const store = freshStore();
    store.setNote("Person", "p1", "  suspicious  ");
    // Trimmed on store.
    expect(store.noteFor("Person", "p1")).toBe("suspicious");

    store.setNote("Person", "p1", "director of shell co");
    expect(store.noteFor("Person", "p1")).toBe("director of shell co");

    // Empty text removes the note.
    store.setNote("Person", "p1", "   ");
    expect(store.noteFor("Person", "p1")).toBe("");
  });
});

describe("saved views", () => {
  it("saves newest-first and removes by id", () => {
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

  it("refuses to save an unnamed or stateless view", () => {
    const store = freshStore();
    expect(store.saveView("", "HKS1:x:Z")).toBeNull();
    expect(store.saveView("named", null)).toBeNull();
    expect(store.savedViewCount).toBe(0);
  });
});

describe("localStorage persistence", () => {
  it("persists mutations and rehydrates via load()", () => {
    const store = freshStore();
    store.pin("Company", "c1", "Acme");
    store.setNote("Company", "c1", "flagged");
    store.saveView("view-a", "HKS1:code:Z");

    // Fresh store instance, same localStorage → load() restores everything.
    const reloaded = freshStore();
    reloaded.load();
    expect(reloaded.isPinned("Company", "c1")).toBe(true);
    expect(reloaded.noteFor("Company", "c1")).toBe("flagged");
    expect(reloaded.savedViewCount).toBe(1);
  });

  it("starts empty when localStorage holds corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    const store = freshStore();
    store.load();
    expect(store.pinnedCount).toBe(0);
    expect(store.savedViewCount).toBe(0);
  });
});

describe("export / import", () => {
  it("round-trips through exportLog/importLog", () => {
    const store = freshStore();
    store.pin("Person", "p1", "Jane");
    store.setNote("Person", "p1", "note text");
    store.saveView("v", "HKS1:code:Z");

    const exported = store.exportLog();
    const json = JSON.stringify(exported);

    const target = freshStore();
    const result = target.importLog(json);
    expect(result.ok).toBe(true);
    expect(target.isPinned("Person", "p1")).toBe(true);
    expect(target.noteFor("Person", "p1")).toBe("note text");
    expect(target.savedViewCount).toBe(1);
  });

  it("import replaces (does not merge) existing state", () => {
    const store = freshStore();
    store.pin("Company", "old", "Old Co");
    const exported = JSON.stringify(store.exportLog());

    const target = freshStore();
    target.pin("Company", "existing", "Existing Co");
    target.importLog(exported);
    // The pre-existing pin is gone; only the imported one remains.
    expect(target.isPinned("Company", "existing")).toBe(false);
    expect(target.isPinned("Company", "old")).toBe(true);
    expect(target.pinnedCount).toBe(1);
  });

  it("rejects non-JSON input", () => {
    const store = freshStore();
    const result = store.importLog("this is not json");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not valid json/i);
  });

  it("rejects JSON that is not an investigation log", () => {
    const store = freshStore();
    const result = store.importLog(JSON.stringify({ some: "other", data: 1 }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/investigation log/i);
  });

  it("rejects an oversized file before parsing", () => {
    const store = freshStore();
    // Just over the 5 MB cap.
    const huge = "x".repeat(5 * 1024 * 1024 + 10);
    const result = store.importLog(huge);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it("gives same-named id-less imported views distinct ids so removeView is precise", () => {
    const store = freshStore();
    const dirty = {
      log: {
        savedViews: [
          { name: "dup", state: "HKS1:a:Z" },
          { name: "dup", state: "HKS1:b:Z" },
        ],
      },
    };
    store.importLog(JSON.stringify(dirty));
    expect(store.savedViewCount).toBe(2);
    const ids = store.savedViews.map((v) => v.id);
    expect(new Set(ids).size).toBe(2);
    // Removing one leaves the other intact (no id collision co-delete).
    store.removeView(ids[0]);
    expect(store.savedViewCount).toBe(1);
  });

  it("sanitizes malformed entries inside a valid log envelope", () => {
    const store = freshStore();
    const dirty = {
      log: {
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
    const result = store.importLog(JSON.stringify(dirty));
    expect(result.ok).toBe(true);
    expect(store.pinnedCount).toBe(1);
    expect(store.isPinned("Person", "p1")).toBe(true);
    expect(Object.keys(store.notes)).toEqual(["keep"]);
    expect(store.savedViewCount).toBe(1);
  });
});

describe("clearAll", () => {
  it("wipes all collections", () => {
    const store = freshStore();
    store.pin("Company", "c1", "Acme");
    store.setNote("Company", "c1", "note");
    store.saveView("v", "HKS1:c:Z");
    store.clearAll();
    expect(store.pinnedCount).toBe(0);
    expect(Object.keys(store.notes).length).toBe(0);
    expect(store.savedViewCount).toBe(0);
  });
});
