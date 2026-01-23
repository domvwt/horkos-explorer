<template>
  <div
    class="result-container"
    :class="{ maximized: isMaximized, 'is-error-container': errorMessage }"
  >
    <div
      ref="wrapper"
      class="result-container__wrapper"
      :class="{ 'is-error': errorMessage }"
      :style="errorMessage ? { height: 'auto', flex: 'unset' } : { height: containerHeight }"
    >
      <!-- Left Sidebar -->
      <aside
        v-show="!errorMessage"
        class="result-container__tools"
      >
        <!-- Removed button to close sidebar when open in graph view -->
        <!--
        <ul v-if="showGraph && graphSidebarOpen" class="result-container__button-group">
          <button
            class="button"
            @click="toggleGraphSidebar()"
          >
            <i
              class="fa-lg fa-solid fa-angle-left"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="Close Sidebar"
            />
          </button>
        </ul>
        -->

        <!-- Top Tool Buttons -->
        <ul class="result-container__button-group">
          <button
            class="button "
            @click="toggleGraphView"
          >
            <i
              class="fa-lg fa-solid fa-circle-nodes"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="Graph View"
            />
          </button>
          <button
            class="button"
            @click="toggleTableView"
          >
            <i
              class="fa-lg fa-solid fa-table"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="Table View"
            />
          </button>
          <button
            class="button"
            @click="toggleCodeView"
          >
            <i
              class="fa-lg fa-solid fa-code"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="JSON View"
            />
          </button>
        </ul>

        <!-- Bottom Tool Buttons -->
        <ul
          v-show="showGraph"
          class="result-container__button-group result-container__tools--bottom"
        >
          <!-- Layout Dropdown -->
          <button
            class="button layout-dropdown-trigger"
            @click="toggleLayoutDropdown"
          >
            <i
              class="fa-lg fa-solid"
              :class="currentLayoutIcon"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="Graph Layout"
            />
            <div
              v-if="layoutDropdownOpen"
              class="layout-dropdown"
              @mouseleave="closeLayoutDropdown"
            >
              <div class="layout-dropdown__header">
                Graph Layout
              </div>
              <button
                v-for="layout in graphLayouts"
                :key="layout.key"
                class="layout-dropdown__item"
                :class="{ 'layout-dropdown__item--active': (settingsStore.graphLayout || 'd3-force') === layout.key }"
                @click.stop="changeLayout(layout.key)"
              >
                <i
                  class="fa-solid"
                  :class="layout.icon"
                />
                <span class="layout-dropdown__label">{{ layout.label }}</span>
              </button>
            </div>
          </button>

          <button
            class="button"
            @click="$refs.resultGraph.zoomIn()"
          >
            <i
              class="fa-lg fa-solid fa-magnifying-glass-plus"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="Zoom In"
            />
          </button>
          <button
            class="button"
            @click="$refs.resultGraph.zoomOut()"
          >
            <i
              class="fa-lg fa-solid fa-magnifying-glass-minus"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="Zoom Out"
            />
          </button>
          <button
            class="button"
            @click="$refs.resultGraph.fitToView()"
          >
            <i
              class="fa-lg fa-solid fa-compress"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="Fit to View"
            />
          </button>
          <button
            class="button"
            @click="$refs.resultGraph.actualSize()"
          >
            <i
              class="fa-lg fa-solid fa-expand"
              data-bs-toggle="tooltip"
              data-bs-placement="right"
              title="Actual Size"
            />
          </button>
        </ul>
      </aside>

      <main class="result-container__main">
        <ResultGraph
          v-if="queryResult"
          v-show="showGraph"
          ref="resultGraph"
          :query-result="queryResult"
          :query-info="queryInfo"
          :schema="schema"
          :container-height="containerHeight"
          :is-maximized="isMaximized"
          :is-side-panel-open="graphSidebarOpen"
          @graph-empty="handleGraphEmpty"
          @request-sidebar-toggle="toggleGraphSidebar"
        />
        <ResultTable
          v-if="queryResult && showTable"
          ref="resultTable"
          :query-result="queryResult"
          :schema="schema"
          :container-height="containerHeight"
        />
        <ResultCode
          v-if="queryResult && showCode"
          ref="resultCode"
          :query-result="queryResult"
          :graph-data="currentGraphData"
          :schema="schema"
          :container-height="containerHeight"
        />
        <ResultError
          v-if="errorMessage"
          ref="resultError"
          :error-message="errorMessage"
          :is-info="errorMessage === emptyResultMessage"
        />
      </main>

      <!-- Resize Handle -->
      <div
        v-if="!isMaximized"
        ref="resizeHandle"
        class="result-container__resize-handle"
        @mousedown="startResize"
      />
    </div>
  </div>
</template>

<script lang="js">
import ResultGraph from "./ResultGraph.vue";
import ResultTable from "./ResultTable.vue";
import ResultCode from "./ResultCode.vue";
import ResultError from "./ResultError.vue";
import { UI_SIZE, GRAPH_LAYOUTS } from "../../utils/Constants";
import { mapStores } from "pinia";
import { useModeStore } from "../../store/ModeStore";
import { useSettingsStore } from "../../store/SettingsStore";

export default {
  name: "ResultContainer",
  components: {
    ResultGraph,
    ResultTable,
    ResultCode,
    ResultError,
  },
  props: {
    navbarHeight: {
      type: Number,
      required: false,
      default: 0,
    },
    isMaximized: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  data: () => ({
    queryResultDefaultHeight: 400,
    toolbarWidth: UI_SIZE.SHELL_TOOL_BAR_WIDTH,
    showGraph: true,
    showTable: false,
    showCode: false,
    isGraphEmpty: false,
    schema: null,
    queryResult: null,
    queryInfo: null, // Tracks current query {query, params, timestamp}
    errorMessage: "",
    emptyResultMessage: "The query executed successfully but the result is empty.",
    containerHeight: "auto",
    isResizing: false,
    startHeight: 0,
    startY: 0,
    graphSidebarOpen: false,
    windowResizeDebounceTimer: null,
    windowResizeDebounceMs: 100,
    currentGraphData: null,
    layoutDropdownOpen: false,
    graphLayouts: Object.values(GRAPH_LAYOUTS),
  }),
  computed: {
    ...mapStores(useModeStore, useSettingsStore),
    currentLayoutIcon() {
      const currentLayout = this.$refs.resultGraph?.getCurrentLayout() || this.settingsStore.graphLayout || 'd3-force';
      const layout = Object.values(GRAPH_LAYOUTS).find(l => l.key === currentLayout);
      return layout ? layout.icon : 'fa-circle-nodes';
    },
    currentLayoutLabel() {
      const currentLayout = this.$refs.resultGraph?.getCurrentLayout() || this.settingsStore.graphLayout || 'd3-force';
      const layout = Object.values(GRAPH_LAYOUTS).find(l => l.key === currentLayout);
      return layout ? layout.label : 'Force-Directed';
    },
  },
  watch: {
    isMaximized() {
      if (!this.$refs.resultGraph) {
        return;
      }
      this.$nextTick(() => {
        this.updateContainerHeight();
        this.handleGraphResize();
      });
    },
    showTable() {
      this.$nextTick(() => {
        if (this.showTable) {
          this.$refs.resultTable.renderTable();
        }
      });
    },
  },
  mounted() {
    window.addEventListener('mousemove', this.handleResize);
    window.addEventListener('mouseup', this.stopResize);
    window.addEventListener('resize', this.handleWindowResize);
  },
  beforeUnmount() {
    window.removeEventListener('mousemove', this.handleResize);
    window.removeEventListener('mouseup', this.stopResize);
    window.removeEventListener('resize', this.handleWindowResize);
  },
  methods: {
    handleDataChange(schema, queryResult, errorMessage, queryInfo = null) {

      this.isGraphEmpty = false;
      this.schema = schema;
      this.queryResult = queryResult;
      this.queryInfo = queryInfo;
      this.errorMessage = errorMessage;
      if (this.queryResult && this.queryResult.rows.length === 0) {
        this.queryResult = null;
        this.errorMessage = this.emptyResultMessage;
      }
      this.updateContainerHeight();
      if (this.errorMessage) {
        return;
      }
      this.$nextTick(() => {
        this.$refs.resultGraph.drawGraph();
        if (this.showTable && this.$refs.resultTable) {
          this.$refs.resultTable.renderTable();
        }
      });
    },
    hideAll() {
      this.showGraph = false;
      this.showTable = false;
      this.showCode = false;
    },
    toggleGraphView() {
      this.hideAll();
      this.showGraph = true;
      this.graphSidebarOpen = false;
    },
    toggleTableView() {
      this.hideAll();
      this.showTable = true;
      this.graphSidebarOpen = false;
    },
    toggleCodeView() {
      // Capture current graph state before switching views
      this.updateCurrentGraphData();
      this.hideAll();
      this.showCode = true;
      this.graphSidebarOpen = false;
    },
    updateCurrentGraphData() {
      if (this.$refs.resultGraph && this.$refs.resultGraph.g6Graph) {
        this.currentGraphData = {
          nodes: this.$refs.resultGraph.g6Graph.getNodeData() || [],
          edges: this.$refs.resultGraph.g6Graph.getEdgeData() || [],
        };
      } else {
        this.currentGraphData = null;
      }
    },
    handleGraphEmpty() {
      this.isGraphEmpty = true;
      this.toggleTableView();
    },
    handleGraphResize() {
      this.$refs.resultGraph.handleResize();
    },
    handleWindowResize() {
      if (this.windowResizeDebounceTimer) {
        clearTimeout(this.windowResizeDebounceTimer);
      }
      this.windowResizeDebounceTimer = setTimeout(() => {
        this.updateContainerHeight();
        this.$nextTick(() => {
          if (this.$refs.resultGraph) {
            this.$refs.resultGraph.handleResize();
          }
        });
      }, this.windowResizeDebounceMs);
    },
    updateContainerHeight() {
      if (this.errorMessage) {
        this.containerHeight = "auto";
      }
      else if (this.queryResult) {
        const editorHeight = this.$parent.getEditorHeight();
        if (this.isMaximized) {
          this.containerHeight = window.innerHeight - this.navbarHeight - editorHeight - 2 * UI_SIZE.DEFAULT_MARGIN - 50 + 'px';
        }
        else {
          // Use available space instead of fixed 400px
          const availableHeight = window.innerHeight - this.navbarHeight - editorHeight - 2 * UI_SIZE.DEFAULT_MARGIN - 50;
          // Use the larger of the default or available space
          this.containerHeight = Math.max(this.queryResultDefaultHeight, availableHeight) + 'px';
        }
      }
    },
    startResize(e) {
      this.isResizing = true;
      this.startHeight = this.$refs.wrapper.offsetHeight;
      this.startY = e.clientY;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      document.body.style.overflow = 'hidden';
    },
    handleResize(e) {
      if (!this.isResizing) return;

      const deltaY = e.clientY - this.startY;
      const newHeight = Math.max(this.queryResultDefaultHeight, this.startHeight + deltaY);

      requestAnimationFrame(() => {
        this.containerHeight = `${newHeight}px`;
        this.$refs.wrapper.style.height = this.containerHeight;

        if (this.$refs.resultGraph) {
          this.$refs.resultGraph.handleResize();
        }
      });
    },
    stopResize() {
      if (!this.isResizing) return;

      this.isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.overflow = '';

      this.$nextTick(() => {
        if (this.$refs.resultGraph) {
          this.$refs.resultGraph.handleResize();
        }
      });
    },
    toggleGraphSidebar() {
      this.graphSidebarOpen = !this.graphSidebarOpen;
    },
    redrawGraph() {
      if (this.$refs.resultGraph) {
        this.$refs.resultGraph.redrawGraph();
      }
    },
    getInvestigationState() {
      if (this.$refs.resultGraph) {
        return this.$refs.resultGraph.getInvestigationState();
      }
      return null;
    },
    toggleLayoutDropdown() {
      this.layoutDropdownOpen = !this.layoutDropdownOpen;
    },
    closeLayoutDropdown() {
      this.layoutDropdownOpen = false;
    },
    changeLayout(layoutKey) {
      if (this.$refs.resultGraph) {
        this.$refs.resultGraph.changeLayout(layoutKey);
      }
      this.layoutDropdownOpen = false;
    },
  },
};
</script>

<style lang="scss" scoped>
.result-container {
  margin-left: 1rem;
  margin-right: 1rem;
  margin-bottom: 1rem;

  &.maximized {
    margin-bottom: 14px;
  }

  border-bottom: 1px solid var(--bs-body-shell);
  border-left: 1px solid var(--bs-body-shell);
  border-right: 1px solid var(--bs-body-shell);
  border-radius: 0 0 1rem 1rem;
  overflow: hidden;
  box-shadow: 0 .5rem 1rem rgba(0, 0, 0, 0.05);
  position: relative;
  min-height: 400px;
  display: flex;
  flex-direction: column;

  &.is-error-container {
    min-height: 0;
  }

  :deep(.badge) {
    position: relative;
    display: inline-block;
    margin-right: 4px;
    white-space: normal;
    word-wrap: break-word;
    max-width: 100%;
    overflow-wrap: break-word;
    padding-bottom: 4px;
  }

  :deep(table) {

    td,
    th {
      position: relative;
      padding-left: 4px;
      padding-top: 4px;
      padding-right: 8px;
      padding-bottom: 8px;

      .badge {
        position: absolute;
        top: 40%;
        transform: translateY(-50%);
        max-width: calc(100% - 8px);
        word-break: break-word;
        padding-bottom: 4px;
      }
    }
  }
}

.result-container__wrapper {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  display: flex;
  flex-direction: row;
  transition: height 0.1s ease;
  flex: 1;
  position: relative;
}

.result-container__tools {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  min-width: 48px;
  background-color: transparent;
  z-index: 1;
}

.result-container__main {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.result-container__resize-handle {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 8px;
  cursor: ns-resize;
  background: transparent;
  transition: background-color 0.2s ease;
  z-index: 2;
  pointer-events: auto;

  &:hover {
    background-color: var(--bs-body-bg-accent);
  }

  &:active {
    background-color: var(--bs-body-bg-accent);
  }

  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 30px;
    height: 4px;
    background-color: var(--bs-body-inactive);
    border-radius: 2px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  &:hover::after {
    opacity: 1;
  }
}

.result-container__button-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  padding-left: 0rem;
  align-items: first;
}

.result-container__tools--bottom {
  margin-top: auto;
}

button {
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
  background-color: transparent;
  padding: 0px;
  border: 0px;

  i {
    cursor: pointer;
    color: var(--bs-body-text);

    &:hover {
      opacity: 0.7;
    }

    &:active {
      opacity: 0.5;
    }
  }

  &--active {
    i {
      color: var(--bs-body-bg-accent);
    }
  }
}

.layout-dropdown-trigger {
  position: relative;
}

.layout-dropdown {
  position: absolute;
  left: 100%;
  bottom: 0;
  margin-left: 8px;
  min-width: 160px;
  background-color: var(--bs-body-bg);
  border: 1px solid var(--bs-body-shell);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  padding: 4px 0;

  &__header {
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--bs-body-inactive);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    text-align: left;
    font-size: 13px;
    color: var(--bs-body-text);
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--bs-body-bg-accent);
    }

    &--active {
      background-color: var(--bs-body-bg-accent);
      font-weight: 500;

      i {
        color: var(--bs-primary);
      }
    }

    i {
      width: 16px;
      text-align: center;
      color: var(--bs-body-text);
    }
  }

  &__label {
    flex: 1;
  }
}
</style>
