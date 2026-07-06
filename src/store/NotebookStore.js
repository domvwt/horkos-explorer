import { defineStore } from "pinia";

/**
 * Client-side research notebooks.
 *
 * Persists a researcher's working notes ENTIRELY in the browser's
 * localStorage — never server-side. On the stateless public deploy a user's
 * notes are themselves sensitive (they reveal who is researching whom, and may
 * name identifiable people), so they must never leave the browser: there are
 * no network calls in this store, and the export/import escape hatch is a plain
 * local file download / file-picker upload.
 *
 * The unit of work is a single notebook — one research matter. Pins, notes,
 * views and the free-text page of one notebook are kept fully separate from
 * every other notebook, so material from different matters never blends (a
 * disclosure risk when sharing a single notebook's export).
 *
 * Each notebook holds:
 *   - page:       one free-text field for the matter-level narrative, distinct
 *                 from the per-entity notes below.
 *   - pins:       starred entities, keyed "Label|pk" (pk = cluster id).
 *   - notes:      free-text annotations, keyed by the same "Label|pk".
 *   - savedViews: named snapshots of the graph canvas (the same state shape
 *                 ResultGraph.getInvestigationState() produces, plus a layout
 *                 name), restorable later via restoreInvestigationState().
 *
 * Invariant: there is always at least one notebook and always an active one.
 * First load, or a corrupt / unrecognised payload, bootstraps a single empty
 * notebook and makes it active, so the UI never sees a null-active state.
 *
 * Mirrors the localStorage persistence pattern in SettingsStore.js: every
 * mutating action calls persist(), which JSON-serialises the whole store under
 * a single dedicated key.
 */

const STORAGE_KEY = "notebook";
const STATE_VERSION = 1;

const DEFAULT_NOTEBOOK_NAME = "Untitled notebook";

// Cap an imported file so a malformed / hostile upload can't OOM the tab or
// blow the localStorage quota. 5 MB is generous for text notes + a handful of
// saved views while still bounding a pathological file.
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Stable key for an entity across pins/notes: "Label|pk".
 * Matches the createStableKey format used by InvestigationState.js so a pin
 * and a graph node refer to the same entity by the same identifier.
 */
export function entityKey(label, pk) {
  return `${label}|${pk}`;
}

function newId() {
  return crypto.randomUUID();
}

function emptyNotebook(name) {
  const now = Date.now();
  return {
    id: newId(),
    name: typeof name === "string" && name.trim() ? name.trim() : DEFAULT_NOTEBOOK_NAME,
    createdAt: now,
    updatedAt: now,
    page: "",
    pins: {},
    notes: {},
    noteLabels: {},
    savedViews: [],
  };
}

/**
 * Coerce an arbitrary parsed object into a well-formed notebook, dropping
 * anything that doesn't match the expected shape. Used both when hydrating from
 * localStorage and when importing an uploaded file, so a corrupt / hostile
 * payload can never install malformed state. A fresh id is always minted unless
 * `preserveId` is true (hydration keeps stored ids; import mints new ones so an
 * imported notebook can never collide with an existing one).
 */
function sanitizeNotebook(raw, { preserveId = true } = {}) {
  const nb = emptyNotebook();
  if (!raw || typeof raw !== "object") {
    return nb;
  }

  if (preserveId && typeof raw.id === "string" && raw.id) {
    nb.id = raw.id;
  }
  if (typeof raw.name === "string" && raw.name.trim()) {
    nb.name = raw.name.trim();
  }
  if (typeof raw.createdAt === "number") {
    nb.createdAt = raw.createdAt;
  }
  if (typeof raw.updatedAt === "number") {
    nb.updatedAt = raw.updatedAt;
  }
  // Page is free text; keep it a plain string and drop anything else.
  if (typeof raw.page === "string") {
    nb.page = raw.page;
  }

  if (raw.pins && typeof raw.pins === "object") {
    for (const value of Object.values(raw.pins)) {
      if (
        value &&
        typeof value === "object" &&
        typeof value.label === "string" &&
        value.pk != null
      ) {
        const pk = String(value.pk);
        // Re-derive the key from label+pk so pins are always canonically keyed,
        // even if an imported/tampered file used a mismatched object key. This
        // keeps isPinned()/noteFor() lookups reliable after import.
        nb.pins[entityKey(value.label, pk)] = {
          label: value.label,
          pk,
          name: typeof value.name === "string" ? value.name : "",
          pinnedAt: typeof value.pinnedAt === "number" ? value.pinnedAt : 0,
        };
      }
    }
  }

  if (raw.notes && typeof raw.notes === "object") {
    for (const [key, value] of Object.entries(raw.notes)) {
      if (typeof value === "string" && value.length > 0) {
        nb.notes[key] = value;
      }
    }
  }

  // Captured display labels for notes, parallel to nb.notes. Only keep a label
  // whose note survived sanitisation above — a label with no note is orphaned
  // data (e.g. a hand-edited / hostile file) and is dropped.
  if (raw.noteLabels && typeof raw.noteLabels === "object") {
    for (const [key, value] of Object.entries(raw.noteLabels)) {
      if (typeof value === "string" && value.length > 0 && key in nb.notes) {
        nb.noteLabels[key] = value;
      }
    }
  }

  if (Array.isArray(raw.savedViews)) {
    nb.savedViews = raw.savedViews
      .filter((v) => v && typeof v === "object" && typeof v.name === "string" && v.state)
      .map((v) => ({
        // Mint a fresh id for any view without a well-formed one so two
        // same-named views (e.g. from a tampered file) can't collide and get
        // co-deleted.
        id: typeof v.id === "string" && v.id ? v.id : newId(),
        name: v.name,
        savedAt: typeof v.savedAt === "number" ? v.savedAt : 0,
        state: v.state,
      }));
  }

  return nb;
}

/**
 * Coerce a parsed payload into a well-formed store state (notebooks + activeId).
 * Enforces the always-one-active invariant: an empty or unrecognised payload
 * yields a single fresh empty notebook, active.
 */
function sanitizeState(raw) {
  const fallback = () => {
    const nb = emptyNotebook();
    return { notebooks: [nb], activeId: nb.id };
  };

  if (!raw || typeof raw !== "object" || raw.v !== STATE_VERSION) {
    return fallback();
  }
  if (!Array.isArray(raw.notebooks)) {
    return fallback();
  }

  const notebooks = raw.notebooks
    .filter((nb) => nb && typeof nb === "object")
    .map((nb) => sanitizeNotebook(nb, { preserveId: true }));

  if (notebooks.length === 0) {
    return fallback();
  }

  // Guard against duplicate ids surviving from a tampered file: re-mint any
  // collision so activeId resolution and switching stay unambiguous.
  const seen = new Set();
  for (const nb of notebooks) {
    if (seen.has(nb.id)) {
      nb.id = newId();
    }
    seen.add(nb.id);
  }

  const activeId =
    typeof raw.activeId === "string" && notebooks.some((nb) => nb.id === raw.activeId)
      ? raw.activeId
      : notebooks[0].id;

  return { notebooks, activeId };
}

export const useNotebookStore = defineStore("notebook", {
  state: () => {
    const nb = emptyNotebook();
    return {
      notebooks: [nb],
      activeId: nb.id,
    };
  },

  getters: {
    // The currently-active notebook. The invariant guarantees this is never
    // undefined once the store is constructed / loaded.
    activeNotebook(state) {
      return state.notebooks.find((nb) => nb.id === state.activeId) || state.notebooks[0];
    },
    // Notebooks most-recently-updated first, for a switcher.
    notebookList(state) {
      return [...state.notebooks].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    notebookCount(state) {
      return state.notebooks.length;
    },
    // The active notebook's free-text page.
    page() {
      return this.activeNotebook.page || "";
    },
    // Pins newest-first, for list rendering.
    pinnedEntities() {
      return Object.entries(this.activeNotebook.pins)
        .map(([key, pin]) => ({ key, ...pin }))
        .sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
    },
    pinnedCount() {
      return Object.keys(this.activeNotebook.pins).length;
    },
    savedViews() {
      return this.activeNotebook.savedViews;
    },
    savedViewCount() {
      return this.activeNotebook.savedViews.length;
    },
    // Entities that carry a note but are NOT pinned in the active notebook
    // ("orphan notes"). Notes are kept independently of pins, so a note can
    // outlive an unpin or annotate an entity that was never pinned; the sidebar
    // surfaces these so they're never invisible. Each entry decodes the "Label|pk"
    // key back to { key, label, pk, note } so the UI can navigate to the entity.
    // Newest keys aren't tracked per-note, so ordering falls back to label+pk for
    // stability.
    orphanNotes() {
      const nb = this.activeNotebook;
      const pins = nb.pins;
      const noteLabels = nb.noteLabels || {};
      const out = [];
      for (const [key, note] of Object.entries(nb.notes)) {
        if (pins[key]) continue; // pinned — surfaced in the pins list instead
        const sep = key.indexOf("|");
        if (sep === -1) continue; // malformed key; skip defensively
        out.push({
          key,
          label: key.slice(0, sep),
          pk: key.slice(sep + 1),
          name: noteLabels[key] || "",
          note,
        });
      }
      out.sort((a, b) => a.key.localeCompare(b.key));
      return out;
    },
    orphanNoteCount() {
      return this.orphanNotes.length;
    },
    // Reactive predicate: is this entity pinned in the active notebook?
    isPinned() {
      return (label, pk) => Boolean(this.activeNotebook.pins[entityKey(label, pk)]);
    },
    // Reactive accessor: the note text for an entity in the active notebook
    // ("" if none).
    noteFor() {
      return (label, pk) => this.activeNotebook.notes[entityKey(label, pk)] || "";
    },
  },

  actions: {
    /**
     * Hydrate the store from localStorage. Safe to call at app startup;
     * bootstraps a single empty active notebook if nothing is stored or the
     * payload is corrupt / unrecognised. Any payload that doesn't match the
     * expected shape is discarded and the store starts fresh.
     */
    load() {
      let raw = null;
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          raw = JSON.parse(stored);
        }
      } catch (e) {
        // Corrupt localStorage — start clean rather than crash the app.
        raw = null;
      }
      const { notebooks, activeId } = sanitizeState(raw);
      this.notebooks = notebooks;
      this.activeId = activeId;
    },

    /**
     * Persist the whole store to localStorage under the dedicated key. Called by
     * every mutating action. Wrapped so a quota / serialization error degrades
     * gracefully instead of throwing into a UI event handler.
     */
    persist() {
      try {
        const payload = {
          v: STATE_VERSION,
          activeId: this.activeId,
          notebooks: this.notebooks,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (e) {
        // localStorage full or unavailable — nothing else we can safely do.
        console.warn("[NotebookStore] Failed to persist notebooks:", e.message);
      }
    },

    // Internal: bump the active notebook's updatedAt so a switcher can sort by
    // recency. Called from every within-notebook mutation.
    touchActive() {
      const nb = this.activeNotebook;
      if (nb) nb.updatedAt = Date.now();
    },

    // ---- Notebook lifecycle ----------------------------------------------

    /**
     * Create a new empty notebook and switch to it. Returns the new notebook.
     */
    createNotebook(name) {
      const nb = emptyNotebook(name);
      this.notebooks.push(nb);
      this.activeId = nb.id;
      this.persist();
      return nb;
    },

    renameNotebook(id, name) {
      const trimmed = (name || "").trim();
      if (!trimmed) return;
      const nb = this.notebooks.find((n) => n.id === id);
      if (!nb) return;
      nb.name = trimmed;
      nb.updatedAt = Date.now();
      this.persist();
    },

    switchNotebook(id) {
      if (id === this.activeId) return;
      if (!this.notebooks.some((n) => n.id === id)) return;
      this.activeId = id;
      this.persist();
    },

    /**
     * Delete a notebook. Deleting the active one activates another; deleting the
     * last recreates a fresh empty one, preserving the always-one-active
     * invariant.
     */
    deleteNotebook(id) {
      const index = this.notebooks.findIndex((n) => n.id === id);
      if (index === -1) return;
      this.notebooks.splice(index, 1);
      if (this.notebooks.length === 0) {
        const nb = emptyNotebook();
        this.notebooks.push(nb);
        this.activeId = nb.id;
      } else if (this.activeId === id) {
        // Activate the notebook that took the deleted one's slot, or the last.
        const next = this.notebooks[index] || this.notebooks[this.notebooks.length - 1];
        this.activeId = next.id;
      }
      this.persist();
    },

    // ---- Within-notebook mutations (operate on the active notebook) -------

    /**
     * Set the active notebook's free-text page (the matter-level narrative,
     * distinct from per-entity notes).
     */
    setPage(text) {
      const nb = this.activeNotebook;
      nb.page = typeof text === "string" ? text : "";
      this.touchActive();
      this.persist();
    },

    pin(label, pk, name) {
      if (!label || pk == null) return;
      const key = entityKey(label, pk);
      this.activeNotebook.pins[key] = {
        label,
        pk: String(pk),
        name: name || "",
        pinnedAt: Date.now(),
      };
      this.touchActive();
      this.persist();
    },

    unpin(label, pk) {
      const key = entityKey(label, pk);
      const nb = this.activeNotebook;
      if (nb.pins[key]) {
        delete nb.pins[key];
        this.touchActive();
        this.persist();
      }
    },

    togglePin(label, pk, name) {
      if (this.isPinned(label, pk)) {
        this.unpin(label, pk);
      } else {
        this.pin(label, pk, name);
      }
    },

    /**
     * Set (or clear, when text is empty) the note for an entity. Notes are
     * kept independently of pins so a note can annotate an entity that isn't
     * currently pinned, but the UI surfaces them together. `name` is the
     * entity's display label captured at note-creation time (parallel to
     * nb.noteLabels), so the sidebar can show a human-readable caption instead
     * of the raw pk; it's optional and legacy 3-arg callers still work.
     */
    setNote(label, pk, text, name) {
      const key = entityKey(label, pk);
      const trimmed = (text || "").trim();
      const nb = this.activeNotebook;
      if (trimmed) {
        nb.notes[key] = trimmed;
        if (typeof name === "string" && name) {
          nb.noteLabels[key] = name;
        } else {
          // No usable label — clear any stale one so it can't outlive its note.
          delete nb.noteLabels[key];
        }
      } else {
        delete nb.notes[key];
        delete nb.noteLabels[key];
      }
      this.touchActive();
      this.persist();
    },

    /**
     * Save a named snapshot of the current graph canvas. `state` is the share
     * code produced from ResultGraph.getInvestigationState(); node positions
     * are baked into it, so restore reproduces the exact arrangement without
     * needing to store or re-run a layout algorithm.
     */
    saveView(name, state) {
      const trimmed = (name || "").trim();
      if (!trimmed || !state) return null;
      const view = {
        id: newId(),
        name: trimmed,
        savedAt: Date.now(),
        state,
      };
      this.activeNotebook.savedViews.unshift(view);
      this.touchActive();
      this.persist();
      return view;
    },

    removeView(id) {
      const nb = this.activeNotebook;
      const before = nb.savedViews.length;
      nb.savedViews = nb.savedViews.filter((v) => v.id !== id);
      if (nb.savedViews.length !== before) {
        this.touchActive();
        this.persist();
      }
    },

    // ---- Export / import --------------------------------------------------

    /**
     * Serialise the active notebook for JSON export (download). Returns a plain
     * object; the caller stringifies + triggers the file download. Export is
     * per-notebook so sharing one matter never leaks another's notes.
     */
    exportNotebook() {
      const nb = this.activeNotebook;
      return {
        v: STATE_VERSION,
        exportedAt: Date.now(),
        notebook: {
          id: nb.id,
          name: nb.name,
          createdAt: nb.createdAt,
          updatedAt: nb.updatedAt,
          page: nb.page,
          pins: nb.pins,
          notes: nb.notes,
          noteLabels: nb.noteLabels,
          savedViews: nb.savedViews,
        },
      };
    },

    /**
     * Import a notebook from a previously-exported file's text. Validates size
     * and shape, then ADDS it as a NEW notebook and switches to it — import is
     * never a replace, so an existing notebook can never be silently blended or
     * overwritten. A name collision is suffixed "(imported)". Returns
     * { ok, error } so the caller can surface a message.
     */
    importNotebook(text) {
      if (typeof text !== "string") {
        return { ok: false, error: "Nothing to import." };
      }
      // Bound size before parsing so a huge file can't hang the parse.
      const byteLength =
        typeof Blob !== "undefined" ? new Blob([text]).size : text.length;
      if (byteLength > MAX_IMPORT_BYTES) {
        return {
          ok: false,
          error: `File too large (max ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB).`,
        };
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return { ok: false, error: "File is not valid JSON." };
      }

      if (!parsed || typeof parsed !== "object") {
        return { ok: false, error: "File does not contain a notebook." };
      }

      const rawNotebook = parsed.notebook ? parsed.notebook : parsed;
      if (
        typeof rawNotebook !== "object" ||
        (!rawNotebook.pins &&
          !rawNotebook.notes &&
          !rawNotebook.savedViews &&
          typeof rawNotebook.page !== "string")
      ) {
        return { ok: false, error: "File does not contain a notebook." };
      }

      // Mint a fresh id so the imported notebook can never collide with an
      // existing one; sanitise the rest with the same rigour as hydration.
      const nb = sanitizeNotebook(rawNotebook, { preserveId: false });

      // Suffix the name on collision so two same-named notebooks stay
      // distinguishable in a switcher.
      if (this.notebooks.some((n) => n.name === nb.name)) {
        nb.name = `${nb.name} (imported)`;
      }

      this.notebooks.push(nb);
      this.activeId = nb.id;
      this.persist();
      return { ok: true, error: null };
    },

    /**
     * Wipe everything (all notebooks) and start fresh with a single empty active
     * notebook, preserving the always-one-active invariant. A privacy-hygiene
     * escape hatch, distinct from deleting a single notebook.
     */
    wipeAll() {
      const nb = emptyNotebook();
      this.notebooks = [nb];
      this.activeId = nb.id;
      this.persist();
    },
  },
});
