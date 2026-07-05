<template>
  <div
    class="notebook-sidebar"
    :class="{ 'notebook-sidebar--expanded': expanded, 'notebook-sidebar--collapsed': !expanded }"
  >
    <!-- Collapsed icon rail -->
    <div
      v-if="!expanded"
      class="notebook-sidebar__rail"
    >
      <button
        class="notebook-sidebar__rail-btn"
        :title="`Open notebook — ${activeName}`"
        @click="expand"
      >
        <i class="fa-solid fa-book" />
        <span
          v-if="notebookStore.pinnedCount > 0"
          class="notebook-sidebar__rail-badge"
        >{{ notebookStore.pinnedCount }}</span>
      </button>
      <button
        class="notebook-sidebar__rail-chevron"
        title="Expand notebook"
        @click="expand"
      >
        <i class="fa-solid fa-angle-right" />
      </button>
    </div>

    <!-- Expanded panel -->
    <div
      v-else
      class="notebook-sidebar__panel"
    >
      <div class="notebook-sidebar__panel-header">
        <h6>
          <i class="fa-solid fa-book" />
          Notebook
        </h6>
        <button
          class="notebook-sidebar__icon-btn"
          title="Collapse notebook"
          @click="collapse"
        >
          <i class="fa-solid fa-angles-left" />
        </button>
      </div>

      <div class="notebook-sidebar__scroll">
        <!-- Notebook switcher -->
        <div class="notebook-sidebar__section">
          <div class="notebook-sidebar__switcher-row">
            <select
              class="form-select form-select-sm"
              :value="notebookStore.activeId"
              title="Switch notebook"
              @change="onSwitch($event.target.value)"
            >
              <option
                v-for="nb in notebookStore.notebookList"
                :key="nb.id"
                :value="nb.id"
              >
                {{ nb.name }}
              </option>
            </select>
          </div>
          <div class="notebook-sidebar__switcher-actions">
            <button
              class="btn btn-sm btn-outline-secondary"
              title="Create a new notebook"
              @click="onNewNotebook"
            >
              <i class="fa-solid fa-plus" /> New
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              title="Rename this notebook"
              @click="onRenameNotebook"
            >
              <i class="fa-solid fa-pen" /> Rename
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              title="Delete this notebook"
              @click="onDeleteNotebook"
            >
              <i class="fa-solid fa-trash" /> Delete
            </button>
          </div>
        </div>

        <!-- Notebook page (matter-level narrative) -->
        <div class="notebook-sidebar__section">
          <div class="notebook-sidebar__section-title">
            Page
          </div>
          <textarea
            v-model="pageDraft"
            class="form-control form-control-sm notebook-sidebar__page"
            rows="5"
            placeholder="Write your research narrative for this notebook…"
            @blur="commitPage"
          />
          <small
            v-if="pageDirty"
            class="notebook-sidebar__hint"
          >Unsaved — click away to save</small>
        </div>

        <!-- Pinned entities -->
        <div class="notebook-sidebar__section">
          <div class="notebook-sidebar__section-title">
            Pinned entities
            <span class="badge">{{ notebookStore.pinnedCount }}</span>
          </div>
          <p
            v-if="notebookStore.pinnedCount === 0"
            class="notebook-sidebar__empty"
          >
            No pinned entities. Select a node and click <strong>Pin</strong> to add it.
          </p>
          <ul
            v-else
            class="notebook-sidebar__list"
          >
            <li
              v-for="pin in notebookStore.pinnedEntities"
              :key="pin.key"
              class="notebook-sidebar__entity"
            >
              <button
                class="notebook-sidebar__entity-name"
                :title="`Select ${pin.name || pin.pk}`"
                @click="selectEntity(pin.label, pin.pk)"
              >
                <span class="notebook-sidebar__entity-type">{{ pin.label }}</span>
                {{ pin.name || pin.pk }}
                <span
                  v-if="noteFor(pin.label, pin.pk)"
                  class="notebook-sidebar__note-preview"
                >{{ notePreview(noteFor(pin.label, pin.pk)) }}</span>
              </button>
              <button
                class="notebook-sidebar__icon-btn"
                title="Unpin"
                @click="notebookStore.unpin(pin.label, pin.pk)"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </li>
          </ul>
        </div>

        <!-- Noted-but-unpinned entities (orphan notes) -->
        <div
          v-if="notebookStore.orphanNoteCount > 0"
          class="notebook-sidebar__section"
        >
          <div class="notebook-sidebar__section-title">
            Noted entities
            <span class="badge">{{ notebookStore.orphanNoteCount }}</span>
          </div>
          <ul class="notebook-sidebar__list">
            <li
              v-for="orphan in notebookStore.orphanNotes"
              :key="orphan.key"
              class="notebook-sidebar__entity"
            >
              <button
                class="notebook-sidebar__entity-name"
                :title="`Select ${orphan.pk}`"
                @click="selectEntity(orphan.label, orphan.pk)"
              >
                <span class="notebook-sidebar__entity-type">{{ orphan.label }}</span>
                {{ orphan.pk }}
                <span class="notebook-sidebar__note-preview">{{ notePreview(orphan.note) }}</span>
              </button>
              <button
                class="notebook-sidebar__icon-btn"
                title="Remove this note"
                @click="notebookStore.setNote(orphan.label, orphan.pk, '')"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </li>
          </ul>
        </div>

        <!-- Saved views -->
        <div class="notebook-sidebar__section">
          <div class="notebook-sidebar__section-title">
            Saved views
            <span class="badge">{{ notebookStore.savedViewCount }}</span>
          </div>
          <div class="notebook-sidebar__save-row">
            <input
              v-model="newViewName"
              type="text"
              class="form-control form-control-sm"
              placeholder="Name this view…"
              @keyup.enter="saveView"
            >
            <button
              class="btn btn-sm btn-outline-primary"
              :disabled="!newViewName.trim()"
              title="Save the current canvas as a named view"
              @click="saveView"
            >
              <i class="fa-solid fa-floppy-disk" />
              Save
            </button>
          </div>
          <p
            v-if="notebookStore.savedViewCount === 0"
            class="notebook-sidebar__empty"
          >
            No saved views. Arrange the graph, name it above, and save.
          </p>
          <ul
            v-else
            class="notebook-sidebar__list"
          >
            <li
              v-for="view in notebookStore.savedViews"
              :key="view.id"
              class="notebook-sidebar__entity"
            >
              <button
                class="notebook-sidebar__entity-name"
                :title="`Restore ${view.name}`"
                @click="restoreView(view)"
              >
                <i class="fa-solid fa-diagram-project" />
                {{ view.name }}
              </button>
              <button
                class="notebook-sidebar__icon-btn"
                title="Delete this view"
                @click="notebookStore.removeView(view.id)"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </li>
          </ul>
        </div>

        <!-- Backup: export / import -->
        <div class="notebook-sidebar__section">
          <div class="notebook-sidebar__section-title">
            Backup
          </div>
          <div class="notebook-sidebar__backup-row">
            <button
              class="btn btn-sm btn-outline-secondary"
              title="Download this notebook as a JSON file"
              @click="exportNotebook"
            >
              <i class="fa-solid fa-file-export" />
              Export
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              title="Import a notebook from a JSON file (added as a new notebook)"
              @click="triggerImport"
            >
              <i class="fa-solid fa-file-import" />
              Import
            </button>
            <input
              ref="fileInput"
              type="file"
              accept="application/json,.json"
              class="notebook-sidebar__file-input"
              @change="handleFileSelected"
            >
          </div>
          <p class="notebook-sidebar__notice">
            <i class="fa-solid fa-triangle-exclamation" />
            Exported files may contain notes about identifiable people and are your
            responsibility. Nothing is sent to the server — the notebook stays in
            this browser.
          </p>
          <p
            v-if="importMessage"
            class="notebook-sidebar__import-msg"
            :class="importOk ? 'is-ok' : 'is-error'"
          >
            {{ importMessage }}
          </p>
        </div>

        <!-- Wipe everything -->
        <div class="notebook-sidebar__section">
          <button
            class="btn btn-sm btn-outline-danger w-100"
            title="Delete every notebook and start fresh"
            @click="onWipeAll"
          >
            <i class="fa-solid fa-eraser" />
            Wipe everything
          </button>
        </div>
      </div>

      <!-- Status line for actions that need an open graph; pinned below the
           scroll area so it's visible wherever the click happened. -->
      <div
        v-if="feedback"
        class="notebook-sidebar__feedback"
      >
        <i class="fa-solid fa-circle-info" />
        {{ feedback }}
      </div>
    </div>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useNotebookStore } from "../store/NotebookStore";
import { commitPageDraft } from "../utils/NotebookSidebarLogic";

const SIDEBAR_STATE_KEY = "notebookSidebarExpanded";
const NOTE_PREVIEW_LENGTH = 60;

/**
 * Left-docked, always-present, collapsible notebook rail owned by the app
 * shell (MainLayout). Collapsed it is a narrow icon rail with a pin-count
 * badge; expanded it shows the active notebook's page, pins, noted-but-unpinned
 * entities, saved views, per-notebook backup and a wipe-everything action.
 *
 * The sidebar reads/writes the client-side NotebookStore directly, but graph
 * actions (select an entity, save/restore a canvas view) need the live G6
 * canvas, which lives in a shell cell. Those are emitted up to MainLayout,
 * which delegates through ShellMainView to the active cell's ResultGraph —
 * the same bridge the import/restore flow uses.
 *
 * Expand/collapse state persists across reloads under a dedicated localStorage
 * key (kept out of the server-synced SettingsStore so it can't leak or round-
 * trip to the backend). On first run the sidebar starts collapsed.
 */
export default {
  name: "NotebookSidebar",
  emits: ["select-entity", "save-view", "restore-view", "toggle"],
  data() {
    return {
      expanded: false,
      // Blur-commit draft for the notebook page (mirrors EntityPinPanel's note
      // draft): typing edits the local draft; commitPage() writes it to the
      // store on blur, and beforeUnmount flushes any pending edit.
      pageDraft: "",
      pageEntityId: null,
      newViewName: "",
      importMessage: "",
      importOk: false,
      // Transient status line for delegated actions that couldn't run (e.g.
      // no graph open to save a view from). Auto-clears after a few seconds.
      feedback: "",
      feedbackTimer: null,
    };
  },
  computed: {
    ...mapStores(useNotebookStore),
    activeName() {
      return this.notebookStore.activeNotebook?.name || "Untitled notebook";
    },
    // Dirty flag for the page draft (drives the "unsaved" hint).
    pageDirty() {
      return this.pageDraft !== (this.notebookStore.page || "");
    },
  },
  watch: {
    // Reload the page draft whenever the active notebook changes so switching
    // notebooks shows the right narrative. Flush any pending edit to the
    // OUTGOING notebook first, so switching without blurring the textarea
    // doesn't silently drop the page (same guard as EntityPinPanel's note).
    "notebookStore.activeId": {
      immediate: true,
      handler() {
        this.flushPageDraft();
        this.pageDraft = this.notebookStore.page || "";
        this.pageEntityId = this.notebookStore.activeId;
      },
    },
    // When the docked width changes, the graph canvas container resizes. Let
    // the CSS transition finish, then nudge every mounted G6 canvas to resize.
    expanded() {
      this.$emit("toggle", this.expanded);
      this.notifyLayoutChange();
    },
  },
  mounted() {
    this.loadState();
  },
  // Blur doesn't fire when the sidebar is unmounted (e.g. hot reload / route
  // teardown), so flush any pending page draft here too — no draft loss.
  beforeUnmount() {
    this.flushPageDraft();
    if (this.feedbackTimer) {
      window.clearTimeout(this.feedbackTimer);
    }
  },
  methods: {
    // ---- Expand / collapse persistence ----------------------------------
    loadState() {
      try {
        const stored = localStorage.getItem(SIDEBAR_STATE_KEY);
        // Default collapsed on first run (no stored value).
        this.expanded = stored === "true";
      } catch (e) {
        this.expanded = false;
      }
    },
    persistState() {
      try {
        localStorage.setItem(SIDEBAR_STATE_KEY, this.expanded ? "true" : "false");
      } catch (e) {
        // localStorage unavailable — non-fatal, state just won't persist.
      }
    },
    expand() {
      // Flush any pending page edit before the panel content re-renders.
      this.flushPageDraft();
      this.pageDraft = this.notebookStore.page || "";
      this.expanded = true;
      this.persistState();
    },
    collapse() {
      this.flushPageDraft();
      this.expanded = false;
      this.persistState();
    },
    // After the width transition, tell any mounted G6 canvas to re-measure.
    // ResultGraph listens on window "resize", so a synthetic resize event is
    // the simplest cross-cell trigger; a slight delay lets the CSS transition
    // settle so the canvas measures the final container width.
    notifyLayoutChange() {
      window.setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 220);
    },

    // ---- Notebook page draft --------------------------------------------
    commitPage() {
      commitPageDraft(this.notebookStore, this.pageDraft);
    },
    // Commit the current draft to the notebook it was typed against, guarding
    // against a mid-edit notebook switch.
    flushPageDraft() {
      if (this.pageEntityId == null) return;
      if (this.pageEntityId !== this.notebookStore.activeId) {
        // The active notebook changed since we loaded this draft; write the
        // draft back to the notebook it belongs to without disturbing the new
        // active one.
        const nb = this.notebookStore.notebooks.find((n) => n.id === this.pageEntityId);
        if (nb && this.pageDraft !== (nb.page || "")) {
          const prevActive = this.notebookStore.activeId;
          this.notebookStore.activeId = this.pageEntityId;
          this.notebookStore.setPage(this.pageDraft);
          this.notebookStore.activeId = prevActive;
          // setPage persisted while activeId was temporarily flipped to the
          // outgoing notebook, so localStorage now records the WRONG active
          // notebook. Re-persist with the restored activeId (reachable via
          // edit-then-import-without-blur, where importNotebook switches the
          // active notebook and this branch fires).
          this.notebookStore.persist();
        }
        return;
      }
      commitPageDraft(this.notebookStore, this.pageDraft);
    },

    // ---- Notebook lifecycle ---------------------------------------------
    onSwitch(id) {
      this.flushPageDraft();
      this.notebookStore.switchNotebook(id);
    },
    onNewNotebook() {
      const name = window.prompt("Name for the new notebook:", "");
      if (name === null) return; // cancelled
      this.flushPageDraft();
      this.notebookStore.createNotebook(name || "Untitled notebook");
    },
    onRenameNotebook() {
      const current = this.notebookStore.activeNotebook?.name || "";
      const name = window.prompt("Rename this notebook:", current);
      if (name === null) return;
      if (!name.trim()) return;
      this.notebookStore.renameNotebook(this.notebookStore.activeId, name);
    },
    onDeleteNotebook() {
      const name = this.notebookStore.activeNotebook?.name || "this notebook";
      if (!window.confirm(`Delete "${name}"? Its pins, notes and saved views will be lost.`)) {
        return;
      }
      this.notebookStore.deleteNotebook(this.notebookStore.activeId);
    },
    onWipeAll() {
      if (!window.confirm(
        "Wipe every notebook and start fresh? This deletes all pins, notes and saved views in this browser."
      )) {
        return;
      }
      this.notebookStore.wipeAll();
    },

    // ---- Entities / notes -----------------------------------------------
    noteFor(label, pk) {
      return this.notebookStore.noteFor(label, pk);
    },
    notePreview(text) {
      const t = (text || "").trim();
      if (t.length <= NOTE_PREVIEW_LENGTH) return t;
      return `${t.slice(0, NOTE_PREVIEW_LENGTH)}…`;
    },
    selectEntity(label, pk) {
      // Delegated to MainLayout -> ShellMainView -> active cell's ResultGraph.
      this.$emit("select-entity", { label, pk });
    },

    // ---- Saved views ----------------------------------------------------
    // Save/restore need the live G6 canvas, which lives in a shell cell, so
    // both are emitted up to MainLayout, which delegates through
    // ShellMainView.{saveNotebookView,restoreNotebookView} — and those run the
    // NotebookSidebarLogic.{saveViewThroughCell,restoreViewThroughCell}
    // helpers against the active cell's ResultGraph, so the tested trim /
    // no-graph / no-view logic IS the production path. The { ok, reason }
    // outcome comes back via handleDelegateResult below.
    saveView() {
      const name = this.newViewName.trim();
      if (!name) return;
      this.$emit("save-view", name);
      // Do NOT clear the input here: the name is only cleared when the
      // delegation reports success (handleDelegateResult), so a miss (no graph
      // open, empty canvas) doesn't eat what the user typed.
    },
    restoreView(view) {
      if (!view || !view.state) return;
      this.$emit("restore-view", view);
    },

    // ---- Delegation feedback ---------------------------------------------
    // MainLayout calls this with the { ok, reason } outcome of a sidebar
    // action. On success we finish the interaction (clear the save input); on
    // a "no-graph" miss we surface a hint instead of silently no-opping.
    // "empty-graph" gets no extra message — ResultGraph already toasts
    // "Nothing to save" for that case (we just keep the typed name).
    handleDelegateResult(action, result) {
      if (result && result.ok) {
        if (action === "save-view") {
          this.newViewName = "";
        }
        return;
      }
      const reason = result && result.reason;
      if (reason === "no-graph") {
        const messages = {
          "save-view": "Open a graph result to save a view.",
          "restore-view": "Open a graph result to restore this view.",
          "select-entity": "Open a graph result to locate this entity.",
        };
        this.showFeedback(messages[action] || "Open a graph result first.");
      }
    },
    showFeedback(text) {
      this.feedback = text;
      if (this.feedbackTimer) {
        window.clearTimeout(this.feedbackTimer);
      }
      this.feedbackTimer = window.setTimeout(() => {
        this.feedback = "";
        this.feedbackTimer = null;
      }, 5000);
    },

    // ---- Backup: export / import ----------------------------------------
    exportNotebook() {
      const payload = this.notebookStore.exportNotebook();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `notebook-${this.nameSlug()}-${this.timestampSlug()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    nameSlug() {
      const name = this.notebookStore.activeNotebook?.name || "";
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return slug || "untitled";
    },
    timestampSlug() {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      return (
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
      );
    },
    triggerImport() {
      this.importMessage = "";
      this.$refs.fileInput.click();
    },
    handleFileSelected(event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = this.notebookStore.importNotebook(reader.result);
        this.importOk = result.ok;
        this.importMessage = result.ok ? "Notebook imported." : result.error;
      };
      reader.onerror = () => {
        this.importOk = false;
        this.importMessage = "Could not read the selected file.";
      };
      reader.readAsText(file);
    },
  },
};
</script>

<style lang="scss" scoped>
.notebook-sidebar {
  height: 100%;
  flex-shrink: 0;
  background-color: var(--bs-body-bg-secondary);
  border-right: 1px solid var(--bs-body-inactive);
  transition: width 0.2s ease;
  overflow: hidden;

  &--collapsed {
    width: 48px;
  }

  &--expanded {
    width: 340px;
  }

  &__rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 0;
    height: 100%;
  }

  &__rail-btn {
    position: relative;
    background: none;
    border: none;
    color: var(--bs-body-text);
    cursor: pointer;
    font-size: 1.25rem;
    padding: 0.4rem;
    border-radius: 0.375rem;

    &:hover {
      background-color: var(--bs-body-bg-hover);
    }
  }

  &__rail-badge {
    position: absolute;
    top: -0.15rem;
    right: -0.25rem;
    min-width: 1.1rem;
    height: 1.1rem;
    padding: 0 0.25rem;
    border-radius: 0.6rem;
    background-color: var(--bs-body-bg-accent);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 600;
    line-height: 1.1rem;
    text-align: center;
  }

  &__rail-chevron {
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.25rem;

    &:hover {
      color: var(--bs-body-text);
    }
  }

  &__panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 340px;
  }

  &__panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bs-body-inactive);

    h6 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--bs-body-text);

      i {
        margin-right: 0.4rem;
      }
    }
  }

  &__scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1rem 1.5rem;
  }

  &__section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--bs-body-inactive);

    &:first-child {
      margin-top: 0;
      padding-top: 0;
      border-top: none;
    }
  }

  &__switcher-row {
    margin-bottom: 0.5rem;
  }

  &__switcher-actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;

    .btn {
      flex: 1;
      white-space: nowrap;
    }
  }

  &__section-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--bs-body-text-secondary);
    margin-bottom: 0.5rem;

    .badge {
      background-color: var(--bs-body-bg-accent);
      color: #fff !important;
    }
  }

  &__page {
    resize: vertical;
    background-color: var(--bs-body-bg);
    color: var(--bs-body-text);
  }

  &__hint {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--bs-body-text-secondary);
    font-style: italic;
  }

  &__empty {
    font-size: 0.8rem;
    color: var(--bs-body-text-secondary);
    margin: 0;
  }

  &__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  &__entity {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  &__entity-name {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    color: var(--bs-body-text);
    padding: 0.35rem 0.5rem;
    border-radius: 0.375rem;
    font-size: 0.85rem;
    cursor: pointer;

    &:hover {
      background-color: var(--bs-body-bg-hover);
    }

    i {
      margin-right: 0.35rem;
      opacity: 0.7;
    }
  }

  &__entity-type {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.6;
    margin-right: 0.35rem;
  }

  &__note-preview {
    display: block;
    font-size: 0.72rem;
    color: var(--bs-body-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 0.1rem;
  }

  &__icon-btn {
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.25rem 0.4rem;
    border-radius: 0.375rem;
    flex-shrink: 0;

    &:hover {
      background-color: var(--bs-body-bg-hover);
      color: var(--bs-body-text);
    }
  }

  &__save-row,
  &__backup-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  &__file-input {
    display: none;
  }

  &__notice {
    font-size: 0.75rem;
    color: var(--bs-body-text-secondary);
    margin: 0.5rem 0 0;
    line-height: 1.35;

    i {
      margin-right: 0.35rem;
      color: var(--bs-warning, #d5b441);
    }
  }

  &__import-msg {
    font-size: 0.8rem;
    margin: 0.5rem 0 0;

    &.is-ok {
      color: var(--bs-success, #59a14f);
    }

    &.is-error {
      color: var(--bs-danger, #e15759);
    }
  }

  &__feedback {
    flex-shrink: 0;
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--bs-body-inactive);
    font-size: 0.8rem;
    color: var(--bs-body-text-secondary);
    line-height: 1.35;

    i {
      margin-right: 0.35rem;
      color: var(--bs-body-bg-accent);
    }
  }
}

// On very narrow viewports the expanded panel overlays rather than pushing the
// canvas (which would leave no room to work).
@media (max-width: 640px) {
  .notebook-sidebar--expanded {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1500;
    box-shadow: 0 0 1rem rgba(0, 0, 0, 0.3);
  }
}
</style>
