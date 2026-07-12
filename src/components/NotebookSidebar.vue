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
      <!-- Single header row: the notebook name IS the switcher (opens the
           notebook menu); ⋯ opens the lifecycle menu; « collapses. When
           renaming or creating, the name slot swaps to an inline input
           (Enter/Esc/blur semantics unchanged from the previous layout). -->
      <div class="notebook-sidebar__header">
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
        <input
          v-else-if="creating"
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
          ref="switcherBtn"
          class="notebook-sidebar__switcher"
          :class="{ 'is-open': showNotebookMenu }"
          title="Switch or create a notebook"
          aria-haspopup="menu"
          :aria-expanded="showNotebookMenu ? 'true' : 'false'"
          @click="toggleNotebookMenu"
        >
          <span class="notebook-sidebar__switcher-name">{{ activeName }}</span>
          <i class="fa-solid fa-angle-down" />
        </button>
        <button
          ref="overflowBtn"
          class="notebook-sidebar__icon-btn"
          :class="{ 'is-open': showOverflowMenu }"
          title="Notebook actions"
          aria-haspopup="menu"
          :aria-expanded="showOverflowMenu ? 'true' : 'false'"
          @click="toggleOverflowMenu"
        >
          <i class="fa-solid fa-ellipsis" />
        </button>
        <button
          class="notebook-sidebar__icon-btn"
          title="Collapse notebook"
          @click="collapse"
        >
          <i class="fa-solid fa-angles-left" />
        </button>
      </div>

      <!-- Notebook switcher menu -->
      <div
        v-if="showNotebookMenu"
        ref="notebookMenu"
        class="notebook-sidebar__menu notebook-sidebar__menu--notebooks"
        role="menu"
      >
        <button
          v-for="nb in notebookStore.notebookList"
          :key="nb.id"
          class="notebook-sidebar__menu-item"
          :class="{ 'is-active': nb.id === notebookStore.activeId }"
          role="menuitem"
          @click="switchFromMenu(nb.id)"
        >
          <span class="notebook-sidebar__menu-lead">
            <i
              v-if="nb.id === notebookStore.activeId"
              class="fa-solid fa-check"
            />
          </span>
          <span class="notebook-sidebar__menu-text">{{ nb.name }}</span>
        </button>
        <hr>
        <button
          class="notebook-sidebar__menu-item"
          role="menuitem"
          @click="createFromMenu"
        >
          <span class="notebook-sidebar__menu-lead"><i class="fa-solid fa-plus" /></span>
          <span class="notebook-sidebar__menu-text">New notebook</span>
        </button>
      </div>

      <!-- Lifecycle / backup menu. Red exists only in here (and in armed
           confirms) — never as a resting state in the panel. The privacy
           caveat travels with the export/import actions it describes. -->
      <div
        v-if="showOverflowMenu"
        ref="overflowMenu"
        class="notebook-sidebar__menu notebook-sidebar__menu--overflow"
        role="menu"
      >
        <button
          class="notebook-sidebar__menu-item"
          role="menuitem"
          @click="renameFromMenu"
        >
          <span class="notebook-sidebar__menu-text">Rename notebook</span>
        </button>
        <hr>
        <button
          class="notebook-sidebar__menu-item"
          role="menuitem"
          @click="exportFromMenu"
        >
          <span class="notebook-sidebar__menu-text">Export notebook…</span>
        </button>
        <button
          class="notebook-sidebar__menu-item"
          role="menuitem"
          @click="importFromMenu"
        >
          <span class="notebook-sidebar__menu-text">Import notebook…</span>
        </button>
        <p class="notebook-sidebar__menu-caption">
          Exports stay in this browser and may contain notes about identifiable
          people — they're your responsibility.
        </p>
        <hr>
        <button
          class="notebook-sidebar__menu-item notebook-sidebar__menu-item--danger"
          role="menuitem"
          @click="deleteFromMenu"
        >
          <span class="notebook-sidebar__menu-text">Delete notebook…</span>
        </button>
        <button
          class="notebook-sidebar__menu-item notebook-sidebar__menu-item--danger"
          role="menuitem"
          @click="wipeFromMenu"
        >
          <span class="notebook-sidebar__menu-text">Wipe all notebooks…</span>
        </button>
      </div>

      <div class="notebook-sidebar__scroll">
        <!-- Armed two-stage confirms (triggered from the ⋯ menu) render at the
             top of the panel; both auto-revert after a few idle seconds. -->
        <div
          v-if="confirmingDelete"
          class="notebook-sidebar__confirm"
        >
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
        <div
          v-if="confirmingWipe"
          class="notebook-sidebar__confirm"
        >
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
        <p
          v-if="importMessage"
          class="notebook-sidebar__import-msg"
          :class="importOk ? 'is-ok' : 'is-error'"
        >
          {{ importMessage }}
        </p>

        <!-- Notes (the notebook-level narrative). Borderless until focused. -->
        <div class="notebook-sidebar__section">
          <div class="notebook-sidebar__label">
            Notes
          </div>
          <textarea
            v-model="pageDraft"
            class="notebook-sidebar__notes"
            rows="5"
            placeholder="Add notes…"
            @blur="commitPage"
          />
          <small
            v-if="pageDirty"
            class="notebook-sidebar__hint"
          >Unsaved — click away to save</small>
        </div>

        <!-- Pinned entities: canvas-coloured type dot + name; unpin appears on
             hover/focus so the resting state is just the content. -->
        <div class="notebook-sidebar__section">
          <div class="notebook-sidebar__label">
            Pinned
            <span
              v-if="notebookStore.pinnedCount > 0"
              class="notebook-sidebar__count"
            >{{ notebookStore.pinnedCount }}</span>
          </div>
          <p
            v-if="notebookStore.pinnedCount === 0"
            class="notebook-sidebar__empty"
          >
            Nothing pinned yet — select a node and click Pin.
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
                :title="`${pin.label} — select ${pin.name || pin.pk}`"
                @click="selectEntity(pin.label, pin.pk)"
              >
                <span
                  class="notebook-sidebar__dot"
                  :style="{ backgroundColor: dotColor(pin.label) }"
                  aria-hidden="true"
                />
                <span class="notebook-sidebar__entity-text">
                  <span class="notebook-sidebar__entity-title">{{ pin.name || pin.pk }}</span>
                  <span
                    v-if="noteFor(pin.label, pin.pk)"
                    class="notebook-sidebar__note-preview"
                  >{{ notePreview(noteFor(pin.label, pin.pk)) }}</span>
                </span>
              </button>
              <button
                class="notebook-sidebar__row-action"
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
          <div class="notebook-sidebar__label">
            Noted
            <span class="notebook-sidebar__count">{{ notebookStore.orphanNoteCount }}</span>
          </div>
          <ul class="notebook-sidebar__list">
            <li
              v-for="orphan in notebookStore.orphanNotes"
              :key="orphan.key"
              class="notebook-sidebar__entity"
            >
              <button
                class="notebook-sidebar__entity-name"
                :title="`${orphan.label} — select ${orphan.name || orphan.pk}`"
                @click="selectEntity(orphan.label, orphan.pk)"
              >
                <span
                  class="notebook-sidebar__dot"
                  :style="{ backgroundColor: dotColor(orphan.label) }"
                  aria-hidden="true"
                />
                <span class="notebook-sidebar__entity-text">
                  <span class="notebook-sidebar__entity-title">{{ orphan.name || orphan.pk }}</span>
                  <span class="notebook-sidebar__note-preview">{{ notePreview(orphan.note) }}</span>
                </span>
              </button>
              <button
                class="notebook-sidebar__row-action"
                title="Remove this note"
                @click="notebookStore.setNote(orphan.label, orphan.pk, '')"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </li>
          </ul>
        </div>

        <!-- Saved views: "+ Save current" swaps to an inline name input
             (Enter saves, Esc/blur cancel — the typed name survives a failed
             save so a "no graph open" miss doesn't eat it). -->
        <div class="notebook-sidebar__section">
          <div class="notebook-sidebar__label">
            Views
            <button
              v-if="!savingView"
              ref="saveViewBtn"
              class="notebook-sidebar__label-action"
              title="Save the current canvas as a named view"
              @click="startSaveView"
            >
              + Save current
            </button>
          </div>
          <input
            v-if="savingView"
            ref="viewNameInput"
            v-model="newViewName"
            type="text"
            class="form-control form-control-sm notebook-sidebar__view-name-input"
            placeholder="Name this view"
            @keyup.enter="finishSaveView('enter')"
            @keyup.esc="finishSaveView('escape')"
            @blur="finishSaveView('blur')"
          >
          <p
            v-if="notebookStore.savedViewCount === 0"
            class="notebook-sidebar__empty"
          >
            No saved views yet.
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
                <span class="notebook-sidebar__entity-text">
                  <span class="notebook-sidebar__entity-title">{{ view.name }}</span>
                </span>
              </button>
              <button
                class="notebook-sidebar__row-action"
                title="Share this view"
                @click="shareView(view)"
              >
                <i class="fa-solid fa-share-nodes" />
              </button>
              <button
                class="notebook-sidebar__row-action"
                title="Delete this view"
                @click="notebookStore.removeView(view.id)"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </li>
          </ul>
          <button
            class="notebook-sidebar__link"
            title="Open a shared view from a code"
            @click="openImportModal"
          >
            Open a shared view…
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

    <!-- Hidden file input for notebook import (triggered from the ⋯ menu; the
         menu closes before the picker opens, so the input lives outside it). -->
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="notebook-sidebar__file-input"
      @change="handleFileSelected"
    >

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
import { useSettingsStore } from "../store/SettingsStore";
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
const STORAGE_FULL_MESSAGE =
  "Browser storage is full — recent notebook changes may not be saved.";

/**
 * Left-docked, always-present, collapsible notebook rail owned by the app
 * shell (MainLayout). Collapsed it is a narrow icon rail; expanded it shows a
 * single header row (the notebook name doubles as the switcher, a ⋯ menu
 * holds the lifecycle/backup actions) above the active notebook's notes,
 * pins, noted-but-unpinned entities and saved views.
 *
 * Notebook naming and the destructive actions never use native browser
 * dialogs: create/rename swap the header name slot to an inline input, and
 * delete / wipe-everything use a two-stage in-place danger confirm that
 * auto-reverts after a few idle seconds. The commit/cancel decision logic
 * lives in NotebookSidebarLogic so it lands under vitest.
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
      // Blur-commit draft for the notebook notes (mirrors EntityPinPanel's
      // note draft): typing edits the local draft; commitPage() writes it to
      // the store on blur, and beforeUnmount flushes any pending edit.
      pageDraft: "",
      pageEntityId: null,
      // Saved-view naming. `savingView` swaps the "+ Save current" label
      // action to an inline input; the typed name is only cleared when the
      // delegation reports success, so a miss doesn't eat it.
      savingView: false,
      newViewName: "",
      // Header dropdown menus (notebook switcher / lifecycle overflow). At
      // most one is open; a document-level pointerdown listener closes them
      // on outside clicks and Esc closes + refocuses the trigger.
      showNotebookMenu: false,
      showOverflowMenu: false,
      // Inline create/rename input state. `creating`/`renaming` swap the
      // header name slot to an input in place; the drafts hold the
      // in-progress text. `renameCommitted` guards against a Enter-then-blur
      // double-commit on rename (Enter commits, then the blur that follows
      // would fire finishRename again).
      creating: false,
      createDraft: "",
      renaming: false,
      renameDraft: "",
      renameCommitted: false,
      // Two-stage inline danger confirms (no modal), armed from the ⋯ menu.
      // Each renders a Delete/Cancel pair at the top of the panel and
      // auto-reverts after a few idle seconds via its own timer.
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
    ...mapStores(useNotebookStore, useSettingsStore),
    activeName() {
      return this.notebookStore.activeNotebook?.name || "Untitled notebook";
    },
    // Dirty flag for the notes draft (drives the "unsaved" hint).
    pageDirty() {
      return this.pageDraft !== (this.notebookStore.page || "");
    },
    anyMenuOpen() {
      return this.showNotebookMenu || this.showOverflowMenu;
    },
  },
  watch: {
    // Reload the notes draft whenever the active notebook changes so switching
    // notebooks shows the right narrative. Flush any pending edit to the
    // OUTGOING notebook first, so switching without blurring the textarea
    // doesn't silently drop the notes (same guard as EntityPinPanel's note).
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
    // Attach the outside-click / Esc listeners only while a menu is open.
    anyMenuOpen(open) {
      if (open) {
        document.addEventListener("pointerdown", this.onDocPointerDown, true);
        document.addEventListener("keydown", this.onDocKeydown, true);
      } else {
        this.removeMenuListeners();
      }
    },
    // NotebookStore latches this true (once per session) the first time a
    // persist() write fails — e.g. localStorage quota exceeded. Surface one
    // quiet notice through the existing feedback line; the store's
    // console.warn already logged the detail. The feedback line only renders
    // in the expanded panel, so if the sidebar is collapsed defer the notice
    // until the next expand instead of dropping it.
    "notebookStore.storageFullNotice"(full) {
      if (!full) return;
      if (this.expanded) {
        this.showFeedback(STORAGE_FULL_MESSAGE);
      } else {
        this.pendingStorageFullFeedback = true;
      }
    },
  },
  created() {
    // Deliberately non-reactive (not in data()): set when storageFullNotice
    // flips while the sidebar is collapsed — the feedback line only renders in
    // the expanded panel — and flushed by expand(). Nothing renders off it.
    this.pendingStorageFullFeedback = false;
  },
  mounted() {
    this.loadState();
  },
  // Blur doesn't fire when the sidebar is unmounted (e.g. hot reload / route
  // teardown), so flush any pending notes draft here too — no draft loss.
  beforeUnmount() {
    this.flushPageDraft();
    this.removeMenuListeners();
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
      // Flush any pending notes edit before the panel content re-renders.
      this.flushPageDraft();
      this.pageDraft = this.notebookStore.page || "";
      this.expanded = true;
      this.persistState();
      // A storage-full notice that arrived while collapsed was deferred (the
      // feedback line only exists in the expanded panel) — surface it now.
      if (this.pendingStorageFullFeedback) {
        this.pendingStorageFullFeedback = false;
        this.showFeedback(STORAGE_FULL_MESSAGE);
      }
    },
    collapse() {
      this.flushPageDraft();
      this.closeMenus();
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

    // ---- Header menus -----------------------------------------------------
    toggleNotebookMenu() {
      this.showOverflowMenu = false;
      this.showNotebookMenu = !this.showNotebookMenu;
    },
    toggleOverflowMenu() {
      this.showNotebookMenu = false;
      this.showOverflowMenu = !this.showOverflowMenu;
    },
    closeMenus() {
      this.showNotebookMenu = false;
      this.showOverflowMenu = false;
    },
    removeMenuListeners() {
      document.removeEventListener("pointerdown", this.onDocPointerDown, true);
      document.removeEventListener("keydown", this.onDocKeydown, true);
    },
    // Close on any pointerdown outside the open menu and its trigger. The
    // triggers are excluded so their own click toggles instead of
    // close-then-reopen.
    onDocPointerDown(event) {
      const inside = [
        this.$refs.notebookMenu,
        this.$refs.overflowMenu,
        this.$refs.switcherBtn,
        this.$refs.overflowBtn,
      ].some((el) => el && el.contains(event.target));
      if (!inside) {
        this.closeMenus();
      }
    },
    onDocKeydown(event) {
      if (event.key !== "Escape") return;
      const wasNotebookMenu = this.showNotebookMenu;
      this.closeMenus();
      this.$nextTick(() => {
        (wasNotebookMenu ? this.$refs.switcherBtn : this.$refs.overflowBtn)?.focus();
      });
    },

    // ---- Notebook notes draft --------------------------------------------
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
    switchFromMenu(id) {
      this.closeMenus();
      if (id !== this.notebookStore.activeId) {
        this.onSwitch(id);
      }
    },
    createFromMenu() {
      this.closeMenus();
      this.startCreate();
    },
    renameFromMenu() {
      this.closeMenus();
      this.startRename();
    },
    exportFromMenu() {
      this.closeMenus();
      this.exportNotebook();
    },
    importFromMenu() {
      this.closeMenus();
      this.triggerImport();
    },
    deleteFromMenu() {
      this.closeMenus();
      this.startDelete();
    },
    wipeFromMenu() {
      this.closeMenus();
      this.startWipe();
    },

    // ---- Inline create -----------------------------------------------------
    // "New notebook" (in the switcher menu) swaps the header name to an inline
    // input. Enter commits (empty commits the default name); Esc/blur cancel —
    // a blur must never accidentally create. Esc returns focus to the switcher.
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
        this.$nextTick(() => this.$refs.switcherBtn?.focus());
      }
    },

    // ---- Inline rename -----------------------------------------------------
    // "Rename notebook" (in the ⋯ menu) swaps the header name to an input
    // pre-filled with the current name. Enter/blur commit (the store guards
    // empty/whitespace); Esc cancels. renameCommitted stops an Enter-then-blur
    // double fire; cancelling returns focus to the ⋯ trigger.
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
        this.$nextTick(() => this.$refs.overflowBtn?.focus());
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
      this.$nextTick(() => this.$refs.overflowBtn?.focus());
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
      this.$nextTick(() => this.$refs.overflowBtn?.focus());
    },

    // Shared confirm helpers: only one danger confirm is ever open, and it
    // auto-reverts to the idle state after a few idle seconds so a stray
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
    // Entity-type dot colour comes from the same SettingsStore getter the
    // canvas uses, so the sidebar and graph always agree on type colours.
    dotColor(label) {
      return this.settingsStore.colorForLabel(label);
    },
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
    startSaveView() {
      this.savingView = true;
      this.$nextTick(() => this.$refs.viewNameInput?.focus());
    },
    finishSaveView(trigger) {
      if (!this.savingView) return;
      if (trigger === "enter") {
        // Dispatch the save; the editor stays open until the delegation
        // reports success so a miss keeps the typed name in place.
        this.saveView();
        return;
      }
      // Esc/blur close the editor; the draft name is retained for next time.
      this.savingView = false;
      if (trigger === "escape") {
        this.$nextTick(() => this.$refs.saveViewBtn?.focus());
      }
    },
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
    // action. On success we finish the interaction (clear + close the view
    // name editor); on a "no-graph" miss we surface a hint instead of silently
    // no-opping. "empty-graph" gets no extra message — ResultGraph already
    // toasts "Nothing to save" for that case (we just keep the typed name).
    handleDelegateResult(action, result) {
      if (result && result.ok) {
        if (action === "save-view") {
          this.newViewName = "";
          this.savingView = false;
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
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 340px;
  }

  // ---- Header row: switcher + ⋯ + collapse -----------------------------
  &__header {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.55rem 0.5rem 0.55rem 0.65rem;

    .form-control {
      flex: 1;
      min-width: 0;
    }
  }

  &__switcher {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: none;
    padding: 0.25rem 0.4rem;
    border-radius: 0.375rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--bs-body-text);
    cursor: pointer;
    text-align: left;

    i {
      font-size: 0.7rem;
      color: var(--bs-body-text-secondary);
      flex-shrink: 0;
    }

    &:hover,
    &.is-open {
      background-color: var(--bs-body-bg-hover);
    }
  }

  &__switcher-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__icon-btn {
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.25rem 0.45rem;
    border-radius: 0.375rem;
    flex-shrink: 0;

    &:hover,
    &.is-open {
      background-color: var(--bs-body-bg-hover);
      color: var(--bs-body-text);
    }
  }

  // ---- Dropdown menus ----------------------------------------------------
  &__menu {
    position: absolute;
    top: 2.6rem;
    z-index: 30;
    min-width: 13rem;
    max-width: calc(100% - 1.5rem);
    padding: 0.25rem;
    background-color: var(--bs-body-bg);
    border: 1px solid var(--bs-body-inactive);
    border-radius: 0.5rem;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);

    hr {
      margin: 0.25rem 0.35rem;
      border: 0;
      border-top: 1px solid var(--bs-body-bg-hover);
      opacity: 1;
    }
  }

  &__menu--notebooks {
    left: 0.65rem;
  }

  &__menu--overflow {
    right: 0.65rem;
  }

  &__menu-item {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    background: none;
    border: none;
    padding: 0.35rem 0.55rem;
    border-radius: 0.375rem;
    font-size: 0.82rem;
    color: var(--bs-body-text);
    cursor: pointer;
    text-align: left;

    &:hover,
    &:focus-visible {
      background-color: var(--bs-body-bg-hover);
    }

    &--danger {
      color: var(--bs-danger, #e15759);
    }
  }

  &__menu-lead {
    width: 1em;
    flex-shrink: 0;
    color: var(--bs-body-text-secondary);
    font-size: 0.75rem;
  }

  &__menu-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__menu-caption {
    margin: 0.1rem 0 0.15rem;
    padding: 0 0.55rem;
    font-size: 0.68rem;
    line-height: 1.4;
    color: var(--bs-body-text-secondary);
    white-space: normal;
  }

  // ---- Panel body ----------------------------------------------------------
  &__scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0.85rem 1rem;
  }

  &__section {
    margin-top: 1.15rem;

    &:first-child {
      margin-top: 0.35rem;
    }
  }

  // Micro-label section headers: small caps, letterspaced, secondary colour —
  // no bold headings, no hairline rules between sections.
  &__label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.66rem;
    font-weight: 650;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--bs-body-text-secondary);
    margin-bottom: 0.35rem;
  }

  &__count {
    font-weight: 550;
    letter-spacing: 0;
  }

  &__label-action {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.78rem;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    color: var(--bs-body-bg-accent);
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  &__confirm {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.5rem 0;
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

  // Borderless notes area: reads as plain text on the panel until focused.
  &__notes {
    display: block;
    width: 100%;
    resize: vertical;
    background: none;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    padding: 0.25rem 0.4rem;
    margin-left: -0.4rem;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--bs-body-text);

    &::placeholder {
      color: var(--bs-body-text-secondary);
      opacity: 0.7;
    }

    &:hover {
      border-color: var(--bs-body-bg-hover);
    }

    &:focus {
      outline: none;
      background-color: var(--bs-body-bg);
      border-color: var(--bs-body-inactive);
    }
  }

  &__hint {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--bs-body-text-secondary);
    font-style: italic;
  }

  &__empty {
    font-size: 0.78rem;
    color: var(--bs-body-text-secondary);
    margin: 0;
  }

  &__view-name-input {
    margin-bottom: 0.4rem;
  }

  &__list {
    list-style: none;
    padding: 0;
    margin: 0 -0.35rem;
    display: flex;
    flex-direction: column;
  }

  // List rows: content only at rest; the row actions (unpin / share / delete)
  // appear on hover or focus-within.
  &__entity {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    border-radius: 0.375rem;

    &:hover {
      background-color: var(--bs-body-bg-hover);
    }

    .notebook-sidebar__row-action {
      visibility: hidden;
    }

    &:hover .notebook-sidebar__row-action,
    &:focus-within .notebook-sidebar__row-action {
      visibility: visible;
    }
  }

  &__entity-name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    text-align: left;
    background: none;
    border: none;
    color: var(--bs-body-text);
    padding: 0.3rem 0.35rem;
    border-radius: 0.375rem;
    font-size: 0.82rem;
    cursor: pointer;
  }

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &__entity-text {
    flex: 1;
    min-width: 0;
  }

  &__entity-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__note-preview {
    display: block;
    font-size: 0.7rem;
    color: var(--bs-body-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__row-action {
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.25rem 0.35rem;
    border-radius: 0.375rem;
    flex-shrink: 0;
    font-size: 0.78rem;

    &:hover {
      color: var(--bs-body-text);
    }
  }

  &__link {
    display: block;
    background: none;
    border: none;
    padding: 0;
    margin-top: 0.5rem;
    font-size: 0.78rem;
    color: var(--bs-body-text-secondary);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;

    &:hover {
      color: var(--bs-body-text);
    }
  }

  &__file-input {
    display: none;
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

// On narrow viewports the expanded panel overlays rather than pushing the
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
