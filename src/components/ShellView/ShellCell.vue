<template>
  <div class="shell-cell__wrapper">
    <CypherEditor
      ref="editor"
      :schema="schema"
      :navbar-height="navbarHeight"
      :is-maximizable="isMaximizable"
      :is-loading="isLoading"
      @evaluate-cypher="evaluateCypher"
      @remove="removeCell"
      @toggle-maximize="toggleMaximize"
      @editor-resize="handleEditorResize"
    />
    <ResultContainer
      v-for="(_, index) in queryResults"
      :key="index"
      :ref="getRefName(index)"
      :is-maximized="isMaximized"
      :navbar-height="navbarHeight"
    />
    <ResultContainer
      v-if="errorMessage"
      ref="resultErrorContainer"
      :is-maximized="false"
      :navbar-height="navbarHeight"
    />
    <div
      v-if="isLoading"
      class="d-flex align-items-center"
    >
      <strong class="text-secondary">{{
        loadingText ? loadingText : "Loading..."
      }}</strong>
      <div
        class="spinner-border text-secondary ms-auto"
        role="status"
      />
    </div>
  </div>
</template>

<script lang="js">
import CypherEditor from "./CypherEditor.vue";
import ResultContainer from "./ResultContainer.vue";
import Axios from "@/utils/AxiosWrapper";
import { useModeStore } from "../../store/ModeStore";
import { mapStores } from "pinia";
import Kuzu from "@/utils/KuzuWasm";
import { LOADING_STATUS } from "@/utils/Constants";

// Constants for investigation restoration timing
const RESTORATION_INITIAL_DELAY_MS = 100;
const RESTORATION_GRAPH_MOUNT_DELAY_MS = 300;
const RESTORATION_RETRY_DELAY_MS = 200;
const RESTORATION_MAX_RETRIES = 5;

export default {
  name: "ShellCell",
  components: {
    CypherEditor,
    ResultContainer,
  },
  props: {
    schema: {
      type: Object,
      required: false,
      default: null,
    },
    navbarHeight: {
      type: Number,
      required: false,
      default: 0,
    },
    cellId: {
      type: String,
      required: false,
      default: "",
    },
  },
  emits: ["reloadSchema", "addCell", "maximize", "minimize", "remove"],
  data: () => ({
    queryString: "",
    queryResults: [],
    errorMessage: "",
    loadingText: "",
    isEvaluated: false,
    isMaximized: false,
    isLoading: false,
  }),

  computed: {
    ...mapStores(useModeStore),
    isMaximizable() {
      return (
        (this.queryResults &&
          this.queryResults.length === 1 &&
          this.queryResults[0].rows &&
          this.queryResults[0].rows.length > 0) ||
        this.isMaximized
      );
    },
  },

  methods: {
    isActive() {
      return this.$refs.editor.isActive();
    },
    loadEditorFromHistory(history) {
      this.isEvaluated = true;
      this.$refs.editor.loadFromHistory(history);
    },
    getRefName(index) {
      return `resultContainer_${index}`;
    },
    evaluateCypher(query, params = {}) {
      this.queryResults = [];
      this.errorMessage = "";
      this.isLoading = true;
      this.loadingText = LOADING_STATUS.EVAL;

      // TODO: Refactor
      if (this.modeStore.isWasm) {
        Kuzu.query(query).then(data => {
          this.handleEvaluationDataChange(data, query, params);
        }).catch(error => {
          this.errorMessage = error.message;
          this.$nextTick(() => {
            const errorContainer = this.$refs.resultErrorContainer;
            errorContainer.handleDataChange(this.schema, null, this.errorMessage, null);
          });
        }).finally(() => {
          this.isLoading = false;
        });
      }
      else {
        let intervalId = setInterval(() => {
          Axios.get(`/api/cypher/progress/${this.cellId}`).then((res) => {
            this.loadingText = `Pipelines Finished: ${res.data.numPipelinesFinished}/${res.data.numPipelines}
            Current Pipeline Progress: ${Math.round(res.data.pipelineProgress * 100)}%`;
          }).catch((error) => {
            if (error.response && error.response.status === 404 && this.loadingText !== LOADING_STATUS.EVAL) {
              this.loadingText = LOADING_STATUS.PROCESS;
            }
          });
        }, 500);
        Axios.post("/api/cypher",
          {
            query,
            params,
            uuid: this.cellId,
            isQueryGenerationMode: false,
            updateHistory: true,
            progress: true
          })
          .then((res) => {
            this.handleEvaluationDataChange(res.data, query, params);
          })
          .catch((error) => {
            if (!error.response) {
              this.errorMessage = "The application is disconnected from the server. Please try to restart the server.";
            }
            else {
              try {
                this.errorMessage = error.response.data.error.trim();
                console.error(error.response.data.error.trim());
              } catch (e) {
                const httpStatus = error.response.status;
                this.errorMessage = `The request failed with HTTP status code ${httpStatus}.`;
                console.error(this.errorMessage);
              }
            }
            if (this.errorMessage) {
              this.$nextTick(() => {
                const errorContainer = this.$refs.resultErrorContainer;
                errorContainer.handleDataChange(this.schema, null, this.errorMessage, null);
              });
            }
          }).finally(() => {
            clearInterval(intervalId);
            this.isLoading = false;
          });

      }
      this.isEvaluated = true;
    },
    handleEvaluationDataChange(data, query, params = {}) {
      this.loadingText = LOADING_STATUS.PROCESS;
      this.queryResults = data.isMultiStatement ? data.results : [data];
      if (this.queryResults.length > 1) {
        this.minimize();
      }
      this.queryString = query;
      const queryInfo = {
        query: query,
        params: params,
        timestamp: Date.now(),
      };
      this.$nextTick(() => {
        for (let i = 0; i < this.queryResults.length; ++i) {
          const resultContainer =
            this.$refs[
            this.getRefName(i)
            ][0];
          resultContainer.handleDataChange(this.schema, this.queryResults[i], "", queryInfo);
        }
      });
      const isSchemaChanged = data && data.isSchemaChanged;
      if (isSchemaChanged) {
        this.$emit("reloadSchema");
      }

    },
    evaluateCell() {
      this.$refs.editor.evaluateCell();
    },
    toggleMaximize() {
      if (this.isMaximized) {
        this.minimize();
      }
      else {
        this.maximize();
      }
    },
    maximize() {
      this.isMaximized = true;
      this.$emit("maximize");
      this.$refs.editor.maximize();
    },
    minimize() {
      this.isMaximized = false;
      this.$emit("minimize");
      this.$refs.editor.minimize();
    },
    removeCell() {
      this.$emit("remove");
    },
    getEditorHeight() {
      return this.$refs.editor.editorHeight;
    },
    handleEditorResize() {
      // Update all result containers when editor height changes
      for (let i = 0; i < this.queryResults.length; i++) {
        try {
          const resultContainer = this.$refs[this.getRefName(i)][0];
          if (resultContainer) {
            resultContainer.updateContainerHeight();
            resultContainer.handleGraphResize();
          }
        } catch (e) {
          // Result container may not exist, ignore
        }
      }
      // Also update error container if it exists
      if (this.$refs.resultErrorContainer) {
        this.$refs.resultErrorContainer.updateContainerHeight();
      }
    },
    redrawGraph() {
      // Redraw graphs in all result containers for this cell
      for (let i = 0; i < this.queryResults.length; i++) {
        try {
          const resultContainer = this.$refs[this.getRefName(i)][0];
          if (resultContainer && resultContainer.redrawGraph) {
            resultContainer.redrawGraph();
          }
        } catch (e) {
          // Result container may not exist, ignore
        }
      }
    },

    /**
     * Restore a saved investigation by loading graph data directly into a ResultContainer.
     *
     * This method orchestrates the complex process of recreating the cell's UI state from
     * a shared investigation link without re-executing the original query:
     *
     * 1. Creates a dummy queryResult to trigger ResultContainer mounting
     * 2. Manually configures the ResultContainer (schema, queryInfo, view mode)
     * 3. Waits for ResultGraph component to mount asynchronously
     * 4. Delegates actual graph restoration to ResultGraph.restoreInvestigationState()
     *
     * The retry logic (up to 5 attempts) ensures ResultGraph mounts successfully even on
     * slower systems or when Vue's component lifecycle timing is unpredictable.
     *
     * Called by ShellMainView.restoreInvestigation() when loading investigation from URL.
     *
     * @param {Object} state - Investigation state from InvestigationState.deserializeState()
     * @param {Array} state.queries - Array of query objects (used to extract queryInfo)
     * @param {Object} state.graphData - Complete graph data passed to ResultGraph
     * @param {Object} state.hiddenElements - Hidden element state passed to ResultGraph
     * @param {Object} [state.viewport] - Viewport state passed to ResultGraph
     * @returns {Promise<void>}
     */
    getInvestigationState() {
      // Get investigation state from the first result container
      const refName = this.getRefName(0);
      const container = this.$refs[refName]?.[0];
      if (container) {
        return container.getInvestigationState();
      }
      return null;
    },

    async loadSavedGraphData(state) {
      // Build queryInfo from state
      const queryInfo = state.queries && state.queries.length > 0 ? {
        query: state.queries[0].query,
        params: state.queries[0].params || {},
        timestamp: state.queries[0].timestamp || Date.now(),
      } : null;

      // Create a result container with at least one dummy row
      // We need proper graph structure in rows to avoid extraction errors
      this.queryResults = [{
        rows: [{
          // Empty row that won't trigger graph extraction errors
        }],
        columns: [],
      }];

      this.isEvaluated = true;

      // Wait for ResultContainer to be created
      await this.$nextTick();
      await new Promise(resolve => setTimeout(resolve, RESTORATION_INITIAL_DELAY_MS));

      // Get the result container
      const resultContainer = this.$refs[this.getRefName(0)];
      if (!resultContainer || !resultContainer[0]) {
        return;
      }

      // Get the result graph component before calling handleDataChange
      // We'll manually initialize it to skip normal query processing
      await this.$nextTick();

      // Manually set up the container to trigger ResultGraph mounting
      resultContainer[0].schema = this.schema;
      resultContainer[0].queryResult = this.queryResults[0];
      resultContainer[0].queryInfo = queryInfo;
      resultContainer[0].errorMessage = "";

      // Ensure graph view is active (not table or code view)
      resultContainer[0].showGraph = true;
      resultContainer[0].showTable = false;
      resultContainer[0].showCode = false;

      resultContainer[0].updateContainerHeight();

      // Wait for ResultGraph component to be mounted (v-if="queryResult" check)
      await this.$nextTick();
      await new Promise(resolve => setTimeout(resolve, RESTORATION_GRAPH_MOUNT_DELAY_MS));

      // Now try to get the result graph reference with retry logic
      let resultGraph = resultContainer[0].$refs.resultGraph;
      let retries = 0;
      while (!resultGraph && retries < RESTORATION_MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RESTORATION_RETRY_DELAY_MS));
        resultGraph = resultContainer[0].$refs.resultGraph;
        retries++;
      }

      if (!resultGraph) {
        return;
      }

      // Restore the investigation state (will create and populate the graph)
      await resultGraph.restoreInvestigationState(state);
    },
  },
}
</script>

<style lang="scss" scoped>
.shell-cell__wrapper {
  display: block;

  &:last-child {
    padding-bottom: 10px;
  }
}

div.d-flex.align-items-center {
  margin: 20px;
  margin-top: 0;
  padding: 16px;
  border: 2px solid var(--bs-body-bg-secondary);
  border-top: 0;
}

.text-secondary {
  white-space: pre-line;
}
</style>
