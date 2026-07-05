import { defineStore } from "pinia";

/**
 * Client-side investigation log.
 *
 * Persists an investigator's working notes ENTIRELY in the browser's
 * localStorage — never server-side. On the stateless public deploy a user's
 * investigation log is itself sensitive (it reveals who is investigating
 * whom), so it must never leave the browser: there are no network calls in
 * this store, and the export/import escape hatch is a plain local file
 * download / file-picker upload.
 *
 * Holds three collections:
 *   - pins:       starred entities, keyed "Label|pk" (pk = cluster id).
 *   - notes:      free-text annotations, keyed by the same "Label|pk".
 *   - savedViews: named snapshots of the graph canvas (the same state shape
 *                 ResultGraph.getInvestigationState() produces, plus a layout
 *                 name), restorable later via restoreInvestigationState().
 *
 * Mirrors the localStorage persistence pattern in SettingsStore.js: every
 * mutating action calls persist(), which JSON-serialises the whole log under
 * a single dedicated key.
 */

const STORAGE_KEY = "investigation";
const STATE_VERSION = 1;

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

function emptyLog() {
  return { pins: {}, notes: {}, savedViews: [] };
}

/**
 * Coerce an arbitrary parsed object into a well-formed log, dropping anything
 * that doesn't match the expected shape. Used both when hydrating from
 * localStorage and when importing an uploaded file, so a corrupt/hostile
 * payload can never install malformed state.
 */
function sanitizeLog(raw) {
  const log = emptyLog();
  if (!raw || typeof raw !== "object") {
    return log;
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
        log.pins[entityKey(value.label, pk)] = {
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
        log.notes[key] = value;
      }
    }
  }

  if (Array.isArray(raw.savedViews)) {
    log.savedViews = raw.savedViews
      .filter((v) => v && typeof v === "object" && typeof v.name === "string" && v.state)
      .map((v, index) => ({
        // Fall back to an index-qualified id so two same-named views with no
        // id (e.g. from a tampered file) don't collide and get co-deleted.
        id: typeof v.id === "string" && v.id ? v.id : `view-${index}-${v.name}`,
        name: v.name,
        savedAt: typeof v.savedAt === "number" ? v.savedAt : 0,
        state: v.state,
      }));
  }

  return log;
}

export const useInvestigationStore = defineStore("investigation", {
  state: () => ({
    pins: {},
    notes: {},
    savedViews: [],
  }),

  getters: {
    // Pins newest-first, for list rendering.
    pinnedEntities(state) {
      return Object.entries(state.pins)
        .map(([key, pin]) => ({ key, ...pin }))
        .sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
    },
    pinnedCount(state) {
      return Object.keys(state.pins).length;
    },
    savedViewCount(state) {
      return state.savedViews.length;
    },
    // Reactive predicate: is this entity pinned?
    isPinned(state) {
      return (label, pk) => Boolean(state.pins[entityKey(label, pk)]);
    },
    // Reactive accessor: the note text for an entity ("" if none).
    noteFor(state) {
      return (label, pk) => state.notes[entityKey(label, pk)] || "";
    },
  },

  actions: {
    /**
     * Hydrate the store from localStorage. Safe to call at app startup;
     * silently starts empty if nothing is stored or the payload is corrupt.
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
      const log = sanitizeLog(raw && raw.log ? raw.log : raw);
      this.pins = log.pins;
      this.notes = log.notes;
      this.savedViews = log.savedViews;
    },

    /**
     * Persist the whole log to localStorage under the dedicated key. Called by
     * every mutating action. Wrapped so a quota / serialization error degrades
     * gracefully instead of throwing into a UI event handler.
     */
    persist() {
      try {
        const payload = {
          v: STATE_VERSION,
          log: { pins: this.pins, notes: this.notes, savedViews: this.savedViews },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (e) {
        // localStorage full or unavailable — nothing else we can safely do.
        console.warn("[InvestigationStore] Failed to persist investigation log:", e.message);
      }
    },

    pin(label, pk, name) {
      if (!label || pk == null) return;
      const key = entityKey(label, pk);
      this.pins[key] = {
        label,
        pk: String(pk),
        name: name || "",
        pinnedAt: Date.now(),
      };
      this.persist();
    },

    unpin(label, pk) {
      const key = entityKey(label, pk);
      if (this.pins[key]) {
        delete this.pins[key];
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
     * currently pinned, but the UI surfaces them together.
     */
    setNote(label, pk, text) {
      const key = entityKey(label, pk);
      const trimmed = (text || "").trim();
      if (trimmed) {
        this.notes[key] = trimmed;
      } else {
        delete this.notes[key];
      }
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
        id: `${trimmed}-${Date.now()}`,
        name: trimmed,
        savedAt: Date.now(),
        state,
      };
      this.savedViews.unshift(view);
      this.persist();
      return view;
    },

    removeView(id) {
      const before = this.savedViews.length;
      this.savedViews = this.savedViews.filter((v) => v.id !== id);
      if (this.savedViews.length !== before) {
        this.persist();
      }
    },

    /**
     * Serialise the whole log for JSON export (download). Returns a plain
     * object; the caller stringifies + triggers the file download.
     */
    exportLog() {
      return {
        v: STATE_VERSION,
        exportedAt: Date.now(),
        log: { pins: this.pins, notes: this.notes, savedViews: this.savedViews },
      };
    },

    /**
     * Import a log from a previously-exported file's text. Validates size and
     * shape, then REPLACES the current log (import is a restore, not a merge —
     * a merge would silently blend two investigations). Returns
     * { ok, error } so the caller can surface a message.
     */
    importLog(text) {
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
        return { ok: false, error: "File does not contain an investigation log." };
      }

      const rawLog = parsed.log ? parsed.log : parsed;
      if (
        typeof rawLog !== "object" ||
        (!rawLog.pins && !rawLog.notes && !rawLog.savedViews)
      ) {
        return { ok: false, error: "File does not contain an investigation log." };
      }

      const log = sanitizeLog(rawLog);
      this.pins = log.pins;
      this.notes = log.notes;
      this.savedViews = log.savedViews;
      this.persist();
      return { ok: true, error: null };
    },

    /**
     * Wipe the whole investigation log (pins, notes, saved views) and clear it
     * from localStorage.
     */
    clearAll() {
      this.pins = {};
      this.notes = {};
      this.savedViews = [];
      this.persist();
    },
  },
});
