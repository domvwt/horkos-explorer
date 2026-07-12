<template>
  <div
    ref="wrapper"
    class="shell-editor__wrapper"
    :style="{ maxHeight: isMaximized ? '550px' : '100%' }"
  >
    <!-- Layout -->
    <div class="shell-editor__layout">
      <!-- Content Area -->
      <div class="shell-editor__content">
        <!-- Topbar -->
        <header class="shell-editor__topbar">
          <div>
            <ul class="nav nav-tabs border-0">
              <li class="nav-item text-[var(--bs-body-text)]">
                <a
                  href="#"
                  :class="[
                    activeMode === 'search' && !isPanelMinimized ? 'active-tab' : 'inactive-tab'
                  ]"
                  class="text-decoration-none"
                  @click.prevent="handleTabClick('search')"
                >Search</a>
              </li>
              <li class="nav-item text-[var(--bs-body-text)]">
                <a
                  href="#"
                  :class="[
                    activeMode === 'cypher' && !isPanelMinimized ? 'active-tab' : 'inactive-tab'
                  ]"
                  class="text-decoration-none"
                  @click.prevent="handleTabClick('cypher')"
                >Cypher Query</a>
              </li>
            </ul>
            <button
              class="collapse-toggle"
              :title="isPanelMinimized ? 'Expand panel' : 'Collapse panel'"
              @click="isPanelMinimized = !isPanelMinimized"
            >
              <i :class="isPanelMinimized ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up'" />
            </button>
          </div>
        </header>

        <!-- Main Content -->
        <main v-show="!isPanelMinimized">
          <div
            v-show="activeMode === 'search'"
            class="mode-content"
          >
            <NodeSearch
              @executeQuery="handleSearchQuery"
              @select-entity="handleSelectEntity"
            />
          </div>
          <div
            v-show="activeMode === 'cypher'"
            class="mode-content mode-content--with-actions"
            :class="{ 'mode-content--expanded': isEditorExpanded }"
          >
            <div
              ref="editor"
              class="editor-container"
              :class="{ 'editor-container--expanded': isEditorExpanded }"
            />
            <div
              v-if="!isEditorExpanded"
              class="editor-resize-handle"
              :class="{ 'editor-resize-handle--active': isResizing }"
              title="Drag to resize the editor"
              role="separator"
              aria-orientation="horizontal"
              @mousedown="startResize"
            />
            <div class="editor-actions">
              <button class="run-button" @click="evaluateCell">
                <i class="fa-solid fa-play" />
                Run
              </button>
              <button
                class="expand-button"
                :title="isEditorExpanded ? 'Collapse editor' : 'Expand editor'"
                @click="toggleEditorExpanded"
              >
                <i :class="isEditorExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'" />
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>

  </div>
</template>

<script lang="js">
import CypherLanguage from "../../utils/CypherLanguage";
import MonacoCypherLanguage from "../../utils/MonacoCypherLanguage";
import { UI_SIZE } from "../../utils/Constants";
import { useModeStore } from "../../store/ModeStore";
import { mapStores } from "pinia";
import NodeSearch from "./NodeSearch.vue";

// monaco-editor is heavy, so it is loaded on demand instead of in the initial
// bundle. This module-level binding is populated the first time an editor
// mounts and shared across all CypherEditor instances (webpack caches the
// dynamic chunk); it is kept out of Vue's reactivity system deliberately.
let Monaco = null;

// Make sure Monaco is not reactive. Otherwise, it will cause the Vue.js
// app to crash.
export default {
  components: {
    NodeSearch,
  },
  props: {
    // eslint-disable-next-line vue/require-default-prop
    schema: {
      type: Object,
      required: false,
    },
    navbarHeight: {
      type: Number,
      required: false,
      default: 0,
    },
    isMaximizable: {
      type: Boolean,
      required: false,
      default: false,
    },
    isLoading: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  emits: ['remove', 'evaluateCypher', 'selectEntity', 'toggleMaximize', 'editorResize'],
  data: () => {
    return {
      name: "CypherEditor",
      cypherLanguage: new CypherLanguage(),
      isCommandPaletteOpen: false,
      editorWidth: 0,
      editorHeight: 0,
      toolbarWidth: UI_SIZE.SHELL_TOOL_BAR_WIDTH,
      isMaximized: false,
      activeMode: "search", // 'cypher' or 'search'
      isPanelMinimized: false,
      observer: null,
      editorResizeDebounce: null,
      isEditorExpanded: false,
      // Drag-to-resize state for the handle below the editor.
      isResizing: false,
      resizeStartY: 0,
      resizeStartHeight: 0,
      boundResizeMove: null,
      boundStopResize: null,
    }
  },

  computed: {
    ...mapStores(useModeStore),
    maximizeButtonClass() {
      return (this.isMaximized ? "fa-minimize" : "fa-maximize") + "  fa-solid";
    },
    maximizeButtonTitle() {
      return this.isMaximized ? "Minimize" : "Maximize";
    },
  },

  watch: {
    editorHeight() {
      if (this.editorResizeDebounce) {
        clearTimeout(this.editorResizeDebounce);
      }
      this.editorResizeDebounce = setTimeout(() => {
        this.$emit("editorResize", this.editorHeight);
        this.editorResizeDebounce = null;
      }, 50);
    },
    activeMode() {
      // When switching modes, force a resize check
      this.$nextTick(() => {
        if (this.$refs.wrapper) {
          this.editorHeight = this.$refs.wrapper.offsetHeight;
        }
      });
    },
    isPanelMinimized() {
      // When minimizing/unminimizing, force immediate resize
      this.$nextTick(() => {
        if (this.$refs.wrapper) {
          const newHeight = this.$refs.wrapper.offsetHeight;
          if (Math.abs(this.editorHeight - newHeight) > 1) {
            this.editorHeight = newHeight;
            // Emit immediately without debounce for panel minimize/maximize
            this.$emit("editorResize", newHeight);
          }
        }
      });
    },
  },

  mounted() {
    // Fire-and-forget: the container renders immediately and Monaco attaches
    // once its chunk arrives. initMonacoEditor guards against unmount-before-load.
    this.initMonacoEditor();
    // Set height mutation observer for wrapper element
    let rafId;
    this.observer = new ResizeObserver((entries) => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          const newHeight = entry.contentRect.height;
          // Only update if height actually changed (prevents feedback loop)
          if (Math.abs(this.editorHeight - newHeight) > 1) {
            this.editorHeight = newHeight;
          }
        }
      });
    });
    this.observer.observe(this.$refs.wrapper);

    // Global listeners so a drag that leaves the thin handle still tracks and,
    // crucially, a mouseup ANYWHERE ends the resize (fixes the grip that stayed
    // "stuck" when the button was released off the handle).
    this.boundResizeMove = this.onResizeMove;
    this.boundStopResize = this.stopResize;
    window.addEventListener("mousemove", this.boundResizeMove);
    window.addEventListener("mouseup", this.boundStopResize);
  },

  beforeUnmount() {
    // Marks a pending async Monaco load as stale so initMonacoEditor bails
    // instead of attaching an editor to a torn-down container.
    this.isUnmounted = true;
    if (this.editor) {
      this.editor.dispose();
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.boundResizeMove) {
      window.removeEventListener("mousemove", this.boundResizeMove);
    }
    if (this.boundStopResize) {
      window.removeEventListener("mouseup", this.boundStopResize);
    }
  },

  methods: {
    // --- Drag-to-resize the editor height ------------------------------------
    // A dedicated handle (not native CSS `resize`) so it never competes with
    // Monaco's own scrollbar/resize corner. Height is applied inline to the
    // editor container; the wrapper's ResizeObserver then emits `editorResize`
    // and ShellCell re-fits the result graph.
    startResize(e) {
      const el = this.$refs.editor;
      if (!el) return;
      this.isResizing = true;
      this.resizeStartY = e.clientY;
      this.resizeStartHeight = el.getBoundingClientRect().height;
      // Suppress text selection while dragging.
      e.preventDefault();
    },

    onResizeMove(e) {
      if (!this.isResizing) return;
      const el = this.$refs.editor;
      if (!el) return;
      const MIN_HEIGHT = 80;
      // Leave room for the surrounding chrome so the editor can't swallow the
      // whole viewport.
      const MAX_HEIGHT = Math.max(MIN_HEIGHT, window.innerHeight - 220);
      const delta = e.clientY - this.resizeStartY;
      const next = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, this.resizeStartHeight + delta)
      );
      el.style.height = `${next}px`;
    },

    stopResize() {
      this.isResizing = false;
    },
    // -------------------------------------------------------------------------

    handleTabClick(mode) {
      if (this.activeMode === mode && !this.isPanelMinimized) {
        // Clicking the active tab minimizes the panel
        this.isPanelMinimized = true;
      } else {
        // Clicking a different tab or clicking while minimized shows that tab
        this.activeMode = mode;
        this.isPanelMinimized = false;
      }
    },
    async initMonacoEditor() {
      // Load monaco-editor on demand (kept out of the initial bundle). The
      // dynamic chunk is cached by webpack, so the module-level binding is
      // populated once and reused across every editor instance.
      if (!Monaco) {
        Monaco = await import("monaco-editor");
      }
      // The import is async, so the component may have been torn down (rapid
      // tab switching) before it resolved. Bail rather than attach an editor to
      // a detached container.
      if (this.isUnmounted || !this.$refs.editor) {
        return;
      }
      const theme = document.documentElement.getAttribute('data-bs-theme') === 'dark'
        ? 'vs-dark'
        : 'vs-light';
      // Set the Monaco editor to the global window object to make sure it is
      // only initialized once.
      // TODO: Create a singleton class wrapper for Monaco instead.
      if (!window.Monaco) {
        Monaco.languages.getLanguages().forEach((lang) => {
          if (lang.id === "cypher") {
            // Hack: we override the loader function to return our definition of
            // Cypher language instead of the default one.
            lang.loader = () => {
              return {
                then: (callback) => {
                  callback({
                    conf: MonacoCypherLanguage.languageConfiguration,
                    language: MonacoCypherLanguage.language,
                  });
                },
              };
            };
          }
        });


        Monaco.languages.registerCompletionItemProvider("cypher", {
          provideCompletionItems: (model, position) => {
            return this.cypherLanguage.provideCompletionItemsForMonaco(
              model,
              position,
              this.schema,
              Monaco
            );
          },
        });
        window.Monaco = Monaco;
      }

      const editorContainer = this.$refs.editor;
      this.editor = window.Monaco.editor.create(editorContainer, {
        language: "cypher",
        theme,
        automaticLayout: true,
        minimap: {
          enabled: false,
        },
        fontSize: 14,
        scrollBeyondLastLine: false,
        padding: {
          top: 8,
          bottom: 8,
        },
      });
      // Apply content that arrived while the Monaco chunk was loading. The
      // undefined sentinel (not truthiness) keeps an empty-string write valid.
      if (this.pendingEditorContent !== undefined) {
        const pending = this.pendingEditorContent;
        this.pendingEditorContent = undefined;
        this.setEditorContent(pending);
      }
    },
    toggleMaximize() {
      this.$emit("toggleMaximize");
    },
    maximize() {
      this.isMaximized = true;
    },
    minimize() {
      this.isMaximized = false;
    },
    evaluateCypher() {
      // No editor yet (Monaco chunk still loading) means nothing the user
      // could have typed to run.
      if (!this.editor) {
        return;
      }
      const cypher = this.editor.getValue();
      this.$emit("evaluateCypher", cypher, {});
    },
    evaluateCell() {
      if (this.activeMode === 'cypher') {
        this.evaluateCypher();
      }
      // Collapse editor on run so results are visible
      if (this.isEditorExpanded) {
        this.isEditorExpanded = false;
        this.$nextTick(() => {
          if (this.editor) {
            this.editor.layout();
          }
        });
      }
    },
    handleSearchQuery(queryData) {
      // When search generates a query, execute it with params
      // queryData is either a string (legacy) or { query, params } (new)
      if (typeof queryData === 'string') {
        this.$emit("evaluateCypher", queryData, {});
      } else {
        this.$emit("evaluateCypher", queryData.query, queryData.params);
      }
    },
    handleSelectEntity(target) {
      // Picking a search suggestion is additive - route the entity up to the
      // cell so it lands on the existing canvas (like a pin click) instead of
      // running a canvas-replacing query.
      this.$emit("selectEntity", target);
    },
    setEditorContent(content) {
      // The editor is created only after the async Monaco chunk resolves, so
      // an external write (e.g. the startup demo-cell/history load) can arrive
      // before it exists. Buffer the latest content; initMonacoEditor applies
      // it once the editor is created. Non-reactive instance property, same
      // convention as this.editor.
      if (!this.editor) {
        this.pendingEditorContent = content;
        return;
      }
      this.editor.setValue(content);
    },
    removeCell() {
      this.$emit("remove");
    },
    isActive() {
      return this.activeMode === 'cypher' && this.editor && this.editor.hasTextFocus();
    },
    loadFromHistory(history) {
      // Note: activeMode is NOT restored from history - always defaults to 'search'
      // to ensure the search interface is the primary entry point for users
      if (history.cypherQuery) {
        this.setEditorContent(history.cypherQuery);
      }
    },
    toggleEditorExpanded() {
      this.isEditorExpanded = !this.isEditorExpanded;
      // The expand mode uses `height: auto`; a leftover inline height from a
      // prior drag would win over the class rule (inline > class), so clear it
      // when expanding. Drag height only applies in the collapsed state.
      if (this.isEditorExpanded && this.$refs.editor) {
        this.$refs.editor.style.height = "";
      }
      // Trigger Monaco layout update after the CSS transition
      this.$nextTick(() => {
        if (this.editor) {
          this.editor.layout();
        }
      });
    },
  },
}
</script>

<style lang="scss" scoped>
$margin: 1rem;

.shell-editor__wrapper {
  margin-top: 0.75rem;
  margin-left: 1rem;
  margin-right: 1rem;
  border-radius: 1rem 1rem 0 0;
  overflow: hidden;

}

.shell-editor__topbar {
  width: 100%;
  padding: 0.25rem 1rem;
  border-bottom: 1px solid var(--bs-body-inactive);
  background-color: var(--bs-body-bg-secondary);
  color: var(--bs-body-text);

  div {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }

  ul {
    display: flex;
    align-items: center;
    font-size: 0.875rem;
    font-weight: 500;
    text-align: center;
    background-color: var(--bs-body-bg-secondary);

    .nav-item {
      margin: 0;
      padding: 0;
    }
  }

  a {
    padding: 0.25rem 1rem;
    color: var(--bs-body-text);

    &.active-tab {
      font-weight: bold;
      color: var(--bs-body-text);
    }

    &.inactive-tab {
      opacity: 0.6;

      &:hover {
        opacity: 1;
      }
    }
  }

  .collapse-toggle {
    background: transparent;
    border: none;
    padding: 0.5rem;
    cursor: pointer;
    color: var(--bs-body-text);
    display: flex;
    align-items: center;

    &:hover {
      color: var(--bs-body-text);
    }

    i {
      font-size: 0.875rem;
    }
  }
}

.shell-editor__layout {
  display: flex;
  min-height: auto;

  aside {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem 0;
    min-width: 48px;
    background-color: var(--bs-body-bg-secondary);

    ul {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.5rem 0;
      align-items: center;
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      padding-top: 2.5rem;

      button {
        padding: 0px;
        background: transparent;
        border: 0px;
      }
    }
  }

  .shell-editor__content {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
}

main {
  flex: 1 1 auto;
  background-color: var(--bs-body-shell);
  padding: 0.5rem 0.75rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .mode-content {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;

    &.mode-content--with-actions {
      gap: 0.75rem;
    }

    &.mode-content--expanded {
      height: calc(100vh - 120px);
    }

    .editor-container {
      flex: 0 0 auto;
      height: 150px;
      overflow: auto;

      &.editor-container--expanded {
        flex: 1;
        height: auto;
      }
    }

    // A dedicated drag strip below the editor. It lives in its own row (not on
    // top of Monaco's scrollbar/resize corner), so grabbing it never fights
    // Monaco for the right/bottom edge - the reason native `resize` failed. The
    // wrapper's ResizeObserver picks up the resulting height change and emits
    // `editorResize`, so ShellCell re-fits the result graph automatically.
    .editor-resize-handle {
      flex: 0 0 auto;
      cursor: row-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      // Slim look, generous grab. The visible strip is only ~9px, but the
      // padding + negative margins swallow the surrounding 0.75rem flex gap so
      // the real hit target is ~19px tall - easy to land on without adding any
      // layout height (the gap it eats was dead space anyway). content-box is
      // required so the padding EXTENDS the box; under Bootstrap's global
      // border-box it would instead compress into the 9px and the hit area
      // would stay tiny.
      box-sizing: content-box;
      height: 9px;
      padding: 5px 0;
      margin: -5px 0;
      // Grip is faint but VISIBLE at rest so the control is discoverable (a
      // resize handle can't be hover-only - you can't hover what you can't
      // find); it brightens on hover/drag. Uses the app's inactive/secondary
      // ink tokens so it stays quiet and theme-adaptive.
      color: var(--bs-body-inactive);
      transition: color 0.12s ease;

      &::before {
        content: "";
        // Full-width hairline: reads as a resize seam between the editor and
        // its actions, quieter than a centered pill and easier to find.
        width: 100%;
        height: 1px;
        background-color: currentColor;
      }

      &:hover,
      &.editor-resize-handle--active {
        color: var(--bs-body-text-secondary);
      }

      // While the expand button owns sizing, the drag strip is meaningless.
      .editor-container--expanded + & {
        display: none;
      }
    }

    textarea.editor-container {
      width: 100%;
      border: none;
      padding: 0.5rem;
      background-color: var(--bs-body-bg);
      color: var(--bs-body-text);
      resize: none;
    }

    .editor-actions {
      flex-shrink: 0;
      display: flex;
      justify-content: flex-start;
      gap: 0.5rem;

      .run-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background-color: var(--bs-primary);
        color: white;
        border: none;
        border-radius: 0.375rem;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.2s;

        &:hover {
          opacity: 0.9;
        }

        &:active {
          opacity: 0.8;
        }

        i {
          font-size: 0.75rem;
        }
      }

      .expand-button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem;
        background-color: transparent;
        color: var(--bs-body-color);
        border: 1px solid var(--bs-body-inactive);
        border-radius: 0.375rem;
        cursor: pointer;
        transition: background-color 0.2s;

        &:hover {
          background-color: var(--bs-body-bg-secondary);
        }

        i {
          font-size: 0.875rem;
        }
      }
    }
  }
}

</style>
