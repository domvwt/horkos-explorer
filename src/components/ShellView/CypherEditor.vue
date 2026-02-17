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
              <li v-if="!modeStore.isWasm && enableAIQuery" class="nav-item">
                <a
                  href="#"
                  :class="[
                    activeMode === 'ai' && !isPanelMinimized ? 'active-tab' : 'inactive-tab'
                  ]"
                  class="text-decoration-none"
                  @click.prevent="handleTabClick('ai')"
                >AI Query</a>
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
            <NodeSearch @executeQuery="handleSearchQuery" />
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
          <div
            v-if="!modeStore.isWasm && enableAIQuery"
            v-show="activeMode === 'ai'"
            class="mode-content mode-content--with-actions"
          >
            <textarea
              ref="gptQuestionTextArea"
              v-model="gptQuestion"
              class="editor-container"
              placeholder="Type your question here..."
            />
            <div class="editor-actions">
              <button class="run-button" @click="evaluateCell">
                <i class="fa-solid fa-play" />
                Generate & Run
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
import * as Monaco from "monaco-editor";
import { UI_SIZE } from "../../utils/Constants";
import { useModeStore } from "../../store/ModeStore";
import { mapStores } from "pinia";
import NodeSearch from "./NodeSearch.vue";

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
  emits: ['remove', 'evaluateCypher', 'toggleMaximize', 'generateAndEvaluateQuery', 'editorResize'],
  data: () => {
    return {
      name: "CypherEditor",
      cypherLanguage: new CypherLanguage(),
      isCommandPaletteOpen: false,
      editorWidth: 0,
      editorHeight: 0,
      toolbarWidth: UI_SIZE.SHELL_TOOL_BAR_WIDTH,
      isMaximized: false,
      activeMode: "search", // 'cypher', 'ai', or 'search'
      isPanelMinimized: false,
      gptQuestion: "",
      observer: null,
      editorResizeDebounce: null,
      isEditorExpanded: false,
    }
  },

  computed: {
    ...mapStores(useModeStore),
    enableAIQuery() {
      // Feature flag for AI Query - set VUE_APP_ENABLE_AI_QUERY=true to enable
      return process.env.VUE_APP_ENABLE_AI_QUERY === 'true';
    },
    maximizeButtonClass() {
      return (this.isMaximized ? "fa-minimize" : "fa-maximize") + "  fa-solid";
    },
    maximizeButtonTitle() {
      return this.isMaximized ? "Minimize" : "Maximize";
    },
    gptButtonClass() {
      return (this.activeMode === 'ai' ? "fa-file-code" : "fa-robot") + " fa-lg fa-solid";
    },
    gptButtonTitle() {
      return this.activeMode === 'ai' ? "Cypher Code Editor" : "Query Generation (Powered by GPT)";
    },
    // Maintain backward compatibility for components that might check this
    isQueryGenerationMode() {
      return this.activeMode === 'ai';
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

    // If AI Query is disabled and activeMode is 'ai', switch to 'search'
    if (this.activeMode === 'ai' && !this.enableAIQuery) {
      this.activeMode = 'search';
    }
  },

  beforeUnmount() {
    if (this.editor) {
      this.editor.dispose();
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  },

  methods: {
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
    initMonacoEditor() {
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
              this.schema
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
    },
    toggleMaximize() {
      this.$emit("toggleMaximize");
    },
    toggleQueryGeneration() {
      this.isQueryGenerationMode = !this.isQueryGenerationMode;
    },
    maximize() {
      this.isMaximized = true;
    },
    minimize() {
      this.isMaximized = false;
    },
    evaluateCypher() {
      const cypher = this.editor.getValue();
      this.$emit("evaluateCypher", cypher, {});
    },
    generateAndEvaluateQuery() {
      this.$emit("generateAndEvaluateQuery", this.gptQuestion);
    },
    evaluateCell() {
      if (this.activeMode === 'ai') {
        this.generateAndEvaluateQuery();
      } else if (this.activeMode === 'cypher') {
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
    setEditorContent(content) {
      this.editor.setValue(content);
    },
    removeCell() {
      this.$emit("remove");
    },
    isActive() {
      return (this.activeMode === 'ai' && this.$refs.gptQuestionTextArea === document.activeElement) ||
        (this.activeMode === 'cypher' && this.editor && this.editor.hasTextFocus());
    },
    loadFromHistory(history) {
      // Note: activeMode is NOT restored from history - always defaults to 'search'
      // to ensure the search interface is the primary entry point for users
      this.gptQuestion = history.gptQuestion || "";
      if (history.cypherQuery) {
        this.setEditorContent(history.cypherQuery);
      }
    },
    toggleEditorExpanded() {
      this.isEditorExpanded = !this.isEditorExpanded;
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
