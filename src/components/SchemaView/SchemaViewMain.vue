<template>
  <div
    ref="wrapper"
    class="schema-view__wrapper"
  >
    <div
      ref="toolsContainer"
      class="schema-view__tools_container"
      :style="{ minWidth: toolbarWidth + 'px' }"
    >
      <div class="schema-view__tools_container--bottom">
        <div class="schema-view__button">
          <i
            class="fa-lg fa-solid fa-magnifying-glass-plus"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            title="Zoom In"
            @click="zoomIn()"
          />
        </div>
        <div class="schema-view__button">
          <i
            class="fa-lg fa-solid fa-magnifying-glass-minus"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            title="Zoom Out"
            @click="zoomOut()"
          />
        </div>
        <div class="schema-view__button">
          <i
            class="fa-lg fa-solid fa-compress"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            title="Fit to View"
            @click="fitToView()"
          />
        </div>
        <div class="schema-view__button">
          <i
            class="fa-lg fa-solid fa-expand"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            title="Actual Size"
            @click="actualSize()"
          />
        </div>
      </div>
    </div>
    <div
      ref="graph"
      class="schema_graph__wrapper"
    />
    <div
      ref="sidePanel"
      class="schema_side-panel__wrapper"
    >
      <div class="sidebar-content">
        <br>
        <SchemaSidebarOverview
          v-if="schema"
          v-show="!hoveredLabel && clickedLabel === null"
          ref="overview"
          :schema="schema"
        />
        <!-- Read only view for hovered label -->
        <SchemaSidebarReadOnlyView
          v-if="hoveredLabel !== null"
          :schema="schema"
          :label="hoveredLabel"
          :is-node="hoveredIsNode"
        />
        <!-- Read only view for clicked label -->
        <SchemaSidebarReadOnlyView
          v-if="clickedLabel !== null && hoveredLabel === null"
          :schema="schema"
          :label="clickedLabel"
          :is-node="clickedIsNode"
        />
      </div>
    </div>
  </div>
</template>

<script lang="js">
import { Graph, GraphEvent } from '@antv/g6';
import {
  UI_SIZE, SHOW_REL_LABELS_OPTIONS, LOOP_POSITIONS, ARC_CURVE_OFFSETS
} from "../../utils/Constants";
import G6Utils from "../../utils/G6Utils";
import { useSettingsStore } from "../../store/SettingsStore";
import { mapStores } from 'pinia'
import SchemaSidebarReadOnlyView from './SchemaSidebarReadOnlyView.vue';
import SchemaSidebarOverview from './SchemaSidebarOverview.vue';


export default {
  name: "SchemaViewMain",
  components: {
    SchemaSidebarOverview, SchemaSidebarReadOnlyView
  },
  props: {
    schema: {
      type: Object,
      required: false,
      default: null,
    },
    navbarHeight: {
      type: Number,
      required: true,
    },
    isVisible: {
      type: Boolean,
      required: false,
      default: true,
    },
  },
  data: () => ({
    graphCreated: false,
    toolbarWidth: UI_SIZE.SHELL_TOOL_BAR_WIDTH,
    sidebarWidth: 510,
    graphWidth: 0,
    graphHeight: 0,
    borderWidth: UI_SIZE.DEFAULT_BORDER_WIDTH,
    hoveredLabel: null,
    hoveredIsNode: false,
    clickedLabel: null,
    clickedIsNode: false,
    toolbarDebounceTimeout: 100,
    toolbarDebounceTimer: null,
    drawPromise: null,
    isRendering: false,
  }),
  computed: {
    graphVizSettings() {
      return this.settingsStore.graphVizSettings;
    },
    isNodeSelectedOrHovered() {
      return this.hoveredLabel ? this.hoveredIsNode : this.clickedIsNode;
    },
    displayLabel() {
      return this.hoveredLabel ? this.hoveredLabel : this.clickedLabel;
    },
    ...mapStores(useSettingsStore)
  },
  watch: {
    graphVizSettings() {
      this.updateVisualSettings();
    },

    async schema(value, oldValue) {
      const oldNodes = oldValue ? oldValue.nodeTables.map(n => n.name) : [];
      const newNodes = value ? value.nodeTables.map(n => n.name) : [];
      const oldEdges = oldValue ? oldValue.relTables.map(n => n.name) : [];
      const newEdges = value ? value.relTables.map(n => n.name) : [];

      const areSetsEqual = (a, b) => a.size === b.size && [...a].every(value => b.has(value));
      if (areSetsEqual(new Set(oldNodes), new Set(newNodes)) && areSetsEqual(new Set(oldEdges), new Set(newEdges))) {
        return;
      }
      if (!this.graphCreated || !this.isVisible) {
        return;
      }
      await this.resetClick();
      this.redrawGraph(true);
    },

    isVisible(newValue) {
      if (newValue && !this.g6Graph && this.schema) {
        this.initializeGraph();
      }
    },
  },
  mounted() {
    this.computeGraphWidth();
    this.computeGraphHeight();
    window.addEventListener("resize", this.handleResize);

    // Initialize graph if visible on mount and schema exists
    if (this.isVisible && this.schema && !this.g6Graph) {
      this.$nextTick(() => {
        this.initializeGraph();
      });
    }
  },

  beforeUnmount() {
    if (this.g6Graph) {
      this.g6Graph.destroy();
    }
    window.removeEventListener("resize", this.handleResize);
  },
  methods: {
    initializeGraph() {
      if (this.g6Graph || !this.schema) {
        return;
      }
      this.drawGraph();
    },

    getColor(label) {
      return this.settingsStore.colorForLabel(label);
    },
    getRelTableDisplayLabel(relTableName) {
      const relTable = this.schema.relTables.find(t => t.name === relTableName);
      if (!relTable) {
        return relTableName;
      }
      return relTable.group ? relTable.group : relTableName;
    },
    drawGraph() {
      if (this.graphCreated && this.g6Graph) {
        this.g6Graph.destroy();
      }
      if (!this.schema) {
        return;
      }
      const { nodes, edges } = this.extractGraphFromSchema(this.schema);
      const container = this.$refs.graph;
      const width = container.offsetWidth;
      const height = container.offsetHeight;

      this.g6Graph = new Graph({
        container,
        width,
        height,
        layout: {
          type: 'd3-force',
          alphaMin: 0.2,
          alphaDecay: 0.03,
          link: {
            distance: edges.length * 15,
            strength: 1,
          },
          collide: {
            radius: (d) => {
              const degree = d.data.degree || 0;
              return degree === 0 ? 20 : 200;
            }
          },
          manyBody: {
            distanceMax: (d) => {
              const degree = d.data.degree || 0;
              if (degree === 0) {
                return 10;
              }
              return Infinity;
            },
          }
        },
        plugins: [
          {
            type: 'tooltip',
            key: 'tooltip',
            offsetX: 10,
            offsetY: 10,
            itemTypes: ['node', 'edge'],
            getContent: (e) => {
              const { itemId, itemType } = e;
              const model = itemType === 'node' ? this.g6Graph.getNodeData(itemId) : this.g6Graph.getEdgeData(itemId);
              const label = model?.data?._label || model?.data?.label || model?.label || '';
              return `<div style="max-width:400px;white-space:normal;word-break:break-all;"><b>${label}</b></div>`;
            },
          }
        ],
        node: {
          type: 'circle',
          style: {
            labelPlacement: 'center',
            size: 100,
            labelFontSize: 14,
            labelFontFamily: "Lexend, Helvetica Neue, Helvetica, Arial, sans-serif",
            labelFontWeight: 300,
            lineWidth: 4,
          },
          state: {
            active: {
              lineWidth: 10,
              stroke: '#1890FF',
            },

          },
        },
        edge: {
          style: {
            lineWidth: 5,
            endArrow: true,
            labelFontSize: 12,
            labelFontFamily: "Lexend,Helvetica Neue, Helvetica, Arial, sans-serif",
            labelFontWeight: 350,
            labelBackground: true,
            labelBackgroundFill: "#ffffff",
            labelPadding: [0, 8],
            labelBackgroundRadius: 2,
            labelAutoRotate: true,
            labelTextBaseline: 'bottom',
            labelOffsetY: -8,
          },
          state: {
            active: {
              stroke: '#1890FF',
              lineWidth: 10,
            },

          },
        },
        behaviors: [
          'zoom-canvas',
          'drag-canvas',
          {
            type: 'drag-element-force',
            fixed: true,
          },
        ],
      });

      this.g6Graph.setData({ nodes, edges, });

      // Fit the graph to view after rendering
      this.g6Graph.on(GraphEvent.AFTER_RENDER, () => {
        G6Utils.fitToView(this.g6Graph);
      });

      // Node hover events
      this.g6Graph.on('node:pointerenter', (e) => {
        const id = e.target.id;
        const nodeData = this.g6Graph.getNodeData(id);
        this.handleHover(nodeData.data._label, true);
      });

      this.g6Graph.on('node:pointerleave', () => {
        this.resetHover();
      });

      // Node click events
      this.g6Graph.on('node:click', async (e) => {
        await this.resetClick();
        const clickedId = e.target.config.id;
        const nodeData = this.g6Graph.getNodeData(clickedId);
        this.clickedLabel = nodeData.data._label;
        this.clickedIsNode = true;
        return this.setItemState({
          [clickedId]: ['active'],
        });
      });

      // Edge hover events
      this.g6Graph.on('edge:pointerenter', (e) => {
        const id = e.target.id;
        const edgeData = this.g6Graph.getEdgeData(id);
        if (this.settingsStore.schemaView.showRelLabels === SHOW_REL_LABELS_OPTIONS.HOVER) {
          this.g6Graph.updateEdgeData([{
            id: id,
            style: {
              labelText: this.getRelTableDisplayLabel(edgeData.data._label),
            }
          }]);
          this.g6Graph.frontElement(id);
        }
        this.handleHover(edgeData.data._label, false);
      });

      this.g6Graph.on('edge:pointerleave', (e) => {
        this.resetHover();
        if (this.settingsStore.schemaView.showRelLabels === SHOW_REL_LABELS_OPTIONS.HOVER) {
          const id = e.target.id;
          const currentSelectedEdges = this.g6Graph.getElementDataByState('edge', 'active');
          const isCurrentlySelected = currentSelectedEdges.some(edge => edge.id === id);

          if (!isCurrentlySelected) {
            this.g6Graph.updateEdgeData([{
              id: id,
              style: {
                labelText: "",
              }
            }]);
            this.draw();
          }
        }
      });

      // Edge click events
      this.g6Graph.on('edge:click', async (e) => {
        await this.resetClick();
        // Highlight all edges with the same label
        const clickedId = e.target.config.id;
        const clickedEdgeData = this.g6Graph.getEdgeData(clickedId);
        const clickedLabel = clickedEdgeData.data._label;
        const edgesWithSameLabel = this.g6Graph.getEdgeData().filter(edge => edge.data._label === clickedLabel);
        const activeIds = {};
        for (const edge of edgesWithSameLabel) {
          activeIds[edge.id] = ['active'];
          if (this.settingsStore.schemaView.showRelLabels === SHOW_REL_LABELS_OPTIONS.HOVER) {
            this.g6Graph.updateEdgeData([{
              id: edge.id,
              style: {
                labelText: this.getRelTableDisplayLabel(edge.data._label),
              }
            }]);
          }
        }
        this.clickedIsNode = false;
        this.clickedLabel = clickedLabel;
        await this.setItemState(activeIds);
      });

      // Canvas click events
      this.g6Graph.on('canvas:click', () => {
        return this.resetClick();
      });


      this.render();
      this.graphCreated = true;
    },

    getEdgeId(src, dst, label) {
      return `${src}-${dst}-${label}`;
    },

    extractGraphFromSchema(schema) {
      const overlapEdgeHash = {};
      let nodes = schema.nodeTables.map(n => {
        const fillColor = this.getColor(n.name);
        const labelColor = G6Utils.getReadableTextColor(fillColor);
        let label = n.name;
        label = G6Utils.fittingString(label, 80, this.settingsStore.defaultNode.labelCfg.style.fontSize);
        const returnVal = {
          id: n.name,
          data: {
            _label: n.name,
          },
          style: {
            fill: fillColor,
            stroke: G6Utils.shadeColor(fillColor),
            labelText: label,
            labelFill: labelColor,
            labelFontSize: this.settingsStore.defaultNode.labelCfg.style.fontSize,
            labelFontFamily: this.settingsStore.defaultNode.labelCfg.style.fontFamily,
            labelFontWeight: this.settingsStore.defaultNode.labelCfg.style.fontWeight,
          },
        };
        if (returnVal.data._label === this.clickedLabel) {
          returnVal.states = ['active'];
        }
        return returnVal;
      });

      const getEdgeKey = (src, dst, sorted = false) => {
        return sorted ?
          (src < dst ? `${src}-${dst}` : `${dst}-${src}`) :
          `${src}-${dst}`;
      }
      const numberOfEdgesBetweenNodesHash = {};
      schema.relTables.forEach(r => {
        r.connectivity.forEach(conn => {
          if (!conn.src || !conn.dst) {
            return;
          }
          const key = getEdgeKey(conn.src, conn.dst);
          if (!numberOfEdgesBetweenNodesHash[key]) {
            numberOfEdgesBetweenNodesHash[key] = 0;
          }
          numberOfEdgesBetweenNodesHash[key] += 1;
        });
      });

      let edges = [];
      for (const r of schema.relTables) {
        if (!r.connectivity || r.connectivity.length === 0) {
          continue;
        }
        for (const conn of r.connectivity) {
          const strokeColor = this.getColor(r.name);
          const fittedLabel = G6Utils.fittingString(r.name, 80, 12);
          const labelText = this.settingsStore.schemaView.showRelLabels === SHOW_REL_LABELS_OPTIONS.ALWAYS ?
            fittedLabel :
            "";
          const edge = {
            id: this.getEdgeId(conn.src, conn.dst, r.name),
            source: conn.src,
            target: conn.dst,
            data: {
              _label: r.name,
            },
            style: {
              labelText,
              stroke: strokeColor,
            },
          };
          if (edge.data._label === this.clickedLabel) {
            edge.states = ['active'];
            edge.style.labelText = fittedLabel;
          }
          if (!edge.source || !edge.target) {
            continue;
          }
          const sortedHashKey = getEdgeKey(edge.source, edge.target, true);
          if (!overlapEdgeHash[sortedHashKey]) {
            overlapEdgeHash[sortedHashKey] = 0;
          }
          overlapEdgeHash[sortedHashKey] += 1;

          if (edge.source === edge.target) {
            // Self-loop (do not set type, otherwise it will not work)
            edge.style.loopDist = 100;
            edge.style.loopPlacement = LOOP_POSITIONS[(overlapEdgeHash[sortedHashKey] - 1) % LOOP_POSITIONS.length];
          }
          else if (overlapEdgeHash[sortedHashKey] > 1) {
            edge.type = 'quadratic';
            edge.style.curveOffset = ARC_CURVE_OFFSETS[(overlapEdgeHash[sortedHashKey] - 1) % ARC_CURVE_OFFSETS.length];
            edge.style.curvePosition = 0.5;
          } else {
            edge.type = 'line';
          }
          edges.push(edge);
        }
      }
      // EDGE-INTEGRITY GUARD: nodes come only from schema.nodeTables, but edge
      // endpoints come from relTables[].connectivity (conn.src/conn.dst) with
      // only a truthiness check above. A rel table whose connectivity names a
      // node table absent from nodeTables would produce a dangling edge, and
      // G6 v5's setData throws an uncaught "Node not found for id: <id>" on it.
      // Drop any such edge before both feed points (drawGraph/redrawGraph)
      // inherit the result, and console.warn (never swallow) so it's visible.
      const nodeIds = new Set(nodes.map(n => n.id));
      edges = edges.filter(e => {
        if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
          return true;
        }
        console.warn(
          `extractGraphFromSchema: dropping dangling edge ${e.id} (source=${e.source}, target=${e.target}) — endpoint node table not in schema`
        );
        return false;
      });
      nodes.forEach(n => {
        n.data.degree = edges.filter(e => e.source === n.id || e.target === n.id).length;
      });
      return { nodes, edges };
    },

    handleResize() {
      this.$nextTick(() => {
        const width = this.$refs.graph.offsetWidth;
        const height = this.computeGraphHeight();
        if (this.g6Graph) {
          this.g6Graph.resize(width, height);
        }
      });
    },

    handleHover(label, isNode) {
      this.hoveredLabel = label;
      this.hoveredIsNode = isNode;
    },


    resetClick() {
      if (!this.g6Graph) {
        return;
      }

      // Clear node selections
      const selectedNodes = this.g6Graph.getElementDataByState('node', 'active');
      const nodeStates = {};
      selectedNodes.forEach((node) => {
        nodeStates[node.id] = [];
      });

      // Clear edge selections
      const selectedEdges = this.g6Graph.getElementDataByState('edge', 'active');
      const edgeStates = {};
      selectedEdges.forEach((edge) => {
        edgeStates[edge.id] = [];
        if (this.settingsStore.schemaView.showRelLabels === SHOW_REL_LABELS_OPTIONS.HOVER) {
          this.g6Graph.updateEdgeData([{
            id: edge.id,
            style: {
              labelText: "",
            }
          }]);
        }
      });
      this.clickedLabel = null;
      this.clickedIsNode = false;
      return this.setItemState({ ...nodeStates, ...edgeStates });
    },

    resetHover() {
      this.hoveredLabel = null;
      this.hoveredIsNode = false;
    },

    toggleSidePanel() {
      this.isSidePanelOpen = !this.isSidePanelOpen;
      this.$nextTick(() => {
        this.handleResize();
      });
    },

    computeGraphWidth() {
      let width = document.documentElement.clientWidth || document.body.clientWidth;
      width -= this.sidebarWidth;
      width -= UI_SIZE.DEFAULT_BORDER_WIDTH * 2;
      width -= this.toolbarWidth;

      // Detect sidebar collapse state and adjust width accordingly
      const wrapper = document.querySelector('.wrapper');
      if (wrapper) {
        const isSidebarCollapsed = wrapper.classList.contains('toggled');
        const sidebarWidth = isSidebarCollapsed ? 60 : 180; // CSS variables: --sidebar-collapsed-width: 60px, --sidebar-width: 180px
        width -= sidebarWidth;
      }

      this.graphWidth = width;
      return width;
    },

    computeGraphHeight() {
      let height = document.documentElement.clientHeight || document.body.clientHeight;
      height -= this.navbarHeight;
      this.graphHeight = height;
      return height;
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

    async draw() {
      if (!this.g6Graph) {
        return
      }
      if (this.drawPromise) {
        await this.drawPromise;
      }
      this.drawPromise = this.g6Graph.draw();
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
      this.drawPromise =
        this.isRendering ?
          this.g6Graph.draw() :
          this.g6Graph.render();
      this.isRendering = true;
      await this.drawPromise;
      this.drawPromise = null;
      this.isRendering = false;
    },

    async setItemState(itemStates) {
      if (!this.g6Graph) {
        return;
      }
      if (this.drawPromise) {
        await this.drawPromise;
      }
      this.drawPromise = this.g6Graph.setElementState(itemStates);
      await this.drawPromise;
      this.drawPromise = null;
    },

    redrawGraph(rerender) {
      if (!this.g6Graph) {
        return;
      }
      const { nodes, edges, } = this.extractGraphFromSchema(this.schema);
      this.g6Graph.setData({ nodes, edges, });
      if (rerender) {
        this.render();
      } else {
        this.draw();
      }
    },


    async updateVisualSettings() {
      if (!this.g6Graph) {
        return;
      }
      const itemStates = {};
      const nodes = this.g6Graph.getNodeData();
      nodes.forEach(node => {
        const newFill = this.getColor(node.data._label);
        if (node.style.fill === newFill) {
          return;
        }
        node.style.fill = newFill;
        node.style.stroke = G6Utils.shadeColor(node.style.fill);
        node.style.labelColor = G6Utils.getReadableTextColor(node.style.fill);
        this.g6Graph.updateNodeData({
          id: node.id,
          style: node.style,
        });
        itemStates[node.id] = node.states || [];
      });
      const edges = this.g6Graph.getEdgeData();
      edges.forEach(edge => {
        const newStroke = this.getColor(edge.data._label);
        edge.style.stroke = newStroke;
        edge.style.labelColor = G6Utils.getReadableTextColor(edge.style.stroke);
        edge.style.labelText = (this.settingsStore.schemaView.showRelLabels === SHOW_REL_LABELS_OPTIONS.ALWAYS || edge.states?.includes('active')) ?
          this.getRelTableDisplayLabel(edge.data._label) :
          "";
        this.g6Graph.updateEdgeData({
          id: edge.id,
          style: edge.style,
        });
        itemStates[edge.id] = edge.states || [];
      });
      return this.setItemState(itemStates);

    },
  },
};
</script>

<style lang="scss" scoped>
.schema-view__wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;

  .schema_graph__wrapper {
    height: 100%;
    flex: 1 1 0%;
    min-width: 0;
  }

  .schema_side-panel__wrapper {
    width: 360px;
    height: 100%;
    padding-left: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    flex-direction: column;
    background-color: (var(--bs-body-bg-secondary));
    border-bottom-left-radius: 1rem;
    border-top-left-radius: 1rem;

    .sidebar-content {
      height: 100%;
      width: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 1rem;

      :deep(table) {
        border-radius: 0.5rem;
        overflow: hidden;
        background-color: var(--bs-body-bg);
        width: calc(100% - 1rem);

        th,
        td {
          padding: 10px;
          max-width: 120px;
          word-break: break-word;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        td {
          padding-left: 10px;
          padding-right: 5px;
          max-width: 150px;
          word-break: break-word;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    }
  }
}

.schema-view__tools_container {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding-left: 4px;
  align-items: center;
  padding-bottom: 8px;

  .schema-view__tools_container--bottom {
    margin-top: auto;
    padding-bottom: 8px;

    .schema-view__button {
      >i {
        color: (var(--bs-body-text));
      }
    }
  }
}

.schema-view__button {
  padding-top: 4px;
  padding-bottom: 4px;

  i {
    cursor: pointer;
    color: $secondary;

    &:hover {
      opacity: 0.7;
    }

    &:active {
      opacity: 0.5;
    }
  }

  &--active {
    i {
      color: var(--bs-body-accent);
    }
  }
}
</style>
