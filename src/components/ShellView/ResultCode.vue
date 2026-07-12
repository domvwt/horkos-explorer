<template>
  <div
    ref="wrapper"
    class="result-code__wrapper"
    :style="{ height: containerHeight }"
  >
    <div
      ref="editor"
      class="result-code__editor"
    />
  </div>
</template>

<script lang="js">
// Make sure Monaco is not reactive. Otherwise, it will cause the Vue.js
// app to crash.
import { loadMonaco } from "../../utils/MonacoLoader";

export default {
  name: "ResultCode",
  props: {
    queryResult: {
      type: Object,
      required: false,
      default: () => ({}),
    },
    graphData: {
      type: Object,
      required: false,
      default: null,
    },
    containerHeight: {
      type: String,
      required: false,
      default: ""
    },
  },
  data: () => ({
  }),
  watch: {
  },

  mounted() {
    // Fire-and-forget: initMonacoEditor awaits the shared loader and guards
    // against unmount-before-resolve (same isUnmounted pattern CypherEditor
    // uses), so a ResultCode that mounts before the monaco-editor chunk has
    // resolved no longer throws "Monaco is not initialized."
    this.initMonacoEditor();
  },

  beforeUnmount() {
    this.isUnmounted = true;
    if (this.editor) {
      this.editor.dispose();
    }
  },
  methods: {
    /**
     * Extract clean entity data from G6 graph node/edge format.
     * Removes internal G6 rendering properties and returns only
     * the meaningful entity data.
     */
    extractEntityData(items) {
      return items.map(item => {
        const props = item.data?.properties || {};
        return {
          _label: props._label,
          _id: props._id,
          ...Object.fromEntries(
            Object.entries(props).filter(([key]) => !key.startsWith('_'))
          ),
        };
      });
    },

    /**
     * Get display data for JSON view. Uses current graph data if available
     * (includes expanded nodes), otherwise falls back to original query result.
     */
    getDisplayData() {
      if (this.graphData && (this.graphData.nodes?.length > 0 || this.graphData.edges?.length > 0)) {
        return {
          nodes: this.extractEntityData(this.graphData.nodes || []),
          edges: this.extractEntityData(this.graphData.edges || []),
        };
      }
      return this.queryResult;
    },

    async initMonacoEditor() {
      // Await the shared single-flight loader instead of reading
      // window.Monaco synchronously: ResultCode can mount before
      // CypherEditor's dynamic import("monaco-editor") has resolved (e.g. a
      // saved view restored straight into JSON view), and reading
      // window.Monaco at that point used to throw. loadMonaco() resolves to
      // the same module either way, whoever loads it first.
      const Monaco = await loadMonaco();
      // The import is async, so the component may have been torn down
      // (result view switched away, cell removed) before it resolved. Bail
      // rather than attach an editor to a detached container.
      if (this.isUnmounted || !this.$refs.editor) {
        return;
      }
      const theme = document.documentElement.getAttribute('data-bs-theme') === 'dark'
        ? 'vs-dark'
        : 'vs-light';
      const int128Replacer = (_, value) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      };
      const displayData = this.getDisplayData();
      const queryResultString = JSON.stringify(displayData, int128Replacer, 2);
      this.editor = Monaco.editor.create(this.$refs.editor, {
        value: queryResultString,
        language: "json",
        theme,
        readOnly: true,
        automaticLayout: true,
        minimap: {
          enabled: false,
        },
        fontSize: 12,
        scrollBeyondLastLine: false,
      });
    },
  },
};
</script>

<style lang="scss" scoped>
.result-code__wrapper {
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-bottom: 1px solid (var(--bs-body-inactive));
  border-radius: 10px;

  .result-code__editor {
    width: 100%;
    height: 100%;
  }
}
</style>
