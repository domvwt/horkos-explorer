<template>
  <div
    ref="wrapper"
    class="result-graph__wrapper"
  >
    <div
      ref="graph"
      class="result-graph__container"
      :style="{ width: graphWidth + 'px' }"
    />

    <HoverContainer
      ref="hoverContainer"
      :schema="schema"
    />

    <div
      v-show="isSidePanelOpen"
      ref="sidePanel"
      class="result-graph__side-panel"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <div
        class="resize-handle"
        @mousedown="startResize"
      />
      <div class="result-graph__side-panel-content">
        <div class="result-graph__side-panel-header">
          <h5 v-if="clickedIsNode">
            Actions
          </h5>
          <h5 v-else>
            Overview
          </h5>
          <button
            class="result-graph__sidebar-button--close"
            @click="toggleSidePanel"
          >
            <i class="fa-solid fa-times" />
          </button>
        </div>

        <div
          v-if="clickedIsNode"
          class="result-graph__actions"
        >
          <button
            class="btn btn-sm btn-outline-secondary"
            @click="hideNode()"
          >
            <i class="fa-solid fa-eye-slash" /> Hide Node
          </button>

          <button
            v-if="!isHighlightedMode"
            class="btn btn-sm btn-outline-secondary"
            @click="enableHighlightMode()"
          >
            <i class="fa-solid fa-arrows-to-circle" /> Highlight Mode
          </button>

          <button
            v-else
            class="btn btn-sm btn-outline-primary"
            @click="disableHighlightMode()"
          >
            <i class="fa-solid fa-arrows-to-circle" />
            Disable Highlight Mode
          </button>

          <button
            v-if="!isCurrentNodeExpanded"
            class="btn btn-sm btn-outline-secondary"
            @click="expandSelectedNode()"
          >
            <i class="fa-solid fa-up-down-left-right" />
            <span v-if="currentNodeNeighborInfo && currentNodeNeighborInfo.hasCount">
              Expand Neighbors (+{{ currentNodeNeighborInfo.count }})
              <i
                v-if="currentNodeNeighborInfo.isProfligate"
                class="fa-solid fa-triangle-exclamation neighbor-warning"
                title="High connectivity (>10 connections)"
              />
            </span>
            <span v-else>
              Expand Neighbors
            </span>
          </button>

          <button
            v-else
            class="btn btn-sm btn-outline-secondary"
            @click="collapseSelectedNode()"
          >
            <i class="fa-solid fa-up-down-left-right" />
            Collapse Neighbors
          </button>
        </div>

        <div v-if="displayLabel">
          <div class="result-graph__summary-section">
            <h5>{{ sidePanelPropertyTitlePrefix }} Properties</h5>
          </div>
          <div class="result-graph__properties-list">
            <div
              v-for="(property, index) in displayProperties"
              :key="property.name"
              class="property-item"
              :class="{
                'property-item--expanded': expandedProperties[index],
                'property-item--label': property.isLabel
              }"
            >
              <div class="property-name">
                <span class="property-label">{{ property.name }}</span>
                <span
                  v-if="property.isPrimaryKey"
                  class="badge bg-primary pk-badge"
                >PK</span>
              </div>
              <div
                class="property-value copyable-cell"
                @click="togglePropertyExpansion(index)"
              >
                <span class="value-text">{{ property.value }}</span>
                <button
                  class="copy-button"
                  @click.stop="copyToClipboard(property.value)"
                  @mouseenter="showCopyButton($event)"
                  @mouseleave="hideCopyButton($event)"
                >
                  <i class="fa-solid fa-copy" />
                </button>
              </div>
            </div>
          </div>

          <!-- External Resource Links -->
          <ExternalLinksPanel
            v-if="clickedIsNode"
            :entity-type="clickedLabel"
            :properties="clickedProperties"
          />

          <!-- Source Provenance -->
          <SourceProvenancePanel
            v-if="clickedIsNode"
            :properties="clickedProperties"
          />
        </div>
        <div v-else>
          <!-- Overview Actions -->
          <div
            v-if="counters.total.node > 0"
            class="result-graph__actions"
          >
            <button
              v-if="numHiddenNodes > 0"
              class="btn btn-sm btn-outline-secondary"
              @click="showAllNodesRels()"
            >
              <i class="fa-solid fa-eye" />
              Show All
            </button>
            <button
              v-if="hasUnexpandedNodes"
              class="btn btn-sm btn-outline-secondary"
              @click="expandOneMoreHop()"
            >
              <i class="fa-solid fa-diagram-project" />
              <span v-if="expandGraphInfo.hasCount">
                Expand Graph (+{{ expandGraphInfo.willExpand }})
              </span>
              <span v-else>
                Expand Graph
              </span>
            </button>
            <button
              v-else
              class="btn btn-sm btn-outline-secondary"
              disabled
              style="opacity: 0.6; cursor: not-allowed;"
            >
              <i class="fa-solid fa-check-circle" />
              Fully Expanded
            </button>
          </div>

          <!-- Node Counts -->
          <div v-if="counters.total.node > 0">
            <p class="result-graph__count-summary">
              Showing
              <span v-if="numHiddenNodes > 0">
                {{ counters.total.node - numHiddenNodes }}/</span>{{ counters.total.node }} nodes
              <span v-if="numHiddenNodes > 0"> ({{ numHiddenNodes }} hidden)</span>
            </p>
            <table class="table table-sm table-borderless result-graph__overview-table">
              <tbody>
                <tr
                  v-for="label in Object.keys(counters.node)"
                  :key="label"
                >
                  <th scope="row">
                    <span
                      class="badge bg-primary"
                      :style="{ backgroundColor: `${getColor(label)} !important`, textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000', color: 'white !important' }"
                    >{{ label }}</span>
                  </th>
                  <td>{{ counters.node[label] }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Rel Counts -->
          <div v-if="counters.total.rel > 0">
            <p class="result-graph__count-summary">
              Showing
              <span v-if="numHiddenRels > 0">
                {{ counters.total.rel - numHiddenRels }}/</span>{{ counters.total.rel }} rels
              <span v-if="numHiddenRels > 0"> ({{ numHiddenRels }} hidden)</span>
            </p>
            <table class="table table-sm table-borderless result-graph__overview-table">
              <tbody>
                <tr
                  v-for="label in Object.keys(counters.rel)"
                  :key="label"
                >
                  <th scope="row">
                    <span
                      class="badge bg-primary"
                      :style="{
                        backgroundColor: `${getColor(label)} !important`,
                        color: 'white !important',
                        textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                      }"
                    >{{ label }}</span>
                  </th>
                  <td>{{ counters.rel[label] }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="counters.total.node === 0 && counters.total.rel === 0">
            <p>
              <i class="fa-solid fa-circle-info" />
              No nodes or rels to show.
            </p>
          </div>
        </div>
      </div>
    </div>
    <button
      v-show="!isSidePanelOpen"
      class="result-graph__sidebar-button--open"
      data-bs-toggle="tooltip"
      data-bs-placement="right"
      data-bs-original-title="Open Sidebar"
      @click="toggleSidePanel"
    >
      <i class="fa-lg fa-solid fa-angle-left" />
    </button>

    <!-- Toast Notification -->
    <GraphToast
      :message="toastMessage"
      :right-position="isSidePanelOpen ? sidebarWidth + 16 : 16"
      @dismiss="dismissToast"
    />
  </div>
</template>

<script lang="js">
import { Graph, GraphEvent } from '@antv/g6';
import G6Utils from "../../utils/G6Utils";
import {
  DATA_TYPES, UI_SIZE, LOOP_POSITIONS, ARC_CURVE_OFFSETS, GRAPH_LAYOUTS
} from "../../utils/Constants";
import NeighborsFetcher from "../../utils/NeighborsFetcher";
import { useSettingsStore } from "../../store/SettingsStore";
import { useModeStore } from "../../store/ModeStore";
import { mapStores } from 'pinia'
import ValueFormatter from "../../utils/ValueFormatter";
import HoverContainer from "./HoverContainer.vue";
import GraphToast from "./GraphToast.vue";
import ExternalLinksPanel from "./ExternalLinksPanel.vue";
import SourceProvenancePanel from "./SourceProvenancePanel.vue";
import g6Utils from '../../utils/G6Utils';
import Axios from "@/utils/AxiosWrapper";
import { createGraphConfig, getLayoutConfig } from "./graphConfig";

export default {
  name: "ResultGraph",
  components: {
    HoverContainer,
    GraphToast,
    ExternalLinksPanel,
    SourceProvenancePanel
  },
  props: {
    queryResult: {
      type: Object,
      required: false,
      default: null,
    },
    queryInfo: {
      type: Object,
      required: false,
      default: null,
    },
    schema: {
      type: Object,
      required: false,
      default: null,
    },
    containerHeight: {
      type: String,
      required: false,
      default: "auto",
    },
    isMaximized: {
      type: Boolean,
      required: false,
      default: false,
    },
    isSidePanelOpen: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  emits: ["graphEmpty", "requestSidebarToggle"],
  data: () => ({
    graphCreated: false,
    isHighlightedMode: false,
    margin: UI_SIZE.DEFAULT_MARGIN,
    toolbarContainerWidth: UI_SIZE.SHELL_TOOL_BAR_WIDTH,
    sidebarWidth: 350,
    graphWidth: 0,
    borderWidth: UI_SIZE.DEFAULT_BORDER_WIDTH,
    hiddenElements: {
      nodes: {},
      edges: {}
    },
    clickedProperties: [],
    clickedId: null,
    clickedLabel: "",
    clickedIsNode: false,
    isCurrentNodeExpanded: false,
    delta: 0.05, // used for zooming, copied from G6
    zoomSensitivity: 2, // used for zooming, copied from G6
    toolbarDebounceTimeout: 100,
    toolbarDebounceTimer: null,
    counters: {
      node: {},
      rel: {},
      total: {
        node: 0,
        rel: 0,
      },
    },
    draggedNodeDebounceTimer: null,
    expansions: [],
    originalNodeIds: new Set(),
    // Maps nodeId -> expansionId that first introduced this node
    nodeIntroducedBy: {},
    isResizing: false,
    minSidebarWidth: 350,
    maxSidebarWidth: 800,
    isInitialRender: true,
    drawPromise: null,
    expandedProperties: {},
    neighborCounts: {},
    profligateNodes: new Set(),
    neighborCountsLoading: new Set(),
    toastMessage: null,
    toastTimeout: null,
    shownProfligateWarnings: new Set(),
    currentLayout: 'd3-force',
  }),
  computed: {
    graphVizSettings() {
      return this.settingsStore.graphVizSettings;
    },
    performanceSettings() {
      return this.settingsStore.performance;
    },
    maximizeButtonClass() {
      return (this.isEditorMaximized ? "fa-minimize" : "fa-maximize") + " fa-lg fa-solid";
    },
    maximizeButtonTitle() {
      return this.isEditorMaximized ? "Minimize Graph" : "Maximize Graph";
    },
    sidePanelButtonClass() {
      return (this.isSidePanelOpen ? "fa-angle-right" : "fa-angle-left") + " fa-lg fa-solid";
    },
    sidePanelButtonTitle() {
      return this.isSidePanelOpen ? "Close Side Panel" : "Open Side Panel";
    },
    sidePanelPropertyTitlePrefix() {
      const isNode = this.clickedIsNode;
      return isNode ? "Node" : "Rel";
    },
    isNodeSelectedOrHovered() {
      return this.clickedLabel !== "";
    },
    displayLabel() {
      return this.clickedLabel;
    },
    displayProperties() {
      return this.clickedProperties;
    },
    ...mapStores(useSettingsStore, useModeStore),
    labelColor() {
      // Return white for dark mode, dark gray for light mode
      return this.modeStore.theme === 'vs-dark' ? '#ffffff' : '#333333';
    },
    edgeColor() {
      // Return darker grey for dark mode, light grey for light mode
      return this.modeStore.theme === 'vs-dark' ? '#666666' : '#e2e2e2';
    },
    getTextColor() {
      return (label) => {
        const isNode = this.schema.nodeTables.find((table) => table.name === label);
        return isNode ? "#ffffff" : "#ffffff";
      };
    },
    numHiddenNodes() {
      return Object.keys(this.hiddenElements.nodes).length;
    },
    numHiddenRels() {
      return Object.keys(this.hiddenElements.edges).length;
    },
    entityTypeBadgeClass() {
      if (!this.displayLabel) {
        return 'bg-primary';
      }

      const entityType = this.displayLabel;
      if (entityType === 'Person') {
        return 'bg-primary'; // Blue
      } else if (entityType === 'Company') {
        return 'bg-success'; // Green
      } else if (entityType === 'Address') {
        return 'bg-warning'; // Orange
      }

      // Default for relationships or unknown types
      return 'bg-secondary';
    },
    hasUnexpandedNodes() {
      if (!this.g6Graph) return false;

      try {
        const allNodes = this.g6Graph.getNodeData();
        const expandedNodeIds = new Set(this.expansions.map(e => e.id));
        const leafNodes = allNodes.filter(node => !expandedNodeIds.has(node.id));
        return leafNodes.length > 0;
      } catch (e) {
        return false;
      }
    },
    currentNodeNeighborInfo() {
      if (!this.clickedIsNode || !this.clickedId) {
        return null;
      }

      const neighborCount = this.neighborCounts[this.clickedId];
      const isProfligate = this.profligateNodes.has(this.clickedId);
      const isLoading = this.neighborCountsLoading.has(this.clickedId);

      return {
        count: neighborCount,
        isProfligate,
        isLoading,
        hasCount: neighborCount !== undefined
      };
    },
    expandGraphInfo() {
      if (!this.g6Graph || !this.hasUnexpandedNodes) {
        return { willExpand: 0, hasCount: false };
      }

      try {
        const allNodes = this.g6Graph.getNodeData();
        const expandedNodeIds = new Set(this.expansions.map(e => e.id));
        const leafNodes = allNodes.filter(node => !expandedNodeIds.has(node.id));

        let totalNodesToAdd = 0;
        let countedNodes = 0;

        leafNodes.forEach(node => {
          const count = this.neighborCounts[node.id];
          if (count !== undefined && !this.profligateNodes.has(node.id)) {
            totalNodesToAdd += count;
            countedNodes++;
          }
        });

        return {
          willExpand: totalNodesToAdd,
          hasCount: countedNodes > 0
        };
      } catch (e) {
        return { willExpand: 0, hasCount: false };
      }
    },
  },
  watch: {
    performanceSettings: {
      handler(newVal, oldVal) {
        if (newVal.maxNumberOfNodes !== oldVal.maxNumberOfNodes) {
          return this.redrawGraph();
        }
        if (newVal.maxNumberOfNodesWithLabels !== oldVal.maxNumberOfNodesWithLabels) {
          return this.redrawGraph();
        }
      },
      deep: true,
    },
    graphVizSettings(newVal, oldVal) {
      let isRerenderNeeded = false;
      for (let key in this.counters.node) {
        if (newVal.nodes[key] && JSON.stringify(newVal.nodes[key]) !== JSON.stringify(oldVal.nodes[key])) {
          isRerenderNeeded = true;
          break;
        }
      }
      if (!isRerenderNeeded) {
        for (let key in this.counters.rel) {
          if (newVal.rels[key] && JSON.stringify(newVal.rels[key]) !== JSON.stringify(oldVal.rels[key])) {
            isRerenderNeeded = true;
            break;
          }
        }
      }
      if (!isRerenderNeeded) {
        return;
      }
      this.redrawGraph();
    },

    isSidePanelOpen() {
      this.$nextTick(() => {
        this.handleResize();
      });
    },
    'modeStore.theme'() {
      if (this.g6Graph) {
        this.redrawGraph();
      }
    },
  },
  mounted() {
    this.computeGraphWidth();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("mousemove", this.handleResizeMove);
    window.addEventListener("mouseup", this.stopResize);
    if (this.isMaximized) {
      this.$nextTick(() => {
        this.handleResize();
      });
    }
  },
  beforeUnmount() {
    if (this.g6Graph) {
      this.g6Graph.destroy();
    }
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("mousemove", this.handleResizeMove);
    window.removeEventListener("mouseup", this.stopResize);
  },
  methods: {
    copyToClipboard(text) {
      navigator.clipboard?.writeText(text).catch(() => {
        document.execCommand('copy', false, text);
      });

      // Find the button that was clicked and show success state
      const event = window.event;
      if (event && event.target) {
        const button = event.target.closest('.copy-button');
        if (button) {
          const icon = button.querySelector('i');
          if (icon) {
            icon.className = 'fa-solid fa-check';
            button.style.background = '#28a745';
            setTimeout(() => {
              icon.className = 'fa-solid fa-copy';
              button.style.background = 'var(--bs-body-bg-accent)';
            }, 1000);
          }
        }
      }
    },

    showCopyButton(event) {
      const button = event.target.closest('.copyable-cell').querySelector('.copy-button');
      if (button) {
        button.style.opacity = '1';
      }
    },

    hideCopyButton(event) {
      const button = event.target.closest('.copyable-cell').querySelector('.copy-button');
      if (button) {
        button.style.opacity = '0';
      }
    },
    async setElementVisibility(elements) {
      if (!this.g6Graph) {
        return;
      }
      if (this.drawPromise) {
        await this.drawPromise;
      }
      this.drawPromise = this.g6Graph.setElementVisibility(elements);
      await this.drawPromise;
      this.drawPromise = null;
    },
    async render() {
      if (!this.g6Graph) {
        return;
      }
      if (this.drawPromise) {
        await this.drawPromise;
      }
      console.time("G6 graph render");
      this.drawPromise = this.g6Graph.render();
      await this.drawPromise;
      console.timeEnd("G6 graph render");
      this.drawPromise = null;
    },
    async setElementState(elements) {
      if (!this.g6Graph) {
        return;
      }
      if (this.drawPromise) {
        await this.drawPromise;
      }
      this.drawPromise = this.g6Graph.setElementState(elements);
      await this.drawPromise;
      this.drawPromise = null;
    },
    getColor(label) {
      return this.settingsStore.colorForLabel(label);
    },
    /**
     * Initialize an empty G6 graph instance without processing query results.
     *
     * This method creates a new G6 graph with force layout configuration but doesn't
     * extract data from queryResult, preventing the graphEmpty event from firing.
     * Used exclusively for investigation restoration where graph data is loaded directly
     * from saved state rather than query execution.
     *
     * @param {Array} edges - Array of edge objects from saved graph state, used to determine optimal force layout configuration
     * @returns {Promise<void>}
     */
    async initializeEmptyGraph(edges = []) {
      if (this.graphCreated && this.g6Graph) {
        this.g6Graph.destroy();
      }

      const container = this.$refs.graph;
      const width = container.offsetWidth;
      const height = this.containerHeight === "auto" ? container.offsetHeight : parseInt(this.containerHeight);

      // Get saved layout preference from settings store
      const savedLayout = this.settingsStore.graphLayout || 'd3-force';
      this.currentLayout = savedLayout;

      // Create graph with factory config using saved layout
      const graphConfig = createGraphConfig({
        container,
        width,
        height,
        edges,
        labelColor: this.labelColor,
        edgeColor: this.edgeColor,
        layoutType: savedLayout,
      });

      this.g6Graph = new Graph(graphConfig);

      // Set up event handlers
      this.setupGraphEventHandlers();

      this.graphCreated = true;
    },

    /**
     * Register all G6 graph event handlers for user interactions.
     *
     * Sets up listeners for:
     * - Node/edge hover (shows hover tooltip)
     * - Node/edge click (opens sidebar with properties)
     * - Node double-click (expands/collapses neighbors)
     * - Node drag (restarts force simulation)
     * - Canvas click (deselects all elements)
     *
     * This method is extracted from drawGraph() to enable code reuse in both
     * normal query execution flow and investigation restoration flow.
     *
     * @returns {void}
     */
    setupGraphEventHandlers() {
      // Show hover container on node and edge hover
      this.g6Graph.on('node:pointerenter', (e) => {
        const id = e.target.id;
        const nodeData = this.g6Graph.getNodeData(id);
        this.$refs.hoverContainer.handleHover(nodeData, e);
      });

      this.g6Graph.on('node:pointerleave', () => {
        this.$refs.hoverContainer.resetHover();
      });

      this.g6Graph.on('node:pointermove', (e) => {
        this.$refs.hoverContainer.showTooltip(e);
      });

      this.g6Graph.on('edge:pointerenter', (e) => {
        const id = e.target.id;
        const edgeData = this.g6Graph.getEdgeData(id);
        this.$refs.hoverContainer.handleHover(edgeData, e);
      });

      this.g6Graph.on('edge:pointerleave', () => {
        this.$refs.hoverContainer.resetHover();
      });

      this.g6Graph.on('edge:pointermove', (e) => {
        this.$refs.hoverContainer.showTooltip(e);
      });

      // Click node and edge to select it and open side panel
      this.g6Graph.on('node:click', (e) => {
        this.$refs.hoverContainer.resetHover();
        const clickedId = e.target.config.id;
        const nodeData = this.g6Graph.getNodeData(clickedId);
        this.handleClick(nodeData);
        if (!this.isSidePanelOpen) {
          window.setTimeout(() => {
            this.$emit('requestSidebarToggle');
            this.$nextTick(() => {
              this.handleResize();
            });
          }, 200);
        }
      });

      this.g6Graph.on('edge:click', (e) => {
        this.$refs.hoverContainer.resetHover();
        const clickedId = e.target.config.id;
        const edgeData = this.g6Graph.getEdgeData(clickedId);
        this.handleClick(edgeData);
        if (!this.isSidePanelOpen) {
          this.$emit('requestSidebarToggle');
        }
      });

      this.g6Graph.on('node:dblclick', async (e) => {
        const itemId = e.target.id;
        const isCurrentNodeExpanded = this.isNeighborExpanded(e.target);
        if (isCurrentNodeExpanded) {
          await this.collapseNodeById(itemId);
          this.deselectAll();
          return;
        }
        const nodeData = this.g6Graph.getNodeData(itemId);
        this.expandOnNode(nodeData);
        this.deselectAll();
      });

      this.g6Graph.on('node:dragend', () => {
        const layout = this.g6Graph.getLayout();
        if (layout && layout.simulation) {
          // With pinned nodes, we can use full energy without worrying about drift
          layout.simulation.alpha(1.0).restart();
        }
      });

      this.g6Graph.on('canvas:click', () => {
        this.deselectAll();
      });
    },

    async drawGraph() {
      if (this.graphCreated && this.g6Graph) {
        this.g6Graph.destroy();
      }
      if (!this.queryResult) {
        return;
      }
      let { counters, nodes, edges, } = this.extractGraphFromQueryResult(this.queryResult);
      this.counters = counters;
      // Track original node IDs so they're never removed during collapse
      this.originalNodeIds = new Set(nodes.map(n => n.id));
      // Reset expansion tracking for new query
      this.nodeIntroducedBy = {};
      this.expansions = [];
      if (nodes.length === 0) {
        this.$emit("graphEmpty");
      }

      const container = this.$refs.graph;
      const width = container.offsetWidth;
      const height = this.containerHeight === "auto" ? container.offsetHeight : parseInt(this.containerHeight);

      // Get saved layout preference from settings store
      const savedLayout = this.settingsStore.graphLayout || 'd3-force';
      this.currentLayout = savedLayout;

      // Create graph with factory config using saved layout
      const graphConfig = createGraphConfig({
        container,
        width,
        height,
        edges,
        labelColor: this.labelColor,
        edgeColor: this.edgeColor,
        layoutType: savedLayout,
      });

      this.g6Graph = new Graph(graphConfig);

      this.g6Graph.setData({ nodes, edges, });
      await this.render();

      // Fit with padding, but cap max zoom to prevent extreme zoom-in on single nodes
      // Disable animation so we can cap zoom without visible jump
      this.g6Graph.fitView([150, 150], { duration: 0 });
      const currentZoom = this.g6Graph.getZoom();
      if (currentZoom > 1.0) {
        this.g6Graph.zoomTo(1.0, { duration: 0 });
      }

      // Fit the graph to view after rendering
      this.g6Graph.on(GraphEvent.AFTER_RENDER, () => {
        console.timeEnd("G6 graph render");
      });

      // Set up event handlers (hover, click, double-click, etc.)
      this.setupGraphEventHandlers();

      this.graphCreated = true;

      // Automatically open sidebar to show overview after initial graph load
      if (!this.isSidePanelOpen) {
        this.$emit('requestSidebarToggle');
        this.$nextTick(() => {
          this.handleResize();
        });
      }

      // Trigger neighbor count update for all leaf nodes
      this.$nextTick(() => {
        this.updateNeighborCounts();
      });
    },

    hideNode() {
      this.hiddenElements.nodes[this.clickedId] = 'hidden';
      const nodeId = this.clickedId;
      this.deselectAll();

      const edges = this.g6Graph.getEdgeData();
      const relatedEdges = edges.filter((edge) => {
        return edge.source === nodeId || edge.target === nodeId;
      });
      relatedEdges.forEach((edge) => this.hiddenElements.edges[edge.id] = 'hidden');
      const combined = { ...this.hiddenElements.nodes, ...this.hiddenElements.edges };
      return this.setElementVisibility(combined);
    },

    enableHighlightMode() {
      this.g6Graph.updateBehavior({ key: 'click-select-element', enable: false });
      this.g6Graph.updateBehavior({ key: 'click-highlight', enable: true });
      this.isHighlightedMode = true;

      if (!this.clickedId) return;

      const combined = {};
      const activeNodes = new Set([this.clickedId]);

      // Mark active edges and connected nodes
      this.g6Graph.getEdgeData().forEach(edge => {
        const isConnected = edge.source === this.clickedId || edge.target === this.clickedId;
        combined[edge.id] = isConnected ? ['active'] : ['inactive'];

        if (isConnected) {
          activeNodes.add(edge.source);
          activeNodes.add(edge.target);
        }
      });
      this.g6Graph.getNodeData().forEach(node => {
        combined[node.id] = activeNodes.has(node.id) ? ['active'] : ['inactive'];
      });
      this.setElementState(combined);

    },

    disableHighlightMode() {
      this.g6Graph.updateBehavior({ key: 'click-select-element', enable: true });
      this.g6Graph.updateBehavior({ key: 'click-highlight', enable: false });
      this.isHighlightedMode = false;
      const inactiveNodes = this.g6Graph.getElementDataByState('node', 'inactive');
      const inactiveEdges = this.g6Graph.getElementDataByState('edge', 'inactive');
      const combined = {};
      inactiveNodes.forEach((node) => {
        combined[node.id] = [];
      });
      inactiveEdges.forEach((edge) => {
        combined[edge.id] = [];
      });
      this.setElementState(combined);
      this.deselectAll();
    },

    showAllNodesRels() {
      const combined = { ...this.hiddenElements.nodes, ...this.hiddenElements.edges };
      Object.keys(combined).forEach((key) => {
        combined[key] = 'visible';
      });
      return this.setElementVisibility(combined).then(() => {
        this.hiddenElements = { nodes: {}, edges: {} };
      });
    },

    encodeId(id) {
      return `${id.table}_${id.offset}`;
    },

    getNodeIcon(nodeLabel) {
      // Font Awesome 6 unicode characters
      const iconMap = {
        'Person': '\uf007',      // fa-user
        'Company': '\uf1ad',     // fa-building
        'Address': '\uf3c5',     // fa-map-marker-alt
      };
      return iconMap[nodeLabel] || '\uf111'; // fa-circle as fallback
    },

    extractGraphFromQueryResult(queryResult) {
      const rows = queryResult.rows;
      const dataTypes = queryResult.dataTypes;
      const nodes = {};
      const edges = {};
      const numberOfRelsBetweenNodes = {};
      const nodeLabels = {};

      const sortNodes = (src, dst) => {
        const sortedLabels = [src.table, dst.table].sort();
        const sortedSrcDst = [src.offset, dst.offset].sort();
        return [sortedLabels[0], sortedSrcDst[0], sortedLabels[1], sortedSrcDst[1]];
      }

      const increaseRelCounter = (src, dst) => {
        const sortedNodeInfo = sortNodes(src, dst);
        if (!numberOfRelsBetweenNodes[sortedNodeInfo[0]]) {
          numberOfRelsBetweenNodes[sortedNodeInfo[0]] = {};
        }
        if (!numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]]) {
          numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]] = {};
        }
        if (!numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]][sortedNodeInfo[1]]) {
          numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]][sortedNodeInfo[1]] = {};
        }
        const currentMap = numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]][sortedNodeInfo[1]];
        if (!currentMap[sortedNodeInfo[3]]) {
          currentMap[sortedNodeInfo[3]] = 0;
        }
        currentMap[sortedNodeInfo[3]] += 1;
        return currentMap[sortedNodeInfo[3]];
      }
      const processNode = (rawNode) => {
        if (!rawNode || !rawNode._id || !rawNode._label) {
          console.warn('Invalid node data:', rawNode);
          return;
        }

        const nodeId = this.encodeId(rawNode._id);
        nodeLabels[rawNode._id.table] = rawNode._label;
        const nodeSettings = this.settingsStore.settingsForLabel(rawNode._label);
        const nodeFill = nodeSettings.g6Settings.style.fill;
        const labelColor = G6Utils.getReadableTextColor(nodeFill);

        if (nodes[nodeId]) {
          return;
        }

        const expectedPropertiesType = {};
        const nodeTable = this.schema.nodeTables.find((table) => table.name === rawNode._label);
        if (!nodeTable) {
          console.warn('Node table not found for label:', rawNode._label);
          return;
        }
        const expectedProperties = nodeTable.properties;
        expectedProperties.forEach((property) => {
          expectedPropertiesType[property.name] = property.type;
        });

        let nodeLabel = "";
        const nodeLabelProp = nodeSettings.label;
        if (nodeLabelProp) {
          nodeLabel = rawNode[nodeLabelProp];
          if (nodeLabelProp in expectedPropertiesType) {
            nodeLabel = ValueFormatter.beautifyValue(rawNode[nodeLabelProp], expectedPropertiesType[nodeLabelProp]);
          }
          nodeLabel = String(nodeLabel);
          // Don't truncate - let G6's labelMaxWidth and word wrap handle it
        }

        // Cap node size to prevent extreme zoom when there are few nodes
        const maxNodeSize = 100;
        const displaySize = Math.min(nodeSettings.g6Settings.size, maxNodeSize);

        const g6Node = {
          id: nodeId,
          data: {
            properties: rawNode,
            ...nodeSettings.g6Settings,
          },
          style: {
            size: displaySize,
            fill: nodeFill,
            stroke: G6Utils.shadeColor(nodeFill),
            lineWidth: nodeSettings.g6Settings.style.lineWidth || 0,
            labelText: nodeLabel,
            // labelFill inherited from graph-level config
            iconText: this.getNodeIcon(rawNode._label),
            iconFontFamily: "Font Awesome 6 Free",
            iconFontWeight: 900,
            iconFontSize: displaySize * 0.35,
            iconFill: "#ffffff",
          },
        };

        nodes[nodeId] = g6Node;
      };

      const processRel = (rawRel) => {
        if (!rawRel || !rawRel._id || !rawRel._label || !rawRel._src || !rawRel._dst) {
          console.warn('Invalid rel data:', rawRel);
          return;
        }

        const relSettings = this.settingsStore.settingsForLabel(rawRel._label);
        const relId = this.encodeId(rawRel._id);
        const numberOfOverlappingRels = increaseRelCounter(rawRel._src, rawRel._dst);

        if (edges[relId]) {
          return;
        }

        const expectedPropertiesType = {};
        const relTable = this.schema.relTables.find((table) => table.name === rawRel._label);
        if (!relTable) {
          console.warn('Rel table not found for label:', rawRel._label);
          return;
        }
        const expectedProperties = relTable.properties;
        expectedProperties.forEach((property) => {
          expectedPropertiesType[property.name] = property.type;
        });

        let relLabel = "";
        const relLabelProp = relSettings.label;
        if (relLabelProp) {
          relLabel = rawRel[relLabelProp];
          if (relLabelProp === '_label' && relTable.group) {
            relLabel = relTable.group;
          }
          if (relLabelProp in expectedPropertiesType) {
            relLabel = ValueFormatter.beautifyValue(rawRel[relLabelProp], expectedPropertiesType[relLabelProp]);
          }
          relLabel = String(relLabel);
          const fontSize = relSettings.g6Settings.labelCfg.style.fontSize;
          // Truncate edge label to max width 80px
          relLabel = G6Utils.fittingString(relLabel, 80, fontSize);
        }

        const g6Rel = {
          id: relId,
          source: this.encodeId(rawRel._src),
          target: this.encodeId(rawRel._dst),
          data: {
            properties: rawRel,
            ...relSettings.g6Settings,
          },
          style: {
            stroke: relSettings.g6Settings.style.stroke,
            lineWidth: relSettings.g6Settings.size || 3,
            labelText: relLabel,
          },
        };

        // Handle self-loops and overlapping edges
        if (g6Rel.source === g6Rel.target) {
          // Self-loop (do not set type, otherwise it will not work)
          g6Rel.style.loopDist = 50;
          g6Rel.style.loopPlacement = LOOP_POSITIONS[(numberOfOverlappingRels - 1) % LOOP_POSITIONS.length];
        } else if (numberOfOverlappingRels > 1) {
          g6Rel.type = 'quadratic';
          g6Rel.style.curveOffset = ARC_CURVE_OFFSETS[(numberOfOverlappingRels - 1) % ARC_CURVE_OFFSETS.length];
          g6Rel.style.curvePosition = 0.5;
        } else {
          g6Rel.type = 'line';
        }

        edges[relId] = g6Rel;
      }
      // Deduplicate nodes and edges
      rows.forEach((row) => {
        for (let key in row) {
          switch (dataTypes[key]) {
            case DATA_TYPES.NODE: {
              if (!row[key] || !row[key]._id) {
                continue;
              }
              const node = { ...row[key] };
              processNode(node);
              break;
            }
            case DATA_TYPES.REL: {
              if (!row[key] || !row[key]._src || !row[key]._dst) {
                continue;
              }
              const rel = { ...row[key] };
              processRel(rel);
              break;
            }
            case DATA_TYPES.RECURSIVE_REL: {
              const recursiveRel = { ...row[key] };
              if (recursiveRel._nodes && Array.isArray(recursiveRel._nodes)) {
                recursiveRel._nodes.forEach((node) => {
                  if (!node || !node._id) return;
                  node = { ...node };
                  const nodeId = this.encodeId(node._id);
                  if (nodes[nodeId]) {
                    return;
                  }
                  for (let key in node) {
                    if (node[key] === null || node[key] === undefined) {
                      delete node[key];
                    }
                  }
                  processNode(node);
                });
              }
              if (recursiveRel._rels && Array.isArray(recursiveRel._rels)) {
                recursiveRel._rels.forEach((rel) => {
                  if (!rel || !rel._id) return;
                  rel = { ...rel };
                  const relId = this.encodeId(rel._id);
                  if (edges[relId]) {
                    return;
                  }
                  for (let key in rel) {
                    if (rel[key] === null || rel[key] === undefined) {
                      delete rel[key];
                    }
                  }
                  processRel(rel);
                });
              }
              break;
            }
            default:
              break;
          }
        }
      });
      if (Object.keys(nodes).length > this.settingsStore.performance.maxNumberOfNodes) {
        const nodeIds = Object.keys(nodes);
        while (nodeIds.length > this.settingsStore.performance.maxNumberOfNodes) {
          const indexToRemove = Math.floor(Math.random() * nodeIds.length);
          const nodeIdToRemove = nodeIds[indexToRemove];
          delete nodes[nodeIdToRemove];
          nodeIds.splice(indexToRemove, 1);
        }
        for (let key in edges) {
          const edge = edges[key];
          if (!nodes[edge.source] || !nodes[edge.target]) {
            delete edges[key];
          }
        }
      }
      const nodeCounters = {};
      for (let key in nodes) {
        const label = nodes[key].data.properties._label;
        if (!nodeCounters[label]) {
          nodeCounters[label] = 0;
        }
        nodeCounters[label] += 1;
      }
      const relCounters = {};
      for (let key in edges) {
        const label = edges[key].data.properties._label;
        if (!relCounters[label]) {
          relCounters[label] = 0;
        }
        relCounters[label] += 1;
      }
      const totalNodeCount = Object.values(nodeCounters).reduce((a, b) => a + b, 0);
      const totalRelCount = Object.values(relCounters).reduce((a, b) => a + b, 0);
      const counters = {
        node: nodeCounters,
        rel: relCounters,
        total: {
          node: totalNodeCount,
          rel: totalRelCount,
        },
      };
      // Calculate node degrees for dynamic distance
      const nodeDegrees = {};
      Object.values(edges).forEach(edge => {
        nodeDegrees[edge.source] = (nodeDegrees[edge.source] || 0) + 1;
        nodeDegrees[edge.target] = (nodeDegrees[edge.target] || 0) + 1;
      });

      // Add degree information to node data
      Object.values(nodes).forEach(node => {
        node.data.degree = nodeDegrees[node.id] || 0;
      });

      if (totalNodeCount > this.settingsStore.performance.maxNumberOfNodesWithLabels) {
        for (let key in nodes) {
          const node = nodes[key];
          delete node.style.labelText;
        }
        for (let key in edges) {
          const edge = edges[key];
          delete edge.style.labelText;
        }
      }

      return {
        counters,
        nodes: Object.values(nodes),
        edges: Object.values(edges),
        nodesMap: nodes,
        edgesMap: edges,
      };
    },

    handleResize() {
      this.$nextTick(() => {
        if (this.g6Graph) {
          const width = this.$refs.graph.offsetWidth;

          // Set graph size based on sidebar state
          if (this.isSidePanelOpen) {
            this.g6Graph.setSize(width - this.sidebarWidth, parseInt(this.containerHeight));
          } else {
            this.g6Graph.setSize(width, parseInt(this.containerHeight));
          }

        }
      });
    },

    handleClick(model) {
      const properties = model.data.properties;
      const label = properties._label;
      this.clickedLabel = label;
      this.clickedId = model.id;
      this.clickedProperties = ValueFormatter.filterAndBeautifyProperties(properties, this.schema);
      this.clickedIsNode = !(properties._src && properties._dst);
      this.expandedProperties = {}; // Reset expanded properties when clicking a new node/edge
      if (this.clickedIsNode) {
        this.isCurrentNodeExpanded = this.isNeighborExpanded(model);
        // Trigger neighbor count if not already counted
        if (this.neighborCounts[model.id] === undefined) {
          this.countNewNeighbors(model.id);
        }
      }
    },

    togglePropertyExpansion(index) {
      this.expandedProperties = {
        ...this.expandedProperties,
        [index]: !this.expandedProperties[index]
      };
    },

    getInfoForExpansion(model) {
      const properties = model.data.properties;
      const tableName = properties._label;
      const primaryKey = this.schema.nodeTables
        .find((table) => table.name === tableName)
        .properties
        .find((prop) => prop.isPrimaryKey);
      const primaryKeyValue = properties[primaryKey.name];
      const primaryKeyName = primaryKey.name;
      return { tableName, primaryKey, primaryKeyValue, primaryKeyName };
    },

    async countNewNeighbors(nodeId) {
      // Check if already loading or cached
      if (this.neighborCountsLoading.has(nodeId)) {
        return null;
      }
      if (this.neighborCounts[nodeId] !== undefined) {
        return this.neighborCounts[nodeId];
      }

      // Mark as loading
      this.neighborCountsLoading.add(nodeId);

      try {
        const nodeData = this.g6Graph.getNodeData(nodeId);
        const { tableName, primaryKeyName, primaryKeyValue } = this.getInfoForExpansion(nodeData);
        const sizeLimit = this.settingsStore.performance.maxNumberOfNodesToExpand;

        // Fetch neighbors
        const neighbors = await NeighborsFetcher.fetchNeighbors(
          tableName,
          primaryKeyName,
          primaryKeyValue,
          sizeLimit,
          this.modeStore.isWasm
        );

        if (!neighbors || !neighbors.rows) {
          this.neighborCounts[nodeId] = 0;
          return 0;
        }

        // Count NEW neighbor NODES only (not edges)
        let newCount = 0;
        const { nodes } = this.extractGraphFromQueryResult(neighbors);

        nodes.forEach(n => {
          try {
            this.g6Graph.getNodeData(n.id);
            // Node exists, don't count
          } catch (e) {
            // Node doesn't exist, count it
            newCount++;
          }
        });

        this.neighborCounts[nodeId] = newCount;

        // Mark as profligate if >10 new neighbors
        if (newCount > 10) {
          this.profligateNodes.add(nodeId);
          this.updateNodeBadge(nodeId, true);
        } else {
          this.profligateNodes.delete(nodeId);
          this.updateNodeBadge(nodeId, false);
        }

        return newCount;
      } catch (e) {
        console.error("Failed to count neighbors:", e);
        this.neighborCounts[nodeId] = 0;
        return 0;
      } finally {
        this.neighborCountsLoading.delete(nodeId);
      }
    },

    async updateNeighborCounts() {
      if (!this.g6Graph) return;

      try {
        // Get all currently visible nodes
        const allNodes = this.g6Graph.getNodeData();

        // Find leaf nodes (nodes that are visible but not yet expanded)
        const expandedNodeIds = new Set(this.expansions.map(e => e.id));
        const leafNodes = allNodes.filter(node => !expandedNodeIds.has(node.id));

        // Count neighbors for all leaf nodes asynchronously
        // Don't await - let this run in the background
        Promise.all(
          leafNodes.map(node => this.countNewNeighbors(node.id))
        ).catch(e => {
          console.error("Error updating neighbor counts:", e);
        });
      } catch (e) {
        console.error("Failed to update neighbor counts:", e);
      }
    },

    async expandOnNode(model) {
      const { tableName, primaryKey, primaryKeyValue, primaryKeyName } = this.getInfoForExpansion(model);
      const sizeLimit = this.settingsStore.performance.maxNumberOfNodesToExpand;
      let neighbors = null;
      try {
        neighbors = await NeighborsFetcher.fetchNeighbors(
          tableName,
          primaryKeyName,
          primaryKeyValue,
          sizeLimit,
          this.modeStore.isWasm
        );
      } catch (e) {
        // Ignore error for now. Just don't expand if the core does not execute the query.
        console.error(e);
        return;
      }
      if (!neighbors) {
        return;
      }
      this.addDataWithQueryResult(neighbors);
      this.expansions.push({
        id: model.id, neighbors
      });

      // Track which expansion introduced each new node (only if not already tracked)
      neighbors.rows.forEach((row) => {
        if (row.dst && row.dst._id) {
          const nodeId = this.encodeId(row.dst._id);
          if (!this.nodeIntroducedBy[nodeId] && !this.originalNodeIds.has(nodeId)) {
            this.nodeIntroducedBy[nodeId] = model.id;
          }
        }
      });

      this.isCurrentNodeExpanded = true;

      // Trigger neighbor count update for any new leaf nodes
      this.$nextTick(() => {
        this.updateNeighborCounts();
      });
    },

    isNeighborExpanded(model) {
      const id = model.id;
      return this.expansions.some((e) => {
        return e.id === id;
      });
    },

    expandSelectedNode() {
      const nodeData = this.g6Graph.getNodeData(this.clickedId);
      this.expandOnNode(nodeData);
    },

    async expandOneMoreHop() {
      if (!this.g6Graph) return;

      const sizeLimit = this.settingsStore.performance.maxNumberOfNodesToExpand;

      // Get all currently visible nodes
      const allNodes = this.g6Graph.getNodeData();

      // Find leaf nodes (nodes that are visible but not yet expanded)
      const expandedNodeIds = new Set(this.expansions.map(e => e.id));
      const leafNodes = allNodes.filter(node => !expandedNodeIds.has(node.id));

      if (leafNodes.length === 0) {
        // This shouldn't happen since button is disabled, but just in case
        return;
      }

      // Prepare to fetch neighbors for all leaf nodes
      const fetchPromises = leafNodes.map(async (node) => {
        try {
          const { tableName, primaryKeyName, primaryKeyValue } = this.getInfoForExpansion(node);

          const neighbors = await NeighborsFetcher.fetchNeighbors(
            tableName,
            primaryKeyName,
            primaryKeyValue,
            sizeLimit,
            this.modeStore.isWasm
          );

          return { nodeId: node.id, neighbors };
        } catch (e) {
          console.error("Failed to fetch neighbors:", e);
          return { nodeId: node.id, neighbors: null };
        }
      });

      const results = await Promise.all(fetchPromises);
      const validResults = results.filter(r => r.neighbors !== null && r.neighbors.rows && r.neighbors.rows.length > 0);

      if (validResults.length === 0) {
        this.showToast("No new neighbors found", 3000);
        return;
      }

      // Count NEW neighbors for each node and classify as profligate or normal
      const nodesToExpand = [];
      const profligateNodes = [];

      for (const result of validResults) {
        const { nodeId, neighbors } = result;
        const { nodes } = this.extractGraphFromQueryResult(neighbors);

        // Count NEW neighbor NODES only (not edges)
        let newCount = 0;
        nodes.forEach(n => {
          try {
            this.g6Graph.getNodeData(n.id);
            // Node exists, don't count
          } catch (e) {
            // Node doesn't exist, count it
            newCount++;
          }
        });

        // Classify node based on new neighbor count
        if (newCount > 10) {
          profligateNodes.push({ nodeId, neighbors, newCount });
          // Mark as profligate
          this.profligateNodes.add(nodeId);
          this.neighborCounts[nodeId] = newCount;
          this.updateNodeBadge(nodeId, true);
        } else {
          nodesToExpand.push({ nodeId, neighbors, newCount });
        }
      }

      if (nodesToExpand.length === 0 && profligateNodes.length > 0) {
        // Only profligate nodes remain - ALWAYS show a warning so user knows why nothing happened
        this.showToast(`All ${profligateNodes.length} remaining nodes have >10 connections. Double-click nodes individually to expand.`, 4000);
        return;
      }

      // Calculate total entities from normal nodes only
      let newNodes = new Set();
      let newEdges = new Set();

      nodesToExpand.forEach(({ neighbors }) => {
        const { nodes, edges } = this.extractGraphFromQueryResult(neighbors);
        nodes.forEach(n => {
          try {
            this.g6Graph.getNodeData(n.id);
          } catch (e) {
            newNodes.add(n.id);
          }
        });
        edges.forEach(e => {
          try {
            this.g6Graph.getEdgeData(e.id);
          } catch (err) {
            newEdges.add(e.id);
          }
        });
      });

      // Add normal nodes only
      nodesToExpand.forEach(({ nodeId, neighbors }) => {
        this.addDataWithQueryResult(neighbors);
        this.expansions.push({
          id: nodeId,
          neighbors: neighbors
        });
        // Track which expansion introduced each new node
        neighbors.rows.forEach((row) => {
          if (row.dst && row.dst._id) {
            const newNodeId = this.encodeId(row.dst._id);
            if (!this.nodeIntroducedBy[newNodeId] && !this.originalNodeIds.has(newNodeId)) {
              this.nodeIntroducedBy[newNodeId] = nodeId;
            }
          }
        });
      });

      this.deselectAll();

      // Show message about profligate nodes (only once)
      if (profligateNodes.length > 0) {
        let needsWarning = false;
        profligateNodes.forEach(p => {
          if (!this.shownProfligateWarnings.has(p.nodeId)) {
            needsWarning = true;
            this.shownProfligateWarnings.add(p.nodeId);
          }
        });

        if (needsWarning) {
          this.showToast(`Skipped ${profligateNodes.length} highly-connected nodes (>10 connections). Double-click to expand individually.`, 5000);
        }
      }

      // Trigger neighbor count update for any new leaf nodes
      this.$nextTick(() => {
        this.updateNeighborCounts();
      });
    },

    /**
     * Get all expansion IDs that should be removed when collapsing a node.
     * This includes the node itself and any nodes that were introduced by it (recursively).
     */
    getExpansionSubtree(id, visited = new Set()) {
      if (visited.has(id)) return visited;
      visited.add(id);

      // Find all nodes that were introduced by this expansion
      Object.entries(this.nodeIntroducedBy).forEach(([nodeId, introducedBy]) => {
        if (introducedBy === id) {
          // If this introduced node was also expanded, include its subtree
          const isExpanded = this.expansions.some(e => e.id === nodeId);
          if (isExpanded) {
            this.getExpansionSubtree(nodeId, visited);
          }
        }
      });

      return visited;
    },

    collapseNode(id) {
      // Get all expansions in this subtree (this node + any nodes it introduced that were expanded)
      const subtree = this.getExpansionSubtree(id);

      // Remove all expansions in the subtree
      this.expansions = this.expansions.filter((e) => !subtree.has(e.id));
    },

    /**
     * Extract node and edge IDs from an expansion's neighbors result.
     * Note: The NeighborsFetcher query returns 'r' for relationship and 'dst' for destination node.
     */
    getExpansionIds(neighbors) {
      const nodeIds = new Set();
      const edgeIds = new Set();
      neighbors.rows.forEach((row) => {
        if (row.dst && row.dst._id) {
          nodeIds.add(this.encodeId(row.dst._id));
        }
        if (row.r && row.r._id) {
          edgeIds.add(this.encodeId(row.r._id));
        }
      });
      return { nodeIds, edgeIds };
    },

    /**
     * Collect node/edge IDs from this expansion and all child expansions in the subtree.
     * @param {string} id - The node ID to collect targets for
     */
    collectCollapseTargets(id) {
      const allNodeIds = new Set();
      const allEdgeIds = new Set();

      // Get all expansion IDs in the subtree
      const subtree = this.getExpansionSubtree(id);

      // Collect nodes/edges from all expansions in the subtree
      subtree.forEach((expansionId) => {
        const expansion = this.expansions.find((e) => e.id === expansionId);
        if (expansion) {
          const { nodeIds, edgeIds } = this.getExpansionIds(expansion.neighbors);
          nodeIds.forEach(nid => allNodeIds.add(nid));
          edgeIds.forEach(eid => allEdgeIds.add(eid));
        }
      });

      return { nodeIds: allNodeIds, edgeIds: allEdgeIds };
    },

    /**
     * Get node and edge IDs that should never be removed during collapse.
     * This includes original query result nodes and all nodes/edges from remaining active expansions.
     */
    getProtectedIds() {
      const protectedNodeIds = new Set(this.originalNodeIds);
      const protectedEdgeIds = new Set();

      // Add the source nodes and destination nodes/edges of remaining active expansions
      this.expansions.forEach((exp) => {
        protectedNodeIds.add(exp.id); // The expanded node itself (source of expansion)
        // Protect all nodes and edges reachable from remaining expansions
        exp.neighbors.rows.forEach((row) => {
          if (row.dst && row.dst._id) {
            const nodeId = this.encodeId(row.dst._id);
            protectedNodeIds.add(nodeId);
          }
          if (row.r && row.r._id) {
            protectedEdgeIds.add(this.encodeId(row.r._id));
          }
        });
      });

      return { protectedNodeIds, protectedEdgeIds };
    },

    /**
     * Collapse a node by ID - collects targets, updates expansions, removes nodes from graph.
     * This is the core collapse logic used by both collapseSelectedNode() and double-click handler.
     */
    async collapseNodeById(id) {
      // Early return if node was never expanded
      const wasExpanded = this.expansions.some(e => e.id === id);
      if (!wasExpanded) {
        return;
      }

      // 1. Collect all IDs to potentially remove BEFORE modifying expansions
      const targets = this.collectCollapseTargets(id);

      // 2. Update expansions tracking (handles recursion)
      this.collapseNode(id);

      // 3. Get protected nodes and edges (after expansions array is updated)
      const { protectedNodeIds, protectedEdgeIds } = this.getProtectedIds();

      // 4. Filter out protected nodes and edges from removal sets
      const nodeIdsToRemove = new Set(
        [...targets.nodeIds].filter(nodeId => !protectedNodeIds.has(nodeId))
      );
      const edgeIdsToRemove = new Set(
        [...targets.edgeIds].filter(edgeId => !protectedEdgeIds.has(edgeId))
      );

      // 5. Remove from graph
      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);

      // 6. Clean up nodeIntroducedBy for removed nodes
      nodeIdsToRemove.forEach(nodeId => {
        delete this.nodeIntroducedBy[nodeId];
      });

      // 7. Update isCurrentNodeExpanded if this was the clicked node
      if (id === this.clickedId) {
        this.isCurrentNodeExpanded = false;
      }

      // 8. Trigger neighbor count update
      this.$nextTick(() => {
        this.updateNeighborCounts();
      });
    },

    /**
     * Remove specified nodes/edges from the graph and update counters.
     */
    async removeFromGraph(nodeIdsToRemove, edgeIdsToRemove) {
      if (!this.g6Graph) return;
      if (nodeIdsToRemove.size === 0 && edgeIdsToRemove.size === 0) return;

      const currentNodes = this.g6Graph.getNodeData() || [];
      const currentEdges = this.g6Graph.getEdgeData() || [];

      // Filter nodes - keep nodes NOT in removal set
      const filteredNodes = currentNodes.filter(n => !nodeIdsToRemove.has(n.id));

      // Build set of remaining node IDs for edge validation
      const remainingNodeIds = new Set(filteredNodes.map(n => n.id));

      // Filter edges - keep edges that:
      // 1. Are NOT in removal set, AND
      // 2. Have both source and target in remaining nodes
      const filteredEdges = currentEdges.filter(e =>
        !edgeIdsToRemove.has(e.id) &&
        remainingNodeIds.has(e.source) &&
        remainingNodeIds.has(e.target)
      );

      // Update counters for removed nodes (with bounds checking to prevent underflow)
      const actualRemovedNodes = currentNodes.filter(n => nodeIdsToRemove.has(n.id));
      actualRemovedNodes.forEach(node => {
        const label = node.data?.properties?._label;
        if (label && this.counters.node[label] > 0) {
          this.counters.node[label] -= 1;
        }
        if (this.counters.total.node > 0) {
          this.counters.total.node -= 1;
        }
      });

      // Update counters for removed edges (with bounds checking to prevent underflow)
      const removedEdgeIds = new Set(currentEdges.map(e => e.id));
      filteredEdges.forEach(e => removedEdgeIds.delete(e.id));
      currentEdges.forEach(edge => {
        if (removedEdgeIds.has(edge.id)) {
          const label = edge.data?.properties?._label;
          if (label && this.counters.rel[label] > 0) {
            this.counters.rel[label] -= 1;
          }
          if (this.counters.total.rel > 0) {
            this.counters.total.rel -= 1;
          }
        }
      });

      // Pin remaining nodes at their current positions to prevent layout drift
      const pinnedNodes = filteredNodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          fx: node.style?.x,
          fy: node.style?.y
        }
      }));

      // Update graph with filtered data
      this.g6Graph.setData({ nodes: pinnedNodes, edges: filteredEdges });
      await this.render();
    },

    collapseSelectedNode() {
      this.collapseNodeById(this.clickedId);
    },

    addDataWithQueryResult(queryResult) {
      const { nodes, edges } = this.extractGraphFromQueryResult(queryResult);
      this.addData(nodes, edges);
    },

    async addData(nodes, edges) {
      if (!this.g6Graph) {
        return;
      }
      const nodesToAdd = [];
      for (let key in nodes) {
        const node = nodes[key];
        try {
          this.g6Graph.getNodeData(node.id);
          // Node already exists, skip it
          continue;
        } catch (error) {
          // Do nothing, the node does not exist, we can add it
        }
        nodesToAdd.push(node);
        if (!this.counters.node[node.data.properties._label]) {
          this.counters.node[node.data.properties._label] = 0;
        }
        this.counters.node[node.data.properties._label] += 1;
        this.counters.total.node += 1;
      }
      const edgesToAdd = [];
      for (let key in edges) {
        const edge = edges[key];
        try {
          this.g6Graph.getEdgeData(edge.id);
          // Edge already exists, skip it
          continue;
        } catch (error) {
          // Do nothing, the edge does not exist, we can add it
        }
        edgesToAdd.push(edge);
        if (!this.counters.rel[edge.data.properties._label]) {
          this.counters.rel[edge.data.properties._label] = 0;
        }
        this.counters.rel[edge.data.properties._label] += 1;
        this.counters.total.rel += 1;
      }
      const currentNodes = this.g6Graph.getNodeData() || [];
      const currentEdges = this.g6Graph.getEdgeData() || [];

      // PIN existing nodes at their current positions to prevent drift during expansion
      // This preserves the user's mental map while allowing new nodes to be positioned naturally
      const pinnedExistingNodes = currentNodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          fx: node.style.x,  // Fix x position
          fy: node.style.y   // Fix y position
        }
      }));

      // New nodes DON'T have fx/fy, so force layout will position them
      const newData = {
        nodes: pinnedExistingNodes.concat(nodesToAdd),
        edges: currentEdges.concat(edgesToAdd),
      };
      this.g6Graph.setData(newData);
      await this.render();

      // Trigger neighbor count update for any new leaf nodes
      this.$nextTick(() => {
        this.updateNeighborCounts();
      });
    },

    deselectAll() {
      const selectedNodes = this.g6Graph.getElementDataByState('node', 'active');
      const selectedEdges = this.g6Graph.getElementDataByState('edge', 'active');
      const combined = {};
      selectedNodes.forEach((node) => {
        combined[node.id] = [];
      });
      selectedEdges.forEach((edge) => {
        combined[edge.id] = [];
      });
      this.setElementState(combined);
      this.clickedLabel = "";
      this.clickedId = null;
      this.clickedProperties = [];
      this.clickedIsNode = false;
    },

    toggleSidePanel() {
      this.$emit('requestSidebarToggle');
      this.$nextTick(() => {
        this.handleResize();
      });
    },

    computeGraphWidth() {
      let width = document.documentElement.clientWidth || document.body.clientWidth;
      width -= this.margin * 2;
      width -= this.toolbarContainerWidth * 2;
      width -= 2 * this.borderWidth;
      this.graphWidth = width;
      return width;
    },

    zoomIn() {
      if (this.toolbarDebounceTimer) {
        clearTimeout(this.toolbarDebounceTimer);
      }
      this.toolbarDebounceTimer = setTimeout(() => {
        G6Utils.zoomIn(this.g6Graph);
      }, this.toolbarDebounceTimeout);
    },

    zoomOut() {
      if (this.toolbarDebounceTimer) {
        clearTimeout(this.toolbarDebounceTimer);
      }
      this.toolbarDebounceTimer = setTimeout(() => {
        G6Utils.zoomOut(this.g6Graph);
      }, this.toolbarDebounceTimeout);
    },

    fitToView() {
      if (this.toolbarDebounceTimer) {
        clearTimeout(this.toolbarDebounceTimer);
      }
      this.toolbarDebounceTimer = setTimeout(() => {
        G6Utils.fitToView(this.g6Graph);
      }, this.toolbarDebounceTimeout);
    },

    actualSize() {
      if (this.toolbarDebounceTimer) {
        clearTimeout(this.toolbarDebounceTimer);
      }
      this.toolbarDebounceTimer = setTimeout(() => {
        G6Utils.actualSize(this.g6Graph);
      }, this.toolbarDebounceTimeout);
    },

    /**
     * Change the graph layout type
     *
     * @param {string} layoutType - Layout type key (d3-force, circular, radial, dagre, concentric)
     */
    async changeLayout(layoutType) {
      if (!this.g6Graph || this.currentLayout === layoutType) {
        return;
      }

      const previousLayout = this.currentLayout;

      // Get new layout configuration
      const edges = this.g6Graph.getEdgeData() || [];
      const nodeData = this.g6Graph.getNodeData() || [];
      const layoutConfig = getLayoutConfig(layoutType, {
        edges,
        nodeCount: nodeData.length,
        isLayoutChange: true,
      });

      try {
        // Stop current layout simulation if running
        const currentLayoutInstance = this.g6Graph.getLayout();
        if (currentLayoutInstance && currentLayoutInstance.simulation) {
          currentLayoutInstance.simulation.stop();
        }

        // Update drag behavior if switching to/from force layout
        const wasForce = previousLayout === 'd3-force';
        const isForce = layoutType === 'd3-force';
        if (wasForce !== isForce) {
          // Remove old drag behavior and add new one
          if (wasForce) {
            this.g6Graph.removeBehaviors(['drag-element-force']);
            this.g6Graph.addBehaviors([{ type: 'drag-element' }]);
          } else {
            this.g6Graph.removeBehaviors(['drag-element']);
            this.g6Graph.addBehaviors([{ type: 'drag-element-force', fixed: true }]);
          }
        }

        // Update layout
        this.g6Graph.setLayout(layoutConfig);

        // Execute layout with animation
        await this.g6Graph.layout();

        // Update current layout state
        this.currentLayout = layoutType;

        // Save preference to settings store
        this.settingsStore.setGraphLayout(layoutType);

        // After layout animation, center on graph and only zoom out if needed
        setTimeout(() => {
          if (!this.g6Graph) return;

          const canvas = this.g6Graph.getCanvas();
          const [canvasWidth, canvasHeight] = canvas.getSize();

          // Calculate graph bounds from node positions
          const nodes = this.g6Graph.getNodeData();
          if (nodes.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            nodes.forEach(node => {
              const x = node.style?.x ?? node.x ?? 0;
              const y = node.style?.y ?? node.y ?? 0;
              const size = node.style?.size ?? node.size ?? 50;
              minX = Math.min(minX, x - size / 2);
              minY = Math.min(minY, y - size / 2);
              maxX = Math.max(maxX, x + size / 2);
              maxY = Math.max(maxY, y + size / 2);
            });

            const padding = 50;
            const graphWidth = maxX - minX;
            const graphHeight = maxY - minY;

            // Only zoom out if graph exceeds canvas bounds, otherwise just center
            if (graphWidth > canvasWidth - padding * 2 || graphHeight > canvasHeight - padding * 2) {
              this.g6Graph.fitView({ padding });
            } else {
              // Center on graph without changing zoom - use fitCenter
              this.g6Graph.fitCenter();
            }
          }
        }, 500);
      } catch (e) {
        console.error('Layout change failed:', e);
        // Show error toast for dagre failures (cyclic graphs)
        if (layoutType === 'dagre') {
          this.showToast('Hierarchical layout failed - graph may contain cycles. Try another layout.');
        } else {
          this.showToast('Layout change failed. Please try again.');
        }
      }
    },

    /**
     * Get current layout type
     * @returns {string} Current layout type key
     */
    getCurrentLayout() {
      return this.currentLayout;
    },

    async redrawGraph() {
      if (!this.g6Graph) {
        return;
      }

      // Stop all running animations before redrawing
      try {
        this.g6Graph.stopTransformTransition();
      } catch (e) {
        // Method might not exist in this G6 version
      }

      // Wait a bit for any pending animations to clean up
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Save current graph state (all nodes and edges including expansions)
      const currentData = this.g6Graph.getData();
      const savedExpansions = [...this.expansions];

      // Destroy and recreate the graph to pick up new configuration
      if (this.graphCreated && this.g6Graph) {
        this.g6Graph.destroy();
      }

      // Create new graph with updated configuration
      const container = this.$refs.graph;
      const width = container.offsetWidth;
      const height = this.containerHeight === "auto" ? container.offsetHeight : parseInt(this.containerHeight);

      // Create graph with factory config, preserving current layout
      const graphConfig = createGraphConfig({
        container,
        width,
        height,
        edges: currentData.edges,
        labelColor: this.labelColor,
        edgeColor: this.edgeColor,
        layoutType: this.currentLayout,
      });

      this.g6Graph = new Graph(graphConfig);

      // Register graph event handlers using the extracted helper
      this.setupGraphEventHandlers();

      this.graphCreated = true;

      // Restore the saved data (preserves expanded nodes)
      this.g6Graph.setData(currentData);
      await this.render();

      // Restore expansion state
      this.expansions = savedExpansions;

      // Trigger neighbor count update for all leaf nodes
      this.$nextTick(() => {
        this.updateNeighborCounts();
      });
    },

    startResize(e) {
      this.isResizing = true;
      e.preventDefault();
    },

    handleResizeMove(e) {
      if (!this.isResizing) return;

      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= this.minSidebarWidth && newWidth <= this.maxSidebarWidth) {
        this.sidebarWidth = newWidth;
        this.$nextTick(() => {
          this.handleResize();
        });
      }
    },

    stopResize() {
      this.isResizing = false;
    },

    showToast(message, duration = 5000) {
      // Clear existing timeout
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
      }

      this.toastMessage = message;

      // Auto-dismiss after duration
      this.toastTimeout = setTimeout(() => {
        this.dismissToast();
      }, duration);
    },

    dismissToast() {
      this.toastMessage = null;
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }
    },

    updateNodeBadge(nodeId, isProfligate) {
      if (!this.g6Graph) return;

      try {
        const nodeData = this.g6Graph.getNodeData(nodeId);

        if (isProfligate) {
          // Add thick semi-transparent red border to profligate nodes
          this.g6Graph.updateNodeData([{
            id: nodeId,
            style: {
              stroke: 'rgba(220, 53, 69, 0.6)',
              lineWidth: 6,
            }
          }]);
        } else {
          // Restore normal styling - get original node color
          const properties = nodeData.data.properties;
          const nodeSettings = this.settingsStore.settingsForLabel(properties._label);
          const nodeFill = nodeSettings.g6Settings.style.fill;

          this.g6Graph.updateNodeData([{
            id: nodeId,
            style: {
              stroke: G6Utils.shadeColor(nodeFill),
              lineWidth: nodeSettings.g6Settings.style.lineWidth || 0,
            }
          }]);
        }
      } catch (e) {
        console.error("Failed to update node badge:", e);
      }
    },

    // Investigation State Management Methods

    /**
     * Capture the complete current investigation state for URL sharing.
     *
     * Extracts all graph data (nodes and edges with full properties), executed queries,
     * hidden elements, and viewport settings. The returned state object can be serialized
     * and compressed for URL parameters, allowing users to share their exact investigation
     * view with colleagues.
     *
     * Note: This saves the complete graph data rather than just expansion IDs, trading
     * URL size for guaranteed accuracy and avoiding additional database queries during
     * restoration. For very large graphs (>1000 nodes), consider implementing server-side
     * storage with short URL codes.
     *
     * @returns {Object} Investigation state object with structure:
     *   - queries: Array of {query, params, timestamp} objects
     *   - graphData: {nodes: Array, edges: Array} with complete G6 graph data
     *   - hiddenElements: {nodes: Object, edges: Object} map of hidden element IDs
     *   - viewport: {zoom: number} current zoom level (null if default)
     */
    getInvestigationState() {
      // Build queries array from current queryInfo prop
      const queries = [];
      if (this.queryInfo && this.queryInfo.query) {
        queries.push({
          query: this.queryInfo.query,
          params: this.queryInfo.params || {},
          timestamp: this.queryInfo.timestamp || Date.now(),
        });
      }

      // Get complete graph data
      // Note: Saving full data makes URLs larger, but ensures accurate restoration
      // without additional DB queries. For large graphs, consider implementing
      // a server-side storage solution with short URL codes.
      let graphData = { nodes: [], edges: [] };
      if (this.g6Graph) {
        graphData = {
          nodes: this.g6Graph.getNodeData() || [],
          edges: this.g6Graph.getEdgeData() || [],
        };
      }

      return {
        queries,
        graphData, // Save entire graph instead of just expansion IDs
        hiddenElements: this.hiddenElements,
        viewport: this.getViewportState(),
      };
    },

    /**
     * Get list of expanded node IDs (in order they were expanded)
     */
    getExpandedNodeIds() {
      return this.expansions.map(exp => exp.id);
    },

    /**
     * Get current viewport state (zoom, pan position)
     */
    getViewportState() {
      if (!this.g6Graph) return null;

      try {
        const zoom = this.g6Graph.getZoom();
        // G6 doesn't expose viewport position directly in v5
        // We can add this later if needed
        return { zoom };
      } catch (e) {
        return null;
      }
    },


    /**
     * Restore a previously saved investigation state into the graph visualization.
     *
     * This method reconstructs the exact graph view from a shared investigation link by:
     * 1. Refetching full node/edge properties from the database using minimal IDs
     * 2. Initializing an empty G6 graph with appropriate force layout
     * 3. Building full G6 node/edge objects from refetched data + saved positions
     * 4. Re-applying hidden element states
     * 5. Restoring the viewport zoom level
     *
     * The parent component (ShellCell) is responsible for loading the query text into
     * the editor. This method focuses solely on reconstructing the graph visualization.
     *
     * @param {Object} state - Investigation state object from deserializeState()
     * @param {Array} state.queries - Array of executed queries (unused here, handled by parent)
     * @param {Array} state.minimalNodes - Minimal node data [{id, x, y, pk}]
     * @param {Array} state.minimalEdges - Minimal edge data [{id, src, tgt}]
     * @param {Object} state.hiddenElements - Map of hidden elements {nodes: Object, edges: Object}
     * @param {Object} [state.viewport] - Optional viewport state {zoom: number}
     * @returns {Promise<void>}
     */
    async restoreInvestigationState(state) {
      if (!state) return;

      // Wait for graph to be initialized
      await this.$nextTick();

      // Check for minimal format (new) vs full format (legacy - shouldn't exist in v1)
      const hasMinimalData = state.minimalNodes && state.minimalNodes.length > 0;

      if (!hasMinimalData) {
        this.showToast('Import failed: no node data found in export code', 5000);
        return;
      }

      // Check for legacy export codes without label field
      if (state.hasLegacyNodes) {
        this.showToast(
          `This export code is outdated. ${state.legacyNodeCount} nodes cannot be restored. Please create a new export from the original investigation.`,
          8000
        );
      }

      // Step 1: Refetch full node properties from database
      const nodePropsMap = await this.refetchNodeProperties(state.minimalNodes);

      // Step 2: Refetch full edge properties from database
      const edgePropsMap = await this.refetchEdgeProperties(state.minimalEdges, nodePropsMap);

      // Step 3: Build full G6 nodes from refetched data + saved positions
      const nodes = [];
      const positionMap = {}; // Map node ID to saved position

      state.minimalNodes.forEach(minNode => {
        positionMap[minNode.id] = { x: minNode.x, y: minNode.y };

        const rawNode = nodePropsMap[minNode.id];
        if (!rawNode) {
          console.warn('[ResultGraph] Could not refetch node:', minNode.id);
          return;
        }

        // Build G6 node using existing extraction logic
        const nodeSettings = this.settingsStore.settingsForLabel(rawNode._label);
        const nodeFill = nodeSettings.g6Settings.style.fill;
        const maxNodeSize = 100;
        const displaySize = Math.min(nodeSettings.g6Settings.size, maxNodeSize);

        let nodeLabel = "";
        const nodeLabelProp = nodeSettings.label;
        if (nodeLabelProp && rawNode[nodeLabelProp]) {
          nodeLabel = String(rawNode[nodeLabelProp]);
        }

        const g6Node = {
          id: minNode.id,
          data: {
            properties: rawNode,
            ...nodeSettings.g6Settings,
            fx: minNode.x,  // Pin at saved position
            fy: minNode.y,
          },
          style: {
            x: minNode.x,
            y: minNode.y,
            size: displaySize,
            fill: nodeFill,
            stroke: G6Utils.shadeColor(nodeFill),
            lineWidth: nodeSettings.g6Settings.style.lineWidth || 0,
            labelText: nodeLabel,
            iconText: this.getNodeIcon(rawNode._label),
            iconFontFamily: "Font Awesome 6 Free",
            iconFontWeight: 900,
            iconFontSize: displaySize * 0.35,
            iconFill: "#ffffff",
          },
        };

        nodes.push(g6Node);
      });

      // Step 4: Build full G6 edges from refetched data
      const edges = [];

      state.minimalEdges.forEach(minEdge => {
        const rawRel = edgePropsMap[minEdge.id];
        if (!rawRel) {
          console.warn('[ResultGraph] Could not refetch edge:', minEdge.id);
          return;
        }

        const relSettings = this.settingsStore.settingsForLabel(rawRel._label);

        let relLabel = "";
        const relLabelProp = relSettings.label;
        if (relLabelProp && rawRel[relLabelProp]) {
          relLabel = String(rawRel[relLabelProp]);
          const fontSize = relSettings.g6Settings.labelCfg.style.fontSize;
          relLabel = G6Utils.fittingString(relLabel, 80, fontSize);
        }

        const g6Rel = {
          id: minEdge.id,
          source: minEdge.src,
          target: minEdge.tgt,
          data: {
            properties: rawRel,
            ...relSettings.g6Settings,
          },
          style: {
            stroke: relSettings.g6Settings.style.stroke,
            lineWidth: relSettings.g6Settings.size || 3,
            labelText: relLabel,
          },
        };

        // Handle self-loops
        if (g6Rel.source === g6Rel.target) {
          g6Rel.style.loopDist = 50;
          g6Rel.style.loopPlacement = 'top';
        }

        edges.push(g6Rel);
      });

      // Step 5: Initialize graph and load data
      if (!this.g6Graph) {
        await this.initializeEmptyGraph(edges);
        await this.$nextTick();
      }

      if (this.g6Graph) {
        this.g6Graph.clear();

        this.g6Graph.addData({ nodes, edges });
        await this.render();

        // Calculate counters
        this.calculateCountersFromGraphData({ nodes, edges });
      } else {
        this.showToast('Import failed: could not initialize graph', 5000);
        return;
      }

      // Show success feedback if nodes were restored
      if (nodes.length > 0) {
        const skippedNodes = state.minimalNodes.length - nodes.length;
        if (skippedNodes > 0) {
          this.showToast(`Restored ${nodes.length} nodes (${skippedNodes} could not be found in database)`, 5000);
        } else {
          this.showToast(`Successfully restored ${nodes.length} nodes`, 3000);
        }
      } else if (state.minimalNodes.length > 0) {
        this.showToast('Import failed: none of the nodes could be found in the database', 5000);
      }

      // Step 6: Restore hidden elements
      if (state.hiddenElements) {
        this.hiddenElements = {
          nodes: { ...(state.hiddenElements.nodes || {}) },
          edges: { ...(state.hiddenElements.edges || {}) }
        };

        // Apply hidden state to graph
        Object.keys(this.hiddenElements.nodes).forEach(nodeId => {
          if (this.hiddenElements.nodes[nodeId]) {
            this.hideGraphElement(nodeId, 'node');
          }
        });
        Object.keys(this.hiddenElements.edges).forEach(edgeId => {
          if (this.hiddenElements.edges[edgeId]) {
            this.hideGraphElement(edgeId, 'edge');
          }
        });
      }

      // Step 7: Restore viewport (zoom level)
      if (state.viewport && state.viewport.zoom && this.g6Graph) {
        try {
          await this.$nextTick();
          this.g6Graph.zoomTo(state.viewport.zoom, { duration: 300 });
        } catch (e) {
          console.warn('[ResultGraph] Failed to restore viewport zoom:', e);
        }
      }

      // Trigger neighbor count update
      this.$nextTick(() => {
        this.updateNeighborCounts();
      });

      // Step 8: Resize graph to fit container and auto-fit content
      await this.$nextTick();
      this.handleResize();
      await this.$nextTick();
      // Fit to view if no viewport zoom was specified
      if (!state.viewport?.zoom && this.g6Graph) {
        this.fitToView();
      }
    },

    /**
     * Helper to hide a graph element by ID
     */
    hideGraphElement(id, type) {
      if (!this.g6Graph) return;

      try {
        if (type === 'node') {
          this.g6Graph.hideNode(id);
        } else if (type === 'edge') {
          this.g6Graph.hideEdge(id);
        }
      } catch (e) {
        // Element may not exist yet, that's okay
        console.debug(`Failed to hide ${type} ${id}:`, e);
      }
    },

    /**
     * Calculate counters from graph data for overview panel.
     * Used when restoring investigation state to populate the overview statistics.
     */
    calculateCountersFromGraphData(graphData) {
      const nodeCounters = {};
      const relCounters = {};

      // Count nodes by label
      graphData.nodes.forEach(node => {
        const label = node.data?.properties?._label;
        if (label) {
          nodeCounters[label] = (nodeCounters[label] || 0) + 1;
        }
      });

      // Count edges by label
      graphData.edges.forEach(edge => {
        const label = edge.data?.properties?._label;
        if (label) {
          relCounters[label] = (relCounters[label] || 0) + 1;
        }
      });

      // Calculate totals
      const totalNodeCount = Object.values(nodeCounters).reduce((a, b) => a + b, 0);
      const totalRelCount = Object.values(relCounters).reduce((a, b) => a + b, 0);

      // Update counters
      this.counters = {
        node: nodeCounters,
        rel: relCounters,
        total: {
          node: totalNodeCount,
          rel: totalRelCount,
        },
      };
    },

    /**
     * Get valid node labels from schema.
     * Used to validate labels before query construction to prevent injection.
     *
     * @returns {Set<string>} Set of valid node label names
     */
    getValidNodeLabels() {
      if (!this.schema || !this.schema.nodeTables) {
        return new Set();
      }
      return new Set(this.schema.nodeTables.map(t => t.name));
    },

    /**
     * Refetch full node properties from the database given minimal node data.
     *
     * Groups nodes by label and executes batch queries to retrieve full properties.
     * This is used when restoring from a shared investigation link.
     *
     * @param {Array} minimalNodes - Array of {id, x, y, pk, label} minimal node objects
     * @returns {Promise<Object>} Map of node ID to full node data
     */
    async refetchNodeProperties(minimalNodes) {
      if (!minimalNodes || minimalNodes.length === 0) {
        return {};
      }

      // Get valid labels from schema to prevent query injection
      const validLabels = this.getValidNodeLabels();

      // Group nodes by label (stored in minimal node format)
      const nodesByLabel = {};
      let skippedInvalidLabels = 0;
      minimalNodes.forEach(node => {
        const label = node.label;
        if (!label) {
          return;
        }
        // Validate label against schema to prevent injection attacks
        if (!validLabels.has(label)) {
          skippedInvalidLabels++;
          return;
        }
        if (!nodesByLabel[label]) {
          nodesByLabel[label] = [];
        }
        nodesByLabel[label].push(node);
      });

      if (skippedInvalidLabels > 0) {
        this.showToast(`Skipped ${skippedInvalidLabels} nodes with invalid labels`, 4000);
      }

      // Build and execute queries for each label
      const results = {};

      for (const [label, nodes] of Object.entries(nodesByLabel)) {
        const pks = nodes.map(n => n.pk).filter(pk => pk !== null);
        if (pks.length === 0) continue;

        // Build query - labels are validated against schema, PKs are quoted strings
        const pkList = pks.map(pk => `"${pk.replace(/"/g, '\\"')}"`).join(', ');
        const query = `MATCH (n:${label}) WHERE n.id IN [${pkList}] RETURN n`;

        try {
          let response;
          if (this.modeStore.isWasm) {
            const Kuzu = (await import('@/utils/KuzuWasm')).default;
            response = await Kuzu.query(query);
          } else {
            const res = await Axios.post('/api/cypher', {
              query,
              params: {},
              updateHistory: false,
            });
            response = res.data;
          }

          // Process results
          if (response && response.rows) {
            response.rows.forEach(row => {
              if (row.n && row.n._id) {
                const nodeId = this.encodeId(row.n._id);
                results[nodeId] = row.n;
              }
            });
          }
        } catch (error) {
          // Silently ignore errors - nodes that can't be refetched will be skipped
        }
      }

      return results;
    },

    /**
     * Refetch full edge properties from the database given minimal edge data.
     *
     * Queries edges by their source and target node pairs.
     *
     * @param {Array} minimalEdges - Array of {id, src, tgt} minimal edge objects
     * @param {Object} nodePropsMap - Map of node ID to refetched node properties (for _id lookup)
     * @returns {Promise<Object>} Map of edge ID to full edge data
     */
    async refetchEdgeProperties(minimalEdges, nodePropsMap) {
      if (!minimalEdges || minimalEdges.length === 0) {
        return {};
      }

      // We need to query edges by source/target pairs
      // Build a single query to fetch all edges at once
      const results = {};

      // Get all unique source and target node IDs
      const allNodeIds = new Set();
      minimalEdges.forEach(edge => {
        allNodeIds.add(edge.src);
        allNodeIds.add(edge.tgt);
      });

      // Build WHERE clauses for source/target pairs grouped by label combination
      // This is complex, so we'll use a simpler approach: query all edges between known nodes
      const nodeIdList = Array.from(allNodeIds);

      // Group nodes by label for the query
      const nodesByLabel = {};
      nodeIdList.forEach(nodeId => {
        const parts = nodeId.split('_');
        const label = parts[0];
        if (!nodesByLabel[label]) {
          nodesByLabel[label] = [];
        }
        // Get the primary key from the refetched node data
        const nodeData = nodePropsMap[nodeId];
        if (nodeData && nodeData.id) {
          nodesByLabel[label].push(nodeData.id);
        }
      });

      // Query all relationships between the nodes
      // We query for each node label pair combination
      const labels = Object.keys(nodesByLabel);

      for (let i = 0; i < labels.length; i++) {
        for (let j = 0; j < labels.length; j++) {
          const srcLabel = labels[i];
          const tgtLabel = labels[j];
          const srcPks = nodesByLabel[srcLabel];
          const tgtPks = nodesByLabel[tgtLabel];

          if (srcPks.length === 0 || tgtPks.length === 0) continue;

          const srcPkList = srcPks.map(pk => `"${pk}"`).join(', ');
          const tgtPkList = tgtPks.map(pk => `"${pk}"`).join(', ');

          const query = `MATCH (a:${srcLabel})-[r]->(b:${tgtLabel})
                         WHERE a.id IN [${srcPkList}] AND b.id IN [${tgtPkList}]
                         RETURN r`;

          try {
            let response;
            if (this.modeStore.isWasm) {
              const Kuzu = (await import('@/utils/KuzuWasm')).default;
              response = await Kuzu.query(query);
            } else {
              const res = await Axios.post('/api/cypher', {
                query,
                params: {},
                updateHistory: false,
              });
              response = res.data;
            }

            // Process results
            if (response && response.rows) {
              response.rows.forEach(row => {
                if (row.r && row.r._id) {
                  const edgeId = this.encodeId(row.r._id);
                  results[edgeId] = row.r;
                }
              });
            }
          } catch (error) {
            // Silently ignore errors - edges that can't be refetched will be skipped
          }
        }
      }

      return results;
    },
  },
};
</script>

<style lang="scss" scoped>
.result-graph__wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  position: relative;

  .result-graph__container {
    height: 100%;
    flex: 1 1 0%;
    min-width: 0;
    padding: 1rem;
  }

  .result-graph__loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bs-body-bg);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 10;
    /* Ensure it's above the graph */
    color: var(--bs-body-text);

    .spinner-border {
      margin-bottom: 10px;
      color: var(--bs-body-bg-accent);
    }
  }

  .result-graph__summary-section {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 0.5rem;

    p {
      display: inline-block;
      margin: 0;
    }

    button {
      padding: 5px;
      margin-right: 0;
      margin-top: 0.25rem;
    }
  }

  .result-graph__count-summary {
    font-size: 0.85rem;
    color: var(--bs-body-text-secondary);
    margin-bottom: 0.5rem;
  }

  .result-graph__side-panel {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    border-top-left-radius: 1rem;
    border-bottom-left-radius: 1rem;
    width: 350px;
    background-color: var(--bs-body-bg-secondary);
    z-index: 2;

    .resize-handle {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 5px;
      cursor: col-resize;
      background-color: transparent;
      transition: background-color 0.2s;
      z-index: 3;
      pointer-events: auto;

      &:hover,
      &:active {
        background-color: var(--bs-body-bg-accent);
      }

      &::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 2px;
        height: 30px;
        background-color: var(--bs-body-bg-accent);
        opacity: 0;
        transition: opacity 0.2s;
      }

      &:hover::after,
      &:active::after {
        opacity: 1;
      }
    }

    .result-graph__side-panel-content {
      height: 100%;
      overflow-x: hidden;
      overflow-y: auto;
      padding: 0.75rem 1rem 1rem 1.5rem;

      /* Thin scrollbar always visible */
      scrollbar-width: thin;
      scrollbar-color: var(--bs-body-text-secondary) transparent;

      &::-webkit-scrollbar {
        width: 6px;
      }

      &::-webkit-scrollbar-track {
        background: transparent;
      }

      &::-webkit-scrollbar-thumb {
        background: var(--bs-body-text-secondary);
        border-radius: 3px;
      }

      &::-webkit-scrollbar-thumb:hover {
        background: var(--bs-body-text-secondary);
      }
    }

    .result-graph__side-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;

      h5 {
        margin: 0;
      }
    }

    .result-graph__sidebar-button--close {
      background: none;
      border: none;
      font-size: 1.25rem;
      cursor: pointer;
      color: var(--bs-body-text);
      padding: 0;
      line-height: 1;

      &:hover {
        color: var(--bs-body-bg-accent);
      }
    }

    .result-graph__actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .result-graph__summary-section {
      margin-top: 0.5rem;
    }

    .neighbor-warning {
      color: #ffc107;
      margin-left: 0.25rem;
    }

    table {

      table-layout: auto;
      border-collapse: collapse;
      border-radius: 1rem;
      overflow: hidden;
      background-color: var(--bs-body-bg);
      margin-bottom: 1rem;

      th,
      td {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: none;
        position: relative;
        padding-right: 30px;
      }

      th {
        padding-left: 6px;
        padding-top: 8px;
        max-width: 120px;
        word-break: break-word;
      }

      td {
        padding: 0.5rem 1rem;
        max-width: 200px;
        word-break: break-word;
      }

      &.result-graph__overview-table {
        table-layout: fixed;

        td {
          width: 120px;
        }
      }

      scrollbar-width: none;
      scrollbar-color: transparent transparent;
    }

    .result-graph__properties-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-bottom: 1rem;

      .property-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        background-color: var(--bs-body-bg);
        border-radius: 0.375rem;
        padding: 0.375rem 0.5rem;
        transition: background-color 0.15s ease;
        min-height: 28px;

        &:hover {
          background-color: var(--bs-body-bg-hover);
        }

        &.property-item--expanded {
          align-items: flex-start;

          .property-value .value-text {
            white-space: normal;
            word-break: break-word;
          }
        }

        &.property-item--label {
          .property-name {
            font-weight: 600;
          }

          .property-value {
            font-weight: 500;
          }
        }
      }

      .property-name {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        color: var(--bs-body-text-secondary);
        flex-shrink: 0;

        .property-label {
          white-space: nowrap;
        }

        .pk-badge {
          font-size: 0.6rem;
          padding: 0.1rem 0.3rem;
          text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
          color: white !important;
          flex-shrink: 0;
        }
      }

      .property-value {
        font-size: 0.8rem;
        font-family: "Lexend", sans-serif;
        color: var(--bs-body-text);
        line-height: 1.3;
        position: relative;
        padding-right: 0;
        text-align: right;
        flex: 1;
        min-width: 0;
        cursor: pointer;

        .value-text {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding-right: 0;
        }
      }

      .copyable-cell {
        position: relative;

        .copy-button {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          background: var(--bs-body-bg-accent);
          color: white;
          border: none;
          border-radius: 3px;
          width: 22px;
          height: 22px;
          font-size: 10px;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.15s, background 0.2s;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);

          &:hover {
            opacity: 1 !important;
            background: var(--bs-primary);
          }
        }

        &:hover .copy-button {
          opacity: 0.9;
        }
      }
    }

    h5,
    .section-title {
      font-size: 0.9rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      color: var(--bs-body-text);
    }

    hr {
      margin: 1rem 0;
      border-top: 1px solid var(--bs-body-inactive);
    }

    .badge {
      display: inline-block;
      background-color: var(--bs-body-bg-accent) !important;
      color: #fff !important;
      overflow: hidden;
      text-overflow: hidden;
      white-space: nowrap;
      vertical-align: middle;
    }

    button.btn-outline-secondary,
    button.btn-outline-primary {
      width: 100%;
      text-align: left;
      background-color: var(--bs-body-bg);
      color: var(--bs-body-text);
      border-color: transparent;
      border-radius: 0.5rem;

      &:hover {
        background-color: var(--bs-body-bg-hover);
      }

      i {
        margin-right: 0.5rem;
      }

      &.btn-active {
        background-color: var(--bs-body-bg-accent);
        color: white;

        &:hover {
          opacity: 0.9;
        }
      }
    }

    button.btn-outline-primary {
      background-color: var(--bs-body-bg-accent);
      color: white;

      &:hover {
        opacity: 0.9;
      }
    }

    .badge.bg-primary {
      color: white !important;
    }
  }

  .result-graph__sidebar-button--open {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    background-color: var(--bs-body-bg-secondary);
    border: 2px solid var(--bs-body-shell);
    border-radius: 0.5rem 0 0 0.5rem;
    padding: 0.5rem 0.25rem;
    cursor: pointer;
    color: var(--bs-body-text);
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 3rem;

    &:hover {
      background-color: var(--bs-body-bg-hover);
      border-color: var(--bs-body-text);
    }

    i {
      font-size: 1.2rem;
    }
  }

  // Share Investigation Section
  .result-graph__share-section {
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--bs-body-inactive);

    button i {
      margin-right: 0.5rem;
    }
  }
}
</style>
