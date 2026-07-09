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
          <!-- Active notebook name + inline rename affordance. When renaming,
               the name swaps to an input pre-filled with the current name;
               Enter/blur commit, Esc cancels. -->
          <div class="notebook-sidebar__name-row">
            <input
              v-if="renaming"
              ref="renameInput"
              v-model="renameDraft"
              type="text"
              class="form-control form-control-sm"
              :placeholder="activeName"
              @keyup.enter="finishRename('enter')"
              @keyup.esc="finishRename('escape')"
              @blur="finishRename('blur')"
            >
            <template v-else>
              <span class="notebook-sidebar__active-name">{{ activeName }}</span>
              <button
                ref="renameBtn"
                class="notebook-sidebar__icon-btn"
                title="Rename this notebook"
                @click="startRename"
              >
                <i class="fa-solid fa-pen" />
              </button>
            </template>
          </div>

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

          <!-- Create: the "New" button swaps in place to an inline input.
               Enter commits (empty commits the default name); Esc/blur cancel
               (blur must never accidentally create). -->
          <div class="notebook-sidebar__switcher-actions">
            <input
              v-if="creating"
              ref="createInput"
              v-model="createDraft"
              type="text"
              class="form-control form-control-sm"
              placeholder="Untitled notebook"
              @keyup.enter="finishCreate('enter')"
              @keyup.esc="finishCreate('escape')"
              @blur="finishCreate('blur')"
            >
            <button
              v-else
              ref="newBtn"
              class="btn btn-sm btn-outline-secondary"
              title="Create a new notebook"
              @click="startCreate"
            >
              <i class="fa-solid fa-plus" /> New
            </button>

            <!-- Delete: two-stage inline danger confirm (no modal). The button
                 swaps in place to a danger-styled pair that auto-reverts after
                 a few idle seconds. -->
            <template v-if="confirmingDelete">
              <div class="notebook-sidebar__confirm">
                <span class="notebook-sidebar__confirm-msg">
                  Delete “{{ activeName }}”? Pins, notes and saved views in it
                  will be lost.
                </span>
                <div class="notebook-sidebar__confirm-actions">
                  <button
                    ref="deleteConfirmBtn"
                    class="btn btn-sm btn-danger"
                    @click="confirmDelete"
                  >
                    Delete
                  </button>
                  <button
                    class="btn btn-sm btn-outline-secondary"
                    @click="cancelDelete"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </template>
            <button
              v-else
              ref="deleteBtn"
              class="btn btn-sm btn-outline-secondary"
              title="Delete this notebook"
              @click="startDelete"
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
          </div>
          <ul class="notebook-sidebar__list">
            <li
              v-for="orphan in notebookStore.orphanNotes"
              :key="orphan.key"
              class="notebook-sidebar__entity"
            >
              <button
                class="notebook-sidebar__entity-name"
                :title="`Select ${orphan.name || orphan.pk}`"
                @click="selectEntity(orphan.label, orphan.pk)"
              >
                <span class="notebook-sidebar__entity-type">{{ orphan.label }}</span>
                {{ orphan.name || orphan.pk }}
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
          <div class="notebook-sidebar__save-row">
            <button
              class="btn btn-sm btn-outline-secondary w-100"
              title="Open a shared view from a code"
              @click="openImportModal"
            >
              <i class="fa-solid fa-file-import" />
              Open a shared view
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
                title="Share this view"
                @click="shareView(view)"
              >
                <i class="fa-solid fa-share-nodes" />
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

        <!-- Wipe everything: two-stage inline danger confirm (no modal),
             auto-reverting after a few idle seconds. -->
        <div class="notebook-sidebar__section">
          <template v-if="confirmingWipe">
            <div class="notebook-sidebar__confirm">
              <span class="notebook-sidebar__confirm-msg">
                Wipe everything? All notebooks will be erased from this browser —
                pins, notes and saved views included.
              </span>
              <div class="notebook-sidebar__confirm-actions">
                <button
                  ref="wipeConfirmBtn"
                  class="btn btn-sm btn-danger"
                  @click="confirmWipe"
                >
                  Wipe everything
                </button>
                <button
                  class="btn btn-sm btn-outline-secondary"
                  @click="cancelWipe"
                >
                  Cancel
                </button>
              </div>
            </div>
          </template>
          <button
            v-else
            ref="wipeBtn"
            class="btn btn-sm btn-outline-danger w-100"
            title="Delete every notebook and start fresh"
            @click="startWipe"
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

    <!-- Share a saved view: fixed-overlay modals rendered from the sidebar. -->
    <ShareModal
      :visible="showShareModal"
      :export-code="shareExportCode"
      :export-code-length="shareExportCodeLength"
      @close="showShareModal = false"
    />
    <!-- Open a shared view: "Open now" restores into the active cell,
         "Save to notebook" files it as a saved view. -->
    <ImportModal
      :visible="showImportModal"
      @close="showImportModal = false"
      @open="handleSharedViewOpen"
      @save="handleSharedViewSave"
    />
  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useNotebookStore } from "../store/NotebookStore";
import ShareModal from "./ShellView/ShareModal.vue";
import ImportModal from "./ShellView/ImportModal.vue";
import {
  commitPageDraft,
  decideCreateCommit,
  decideRenameCommit,
  buildSharedViewName,
  CONFIRM_AUTO_REVERT_MS,
} from "../utils/NotebookSidebarLogic";

const SIDEBAR_STATE_KEY = "notebookSidebarExpanded";
const NOTE_PREVIEW_LENGTH = 60;

/**
 * Left-docked, always-present, collapsible notebook rail owned by the app
 * shell (MainLayout). Collapsed it is a narrow icon rail; expanded it shows
 * the active notebook's page, pins, noted-but-unpinned entities, saved
 * views, per-notebook backup and a wipe-everything action.
 *
 * Notebook naming and the destructive actions never use native browser
 * dialogs: create/rename swap in place to an inline input, and delete /
 * wipe-everything use a two-stage in-place danger confirm that auto-reverts
 * after a few idle seconds. The commit/cancel decision logic lives in
 * NotebookSidebarLogic so it lands under vitest.
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
  components: {
    ShareModal,
    ImportModal,
  },
  emits: ["select-entity", "save-view", "restore-view", "open-shared-view", "toggle"],
  data() {
    return {
      expanded: false,
      // Blur-commit draft for the notebook page (mirrors EntityPinPanel's note
      // draft): typing edits the local draft; commitPage() writes it to the
      // store on blur, and beforeUnmount flushes any pending edit.
      pageDraft: "",
      pageEntityId: null,
      newViewName: "",
      // Inline create/rename input state. `creating`/`renaming` toggle the "New"
      // button and the active-name span to an input in place; the drafts hold
      // the in-progress text. `renameCommitted` guards against a Enter-then-blur
      // double-commit on rename (Enter commits, then the blur that follows would
      // fire finishRename again).
      creating: false,
      createDraft: "",
      renaming: false,
      renameDraft: "",
      renameCommitted: false,
      // Two-stage inline danger confirms (no modal). Each swaps its trigger
      // button to a Delete/Cancel pair and auto-reverts after a few idle
      // seconds via its own timer, cleared on unmount.
      confirmingDelete: false,
      confirmingWipe: false,
      confirmTimer: null,
      importMessage: "",
      importOk: false,
      // Share/open-shared-view modals. Share carries a single saved view's HKS
      // code; the open-shared-view modal accepts a pasted code and either opens
      // it into the active cell or files it as a saved view.
      showShareModal: false,
      shareExportCode: "",
      shareExportCodeLength: 0,
      showImportModal: false,
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
    if (this.confirmTimer) {
      window.clearTimeout(this.confirmTimer);
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
      // Any open inline rename / danger confirm belongs to the outgoing
      // notebook; drop it so it can't act on the newly-active one.
      this.renaming = false;
      this.cancelConfirms();
      this.notebookStore.switchNotebook(id);
    },
    // ---- Inline create -----------------------------------------------------
    // The "New" button swaps to an inline input. Enter commits (empty commits
    // the default name); Esc/blur cancel — a blur must never accidentally
    // create. Cancelling returns focus to the "New" button.
    startCreate() {
      this.cancelConfirms();
      this.createDraft = "";
      this.creating = true;
      this.$nextTick(() => this.$refs.createInput?.focus());
    },
    finishCreate(trigger) {
      if (!this.creating) return;
      const { commit, name } = decideCreateCommit(this.createDraft, trigger);
      this.creating = false;
      this.createDraft = "";
      if (commit) {
        this.flushPageDraft();
        this.notebookStore.createNotebook(name);
      } else if (trigger === "escape") {
        // Return focus to the trigger only on an explicit Esc cancel; a blur
        // cancel means the user already moved focus elsewhere — don't steal it.
        this.$nextTick(() => this.$refs.newBtn?.focus());
      }
    },

    // ---- Inline rename -----------------------------------------------------
    // A pencil next to the active name swaps it to an input pre-filled with the
    // current name. Enter/blur commit (the store guards empty/whitespace); Esc
    // cancels. renameCommitted stops an Enter-then-blur double fire; cancelling
    // returns focus to the pencil.
    startRename() {
      this.cancelConfirms();
      this.renameDraft = this.notebookStore.activeNotebook?.name || "";
      this.renameCommitted = false;
      this.renaming = true;
      this.$nextTick(() => this.$refs.renameInput?.focus());
    },
    finishRename(trigger) {
      if (!this.renaming) return;
      // Enter fires first, then the blur it induces would re-enter here; ignore
      // the trailing blur once a commit has already happened.
      if (this.renameCommitted && trigger === "blur") {
        this.renameCommitted = false;
        return;
      }
      const { commit, name } = decideRenameCommit(this.renameDraft, trigger);
      if (commit) {
        this.renameCommitted = trigger === "enter";
        this.renaming = false;
        this.notebookStore.renameNotebook(this.notebookStore.activeId, name);
      } else {
        this.renaming = false;
        this.$nextTick(() => this.$refs.renameBtn?.focus());
      }
    },

    // ---- Inline delete confirm (two-stage, no modal) -----------------------
    startDelete() {
      this.cancelConfirms();
      this.confirmingDelete = true;
      this.armConfirmAutoRevert();
      this.$nextTick(() => this.$refs.deleteConfirmBtn?.focus());
    },
    confirmDelete() {
      this.clearConfirmTimer();
      this.confirmingDelete = false;
      this.notebookStore.deleteNotebook(this.notebookStore.activeId);
    },
    cancelDelete() {
      this.clearConfirmTimer();
      this.confirmingDelete = false;
      this.$nextTick(() => this.$refs.deleteBtn?.focus());
    },

    // ---- Inline wipe-everything confirm (two-stage, no modal) --------------
    startWipe() {
      this.cancelConfirms();
      this.confirmingWipe = true;
      this.armConfirmAutoRevert();
      this.$nextTick(() => this.$refs.wipeConfirmBtn?.focus());
    },
    confirmWipe() {
      this.clearConfirmTimer();
      this.confirmingWipe = false;
      this.notebookStore.wipeAll();
    },
    cancelWipe() {
      this.clearConfirmTimer();
      this.confirmingWipe = false;
      this.$nextTick(() => this.$refs.wipeBtn?.focus());
    },

    // Shared confirm helpers: only one danger confirm is ever open, and it
    // auto-reverts to the idle button after a few idle seconds so a stray
    // "Delete" can't linger armed. The timer is cleared on unmount.
    armConfirmAutoRevert() {
      this.clearConfirmTimer();
      this.confirmTimer = window.setTimeout(() => {
        this.confirmingDelete = false;
        this.confirmingWipe = false;
        this.confirmTimer = null;
      }, CONFIRM_AUTO_REVERT_MS);
    },
    clearConfirmTimer() {
      if (this.confirmTimer) {
        window.clearTimeout(this.confirmTimer);
        this.confirmTimer = null;
      }
    },
    cancelConfirms() {
      this.clearConfirmTimer();
      this.confirmingDelete = false;
      this.confirmingWipe = false;
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

    // ---- Share / open a shared view --------------------------------------
    // A saved view's `state` IS its HKS share code, so sharing a row just hands
    // that code straight to the share modal.
    shareView(view) {
      if (!view || !view.state) return;
      const code = view.state;
      this.shareExportCode = code;
      this.shareExportCodeLength = code.length;
      this.showShareModal = true;
    },
    openImportModal() {
      this.showImportModal = true;
    },
    // "Open now" from the shared-view modal: hand the parsed state up to
    // MainLayout, which restores it into the active cell (same path as import).
    handleSharedViewOpen(state) {
      this.$emit("open-shared-view", state);
    },
    // "Save to notebook" from the shared-view modal: file the raw code as a
    // saved view in the ACTIVE notebook without opening it. It appears in the
    // saved-views list immediately (the store is reactive).
    handleSharedViewSave(code) {
      const name = buildSharedViewName(
        this.notebookStore.savedViews.map((v) => v.name)
      );
      this.notebookStore.saveView(name, code);
      this.showFeedback(`Saved "${name}" to this notebook.`);
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

  &__name-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.5rem;

    .form-control {
      flex: 1;
      min-width: 0;
    }
  }

  &__active-name {
    flex: 1;
    min-width: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--bs-body-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

    .form-control {
      flex: 1 1 100%;
      min-width: 0;
    }
  }

  &__confirm {
    flex: 1 1 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--bs-danger, #e15759);
    border-radius: 0.375rem;
    background-color: var(--bs-body-bg);
  }

  &__confirm-msg {
    font-size: 0.8rem;
    line-height: 1.35;
    color: var(--bs-body-text);
  }

  &__confirm-actions {
    display: flex;
    gap: 0.35rem;

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
    color: var(--bs-body-text);
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
