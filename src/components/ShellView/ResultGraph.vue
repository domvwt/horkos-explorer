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

    <!-- Undo/Redo Controls - positioned dynamically based on sidebar state -->
    <div
      class="result-graph__controls"
      :style="{ right: isSidePanelOpen ? (sidebarWidth + 16) + 'px' : '16px' }"
    >
      <button
        class="result-graph__control-btn"
        :disabled="historyVersion >= 0 && !historyManager?.canUndo()"
        title="Undo (Ctrl+Z)"
        @click="undo"
      >
        <i class="fa-solid fa-rotate-left" />
      </button>
      <button
        class="result-graph__control-btn"
        :disabled="historyVersion >= 0 && !historyManager?.canRedo()"
        title="Redo (Ctrl+Y)"
        @click="redo"
      >
        <i class="fa-solid fa-rotate-right" />
      </button>
    </div>

    <HoverContainer
      ref="hoverContainer"
      :schema="schema"
    />

    <div
      v-show="isSidePanelOpen"
      ref="sidePanel"
      class="result-graph__side-panel"
      :style="{ width: sidebarWidth + 'px' }"
      @mouseenter="$refs.hoverContainer.resetHover()"
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
            class="btn btn-sm"
            :class="clickedNodePinned ? 'btn-warning' : 'btn-outline-secondary'"
            :title="clickedNodePinned ? 'Unpin this entity' : 'Pin this entity to your notebook'"
            @click="togglePinClickedNode()"
          >
            <i
              class="fa-star"
              :class="clickedNodePinned ? 'fa-solid' : 'fa-regular'"
            />
            {{ clickedNodePinned ? 'Pinned' : 'Pin' }}
          </button>

          <button
            class="btn btn-sm btn-outline-secondary"
            @click="removeNode()"
          >
            <i class="fa-solid fa-trash" /> Remove Node
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

          <button
            class="btn btn-sm btn-outline-secondary"
            :disabled="findConnectionInFlight"
            @click="openConnectionPicker()"
          >
            <i class="fa-solid fa-route" />
            Find connection to…
          </button>
        </div>

        <!-- Find-connection picker: pick a second endpoint (a notebook pin or a
             searched entity) to connect the selected node to. Esc or a click
             outside closes it. -->
        <div
          v-if="clickedIsNode && showConnectionPicker"
          ref="connectionPicker"
          class="result-graph__connection-picker"
        >
          <div class="connection-picker__header">
            <span>Connect to…</span>
            <button
              class="connection-picker__close"
              title="Close"
              @click="closeConnectionPicker()"
            >
              <i class="fa-solid fa-times" />
            </button>
          </div>

          <div
            v-if="connectionPinTargets().length > 0"
            class="connection-picker__section"
          >
            <div class="connection-picker__section-title">From your notebook</div>
            <ul class="connection-picker__list">
              <li
                v-for="pin in connectionPinTargets()"
                :key="`pin-${pin.label}-${pin.pk}`"
              >
                <button
                  class="connection-picker__item"
                  @click="pickConnectionTarget(pin)"
                >
                  <span class="connection-picker__item-type">{{ pin.label }}</span>
                  {{ pin.name }}
                </button>
              </li>
            </ul>
          </div>

          <div
            v-if="!connectionSearchUnavailable"
            class="connection-picker__section"
          >
            <div class="connection-picker__section-title">Search for an entity</div>
            <div class="connection-picker__search-row">
              <select
                v-model="connectionSearchType"
                class="form-select form-select-sm connection-picker__type"
                @change="onConnectionSearchInput()"
              >
                <option value="Person">Person</option>
                <option value="Company">Company</option>
                <option value="Address">Address</option>
              </select>
              <input
                v-model="connectionSearchQuery"
                type="text"
                class="form-control form-control-sm"
                placeholder="Type a name…"
                autocomplete="off"
                @input="onConnectionSearchInput()"
              >
            </div>
            <ul
              v-if="connectionSearchResults.length > 0"
              class="connection-picker__list"
            >
              <li
                v-for="hit in connectionSearchResults"
                :key="`hit-${hit.label}-${hit.pk}`"
              >
                <button
                  class="connection-picker__item"
                  @click="pickConnectionTarget(hit)"
                >
                  <span class="connection-picker__item-type">{{ hit.label }}</span>
                  {{ hit.name }}
                </button>
              </li>
            </ul>
          </div>

          <p
            v-if="connectionPinTargets().length === 0 && connectionSearchUnavailable"
            class="connection-picker__empty"
          >
            Pin some entities in your notebook to connect to them.
          </p>
        </div>

        <div v-if="displayLabel">
          <!-- Entity header: name, type badge, confidence chip -->
          <div class="result-graph__entity-header">
            <div class="entity-header-title-row">
              <h5 class="entity-header-name">
                {{ entityDisplayName }}
              </h5>
              <span
                v-if="clickedTypeDisplayName !== entityDisplayName"
                class="badge entity-header-type-badge"
                :style="{
                  backgroundColor: `${getColor(clickedLabel)} !important`,
                  color: 'white !important',
                  textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                }"
              >{{ clickedTypeDisplayName }}</span>
            </div>
          </div>

          <!-- Properties (collapsible, expanded by default) -->
          <div
            class="result-graph__properties-header"
            @click="propertiesExpanded = !propertiesExpanded"
          >
            <i
              class="fa-solid"
              :class="propertiesExpanded ? 'fa-chevron-down' : 'fa-chevron-right'"
            />
            <h6>Properties</h6>
          </div>
          <div
            v-show="propertiesExpanded"
            class="result-graph__properties-list"
          >
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

          <!-- Connected Entities -->
          <ConnectedEntitiesPanel
            v-if="clickedIsNode && clickedId"
            ref="connectedEntitiesPanel"
            :node-id="clickedId"
            :node-label="clickedLabel"
            :node-properties="clickedProperties"
            :schema="schema"
            :g6-graph="g6Graph"
            :is-wasm="modeStore.isWasm"
            :settings-store="settingsStore"
            @select-node="handleConnectedNodeClick"
            @add-node="handleAddConnectedNode"
          />

          <!-- External Resource Links -->
          <ExternalLinksPanel
            v-if="clickedIsNode"
            :entity-type="clickedLabel"
            :properties="clickedProperties"
          />

          <!-- Pin + note this entity in your notebook -->
          <EntityPinPanel
            v-if="clickedIsNode"
            :entity-type="clickedLabel"
            :properties="clickedProperties"
          />

          <!-- Sources & Matching: provenance and merge confidence, grouped -->
          <div
            v-if="clickedIsNode"
            class="result-graph__provenance-section"
          >
            <h6>Sources &amp; Matching</h6>
            <SourceProvenancePanel
              :properties="clickedProperties"
              embedded
            />
            <ConfidenceIndicator :properties="clickedProperties" />
          </div>

          <!-- Data-quality / provenance disclaimer for this specific entity -->
          <ResultDisclaimer
            v-if="clickedIsNode"
            :entity-type="clickedLabel"
          />
        </div>
        <div v-else>
          <!-- Overview Actions -->
          <div
            v-if="counters.total.node > 0"
            class="result-graph__actions"
          >
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

            <!-- Clear the whole canvas: two-stage inline danger confirm
                 (no native dialog), auto-reverting after a few idle seconds. -->
            <template v-if="confirmingClearCanvas">
              <div class="result-graph__clear-confirm">
                <span class="result-graph__clear-confirm-msg">
                  Clear the whole canvas? This can be undone.
                </span>
                <div class="result-graph__clear-confirm-actions">
                  <button
                    ref="clearCanvasConfirmBtn"
                    class="btn btn-sm btn-danger"
                    @click="clearCanvas()"
                  >
                    Clear canvas
                  </button>
                  <button
                    class="btn btn-sm btn-outline-secondary"
                    @click="cancelClearCanvas()"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </template>
            <button
              v-else
              ref="clearCanvasBtn"
              class="btn btn-sm btn-outline-secondary result-graph__clear-btn"
              title="Remove all nodes and edges from the canvas"
              @click="startClearCanvas()"
            >
              <i class="fa-solid fa-trash-can" />
              Clear Canvas
            </button>
          </div>

          <!-- Node Counts -->
          <div v-if="counters.total.node > 0">
            <p class="result-graph__count-summary">
              Showing {{ counters.total.node }} nodes
            </p>
            <table class="table table-sm table-borderless result-graph__overview-table">
              <tbody>
                <tr
                  v-for="label in orderedNodeCountLabels"
                  :key="label"
                >
                  <th scope="row">
                    <span
                      class="badge bg-primary"
                      :style="{ backgroundColor: `${getColor(label)} !important`, textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000', color: 'white !important' }"
                    >{{ displayNodeType(label) }}</span>
                  </th>
                  <td>{{ counters.node[label] }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Rel Counts -->
          <div v-if="counters.total.rel > 0">
            <p class="result-graph__count-summary">
              Showing {{ counters.total.rel }} rels
            </p>
            <table class="table table-sm table-borderless result-graph__overview-table">
              <tbody>
                <tr
                  v-for="rel in mergedRelCounts"
                  :key="rel.display"
                >
                  <th scope="row">
                    <span
                      class="badge bg-primary"
                      :style="{
                        backgroundColor: `${getColor(rel.colorLabel)} !important`,
                        color: 'white !important',
                        textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                      }"
                    >{{ rel.display }}</span>
                  </th>
                  <td>{{ rel.count }}</td>
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

    <!-- Connection-result banner: the SOLE surface for a find's outcome (no
         accompanying toast). Four statuses — found / no-path / timeout / error.
         Kept separate from GraphToast so the plain info toast stays action-free. -->
    <div
      v-if="connectionResult"
      class="result-graph__connection-result"
      :style="{ right: (isSidePanelOpen ? sidebarWidth + 16 : 16) + 'px' }"
    >
      <div class="connection-result__body">
        <template v-if="connectionResult.status === 'found'">
          <i class="fa-solid fa-route" />
          <span>
            Connected in {{ connectionResult.hops }}
            {{ connectionResult.hops === 1 ? 'step' : 'steps' }}.
          </span>
        </template>
        <template v-else-if="connectionResult.status === 'no-path'">
          <i class="fa-solid fa-circle-info" />
          <span>No connection within {{ MAX_HOPS }} steps.</span>
        </template>
        <template v-else-if="connectionResult.status === 'timeout'">
          <i class="fa-solid fa-clock" />
          <span>The search hit the time limit — no connection found.</span>
        </template>
        <template v-else>
          <i class="fa-solid fa-triangle-exclamation" />
          <span>The connection search failed — try again.</span>
        </template>
      </div>
      <div class="connection-result__actions">
        <button
          class="connection-result__close"
          title="Dismiss"
          @click="dismissConnectionResult()"
        >
          <i class="fa-solid fa-times" />
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="js">
import { Graph, GraphEvent } from '@antv/g6';
import G6Utils from "../../utils/G6Utils";
import { GraphHistoryManager } from "../../utils/GraphHistoryManager";
import { UI_SIZE } from "../../utils/Constants";
import {
  encodeId,
  formatNodeLabel,
  buildG6Node,
  buildG6Edge,
  extractGraphFromQueryResult
} from "../../utils/GraphResultExtractor";
import NeighborsFetcher from "../../utils/NeighborsFetcher";
import PathFinder, { MAX_HOPS } from "../../utils/PathFinder";
import { useSettingsStore } from "../../store/SettingsStore";
import { useModeStore } from "../../store/ModeStore";
import { useNotebookStore } from "../../store/NotebookStore";
import { mapStores } from 'pinia'
import ValueFormatter from "../../utils/ValueFormatter";
import HoverContainer from "./HoverContainer.vue";
import GraphToast from "./GraphToast.vue";
import ExternalLinksPanel from "./ExternalLinksPanel.vue";
import SourceProvenancePanel from "./SourceProvenancePanel.vue";
import ConnectedEntitiesPanel from "./ConnectedEntitiesPanel.vue";
import ConfidenceIndicator from "./ConfidenceIndicator.vue";
import ResultDisclaimer from "./ResultDisclaimer.vue";
import EntityPinPanel from "./EntityPinPanel.vue";
import {
  nodeTypeDisplayName,
  relTypeDisplayName,
  hideInternalProperties
} from "../../utils/DisplayPolicy";
import Axios from "@/utils/AxiosWrapper";
import { createGraphConfig, getLayoutConfig } from "./graphConfig";
import { generateExportCode, parseExportCode } from "@/utils/InvestigationState";

// Idle time before an armed inline danger-confirm (Clear Canvas) auto-reverts
// to its trigger button, so a stray "clear" can't linger armed. Matches the
// notebook sidebar's two-stage confirm timing.
const CONFIRM_AUTO_REVERT_MS = 5000;

export default {
  name: "ResultGraph",
  components: {
    HoverContainer,
    GraphToast,
    ExternalLinksPanel,
    SourceProvenancePanel,
    ConnectedEntitiesPanel,
    ConfidenceIndicator,
    ResultDisclaimer,
    EntityPinPanel
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
    // Two-stage inline confirm for the Clear Canvas action (no native dialog),
    // auto-reverting after a few idle seconds via clearCanvasConfirmTimer.
    confirmingClearCanvas: false,
    clearCanvasConfirmTimer: null,
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
    propertiesExpanded: true,
    neighborCounts: {},
    profligateNodes: new Set(),
    neighborCountsLoading: new Set(),
    toastMessage: null,
    toastTimeout: null,
    shownProfligateWarnings: new Set(),
    currentLayout: 'd3-force',
    layoutFitTimeout: null,
    historyManager: null,
    historyVersion: 0,
    isUndoRedoInProgress: false,
    // Re-entrancy guard for pin navigation (see handleSelectPinnedEntity).
    pinSelectInFlight: false,
    // ---- Find-connection (shortest path between two entities) -----------
    // Re-entrancy guard so a second find can't interleave a duplicate history
    // entry while one is still running (mirrors pinSelectInFlight).
    findConnectionInFlight: false,
    // Node-panel picker: pick a second endpoint (a notebook pin or a searched
    // entity) to connect the selected node to.
    showConnectionPicker: false,
    connectionSearchQuery: "",
    connectionSearchType: "Person",
    connectionSearchResults: [],
    connectionSearchTimer: null,
    connectionSearchRequestId: 0,
    connectionSearchUnavailable: false,
    // Outcome banner shown after a find (the SOLE outcome surface — no toast).
    // { status: 'found'|'no-path'|'timeout'|'error', hops, endpoints } or null
    // when nothing to show.
    connectionResult: null,
  }),
  computed: {
    // Exposed to the template so the no-path banner can name the hop ceiling.
    MAX_HOPS() {
      return MAX_HOPS;
    },
    graphVizSettings() {
      return this.settingsStore.graphVizSettings;
    },
    performanceSettings() {
      return this.settingsStore.performance;
    },
    // A stable signature of the ACTIVE notebook's pinned entity keys. Changes on
    // pin/unpin AND when the active notebook switches (pinnedEntities is scoped
    // to the active notebook), so a watcher on it drives canvas badge sync in
    // both cases without touching graph data.
    pinnedKeySignature() {
      return this.notebookStore.pinnedEntities
        .map((pin) => pin.key)
        .sort()
        .join(',');
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
    isNodeSelectedOrHovered() {
      return this.clickedLabel !== "";
    },
    displayLabel() {
      return this.clickedLabel;
    },
    displayProperties() {
      // Internal fields stay in clickedProperties for the confidence indicator
      // to read, but are hidden from the raw rows. The entity/relationship type
      // row is shown as the header badge instead, so drop the label row too.
      return hideInternalProperties(this.clickedProperties, { dropLabel: true });
    },
    clickedTypeDisplayName() {
      if (!this.clickedLabel) {
        return "";
      }
      return this.clickedIsNode
        ? nodeTypeDisplayName(this.clickedLabel)
        : relTypeDisplayName(this.clickedLabel);
    },
    entityDisplayName() {
      if (!this.clickedLabel) {
        return "";
      }
      if (!this.clickedIsNode) {
        return relTypeDisplayName(this.clickedLabel);
      }
      // Internal node tables (VirtualHub) have no human-readable property
      if (nodeTypeDisplayName(this.clickedLabel) !== this.clickedLabel) {
        return nodeTypeDisplayName(this.clickedLabel);
      }
      const labelProp = this.settingsStore.settingsForLabel(this.clickedLabel).label;
      const named = this.clickedProperties.find(p => p.name === labelProp);
      if (named && named.value && named.value !== 'NULL') {
        return named.value;
      }
      const pk = this.clickedProperties.find(p => p.isPrimaryKey);
      return pk ? pk.value : nodeTypeDisplayName(this.clickedLabel);
    },
    // Cluster id of the clicked node (primary key; fall back to the "id"
    // property). Mirrors EntityPinPanel.pk so the top-bar Pin button keys the
    // notebook store the same way the mid-panel one does.
    clickedPk() {
      const pkProp = this.clickedProperties.find(p => p.isPrimaryKey);
      if (pkProp && pkProp.value != null) return String(pkProp.value);
      const idProp = this.clickedProperties.find(p => p.name === "id");
      return idProp && idProp.value != null ? String(idProp.value) : null;
    },
    // Human-readable caption for the clicked node, resolved through the same
    // per-entity-type label mapping EntityPinPanel.displayName uses; falls back
    // to the raw pk for an unknown/virtual type or a missing caption property.
    clickedDisplayName() {
      const labelProp = this.settingsStore.settingsForLabel(this.clickedLabel)?.label;
      if (labelProp) {
        const named = this.clickedProperties.find(p => p.name === labelProp);
        if (named && named.value != null && named.value !== "NULL") {
          return String(named.value);
        }
      }
      return this.clickedPk;
    },
    // Live pinned state of the clicked node (reactive off the notebook store),
    // driving the top-bar Pin button's label/style.
    clickedNodePinned() {
      if (!this.clickedPk) return false;
      return this.notebookStore.isPinned(this.clickedLabel, this.clickedPk);
    },
    // Several raw rel tables can share one display name (e.g. Person/Corporate
    // ownership both read "Ownership"); merge their overview counts.
    mergedRelCounts() {
      const merged = {};
      for (const label of Object.keys(this.counters.rel)) {
        const display = relTypeDisplayName(label);
        if (!merged[display]) {
          merged[display] = { display, count: 0, colorLabel: label };
        }
        merged[display].count += this.counters.rel[label];
      }
      return Object.values(merged);
    },
    orderedNodeCountLabels() {
      // Virtual hubs are an internal construct — list them after real entity types
      return Object.keys(this.counters.node).sort(
        (a, b) => Number(a === 'VirtualHub') - Number(b === 'VirtualHub')
      );
    },
    ...mapStores(useSettingsStore, useModeStore, useNotebookStore),
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
    // Keep the canvas star badges in step with the active notebook's pins.
    // Fires on pin/unpin and on active-notebook switch (see the computed).
    pinnedKeySignature() {
      this.syncPinBadges();
    },
  },
  created() {
    this.historyManager = new GraphHistoryManager(50, () => {
      this.historyVersion++;
    });
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

    // Prevent right-click from triggering G6's drag-canvas behavior
    // G6's drag-canvas starts on pointerdown, but when right-click opens the
    // context menu, the pointerup never fires, leaving drag mode stuck.
    // By stopping propagation on right-click pointerdown, we let the browser
    // handle the context menu natively without G6 interference.
    this.$refs.graph.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        e.stopPropagation();
      }
    }, true); // Use capture phase to intercept before G6

    // Keyboard shortcuts for undo/redo. Gated on isGraphVisible() for the same
    // reason as Delete below: multiple ResultGraph instances stay mounted at
    // once (hidden Table/Code tabs, other notebook cells) and each keeps its own
    // live global keydown listener + history stack. Without the gate a Ctrl+Z
    // meant for the graph the user is looking at would ALSO fire undo on every
    // hidden cell, silently mutating graphs off-screen — and the add-via-search
    // path (which can leave focus in the search box of the visible cell) would
    // undo against the wrong instance. Unlike Delete this deliberately does NOT
    // gate on isTypingContext(): Ctrl+Z must still undo the graph while focus is
    // in the node-search box, since a picked suggestion is added additively and
    // the user expects Ctrl+Z to remove it.
    this.handleKeydown = (e) => {
      // Ctrl+Z (or Cmd+Z on Mac) for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && this.isGraphVisible()) {
        e.preventDefault();
        this.undo();
      }
      // Ctrl+Y or Ctrl+Shift+Z (or Cmd variants) for redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && this.isGraphVisible()) {
        e.preventDefault();
        this.redo();
      }
      // Delete (NOT Backspace) removes the currently-selected node, but only
      // when the graph has focus context — never hijack Delete while the user
      // is typing in an input/textarea/contenteditable or the Cypher editor.
      // The isGraphVisible() gate matters because multiple ResultGraph
      // instances stay mounted at once (hidden Table/Code tabs, other notebook
      // cells) and each keeps its own live global keydown listener + clickedId;
      // without it a Delete would silently remove a node from a graph the user
      // isn't even looking at.
      if (e.key === 'Delete' && !this.isTypingContext() && this.isGraphVisible() &&
          this.clickedId && this.isNodeOnCanvas(this.clickedId)) {
        e.preventDefault();
        this.removeNodeById(this.clickedId);
      }
    };
    window.addEventListener('keydown', this.handleKeydown);
  },
  beforeUnmount() {
    if (this.layoutFitTimeout) {
      clearTimeout(this.layoutFitTimeout);
    }
    if (this.g6Graph) {
      this.g6Graph.destroy();
    }
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("mousemove", this.handleResizeMove);
    window.removeEventListener("mouseup", this.stopResize);
    window.removeEventListener('keydown', this.handleKeydown);
    // Tear down any live find-connection picker dismissal listeners.
    document.removeEventListener("keydown", this.onConnectionPickerKeydown);
    document.removeEventListener("mousedown", this.onConnectionPickerClickAway, true);
    if (this.connectionSearchTimer) {
      window.clearTimeout(this.connectionSearchTimer);
    }
    if (this.clearCanvasConfirmTimer) {
      window.clearTimeout(this.clearCanvasConfirmTimer);
    }
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
    displayNodeType(label) {
      return nodeTypeDisplayName(label);
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
      let { counters, nodes, edges, } = this.extractGraphFromQueryResultMethod(this.queryResult);
      this.counters = counters;
      // Track original node IDs so they're never removed during collapse
      this.originalNodeIds = new Set(nodes.map(n => n.id));
      // Reset expansion tracking for new query
      this.nodeIntroducedBy = {};
      this.expansions = [];
      // Clear undo/redo history for new query
      this.historyManager.clear();
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
        this.syncPinBadges();
      });
    },

    removeNode() {
      return this.removeNodeById(this.clickedId);
    },

    /**
     * True when a node with this ID is currently on the canvas.
     */
    isNodeOnCanvas(nodeId) {
      if (!this.g6Graph || !nodeId) return false;
      return (this.g6Graph.getNodeData() || []).some((n) => n.id === nodeId);
    },

    /**
     * True when this graph's container is actually visible on screen.
     * offsetParent is null for a display:none element (what v-show sets on a
     * hidden Table/Code tab or off-screen cell), so a mounted-but-hidden
     * ResultGraph reports false here — used to keep the global Delete listener
     * from acting on a graph the user isn't looking at.
     */
    isGraphVisible() {
      return !!(this.$refs.graph && this.$refs.graph.offsetParent !== null);
    },

    /**
     * Permanently remove a node and its incident edges from the graph. Mirrors
     * the collapse removal path (removeFromGraph + nodeIntroducedBy/expansions
     * cleanup) so a removed node cannot resurface via expand paths and isn't
     * counted as unexpanded. Undoable via the 'remove' history entry.
     */
    async removeNodeById(nodeId) {
      if (!this.g6Graph || !nodeId) return;

      const currentNodes = this.g6Graph.getNodeData() || [];
      const removedNode = currentNodes.find((n) => n.id === nodeId);
      if (!removedNode) return;

      const currentEdges = this.g6Graph.getEdgeData() || [];
      const relatedEdges = currentEdges.filter(
        (edge) => edge.source === nodeId || edge.target === nodeId
      );

      const nodeIdsToRemove = new Set([nodeId]);
      const edgeIdsToRemove = new Set(relatedEdges.map((e) => e.id));

      // Capture full node/edge data BEFORE removal so undo can restore it.
      const removedNodes = [removedNode];
      const removedEdges = relatedEdges;

      // Capture nodeIntroducedBy entries and any expansion keyed on this node
      // so undo can restore them (and so the removed node can't be re-expanded).
      // We capture BOTH the removed node's own entry (who introduced it) and any
      // orphaned back-pointers where the removed node is the VALUE — children it
      // introduced stay on canvas, but their "introduced by" pointer would now
      // dangle at a gone node, so clean those too (captured for a faithful undo).
      const removedNodeIntroducedBy = {};
      Object.keys(this.nodeIntroducedBy).forEach((key) => {
        if (key === nodeId || this.nodeIntroducedBy[key] === nodeId) {
          removedNodeIntroducedBy[key] = this.nodeIntroducedBy[key];
        }
      });
      const removedExpansions = this.expansions.filter((e) => e.id === nodeId);

      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);

      // Clean up tracking for the removed node and its dangling back-pointers.
      Object.keys(removedNodeIntroducedBy).forEach((key) => {
        delete this.nodeIntroducedBy[key];
      });
      this.expansions = this.expansions.filter((e) => e.id !== nodeId);

      // Record command for undo/redo
      this.historyManager.push({
        type: 'remove',
        data: {
          removedNodes: JSON.parse(JSON.stringify(removedNodes)),
          removedEdges: JSON.parse(JSON.stringify(removedEdges)),
          removedNodeIntroducedBy,
          removedExpansions: JSON.parse(JSON.stringify(removedExpansions)),
        }
      });

      this.deselectAll();
      this.$nextTick(() => this.updateNeighborCounts());
    },

    // ---- Clear Canvas: two-stage inline confirm (no native dialog) ---------
    // First click arms the confirm and starts an auto-revert timer so a stray
    // "clear" can't linger armed; the second click actually clears the canvas.
    startClearCanvas() {
      this.confirmingClearCanvas = true;
      this.armClearCanvasAutoRevert();
      this.$nextTick(() => this.$refs.clearCanvasConfirmBtn?.focus());
    },
    cancelClearCanvas() {
      this.clearClearCanvasTimer();
      this.confirmingClearCanvas = false;
      this.$nextTick(() => this.$refs.clearCanvasBtn?.focus());
    },
    armClearCanvasAutoRevert() {
      this.clearClearCanvasTimer();
      this.clearCanvasConfirmTimer = window.setTimeout(() => {
        this.confirmingClearCanvas = false;
        this.clearCanvasConfirmTimer = null;
      }, CONFIRM_AUTO_REVERT_MS);
    },
    clearClearCanvasTimer() {
      if (this.clearCanvasConfirmTimer) {
        window.clearTimeout(this.clearCanvasConfirmTimer);
        this.clearCanvasConfirmTimer = null;
      }
    },

    /**
     * Remove ALL nodes and edges from the canvas in one operation, undoable as a
     * SINGLE 'remove' history entry (the same type single-node removal pushes),
     * so one undo restores everything (nodes, edges, expansions, nodeIntroducedBy,
     * counts and pin badges). Clears the CANVAS only — the notebook (pins, notes,
     * saved views) is never touched. Uses the canonical removeFromGraph path.
     */
    async clearCanvas() {
      if (!this.g6Graph) {
        this.clearClearCanvasTimer();
        this.confirmingClearCanvas = false;
        return;
      }

      const currentNodes = this.g6Graph.getNodeData() || [];
      const currentEdges = this.g6Graph.getEdgeData() || [];

      // Nothing on canvas: just dismiss the confirm, no history entry.
      if (currentNodes.length === 0) {
        this.clearClearCanvasTimer();
        this.confirmingClearCanvas = false;
        return;
      }

      // Capture full state BEFORE removal so a single undo can restore it.
      // Shape matches what undoRemove/redoRemove consume.
      const removedNodes = JSON.parse(JSON.stringify(currentNodes));
      const removedEdges = JSON.parse(JSON.stringify(currentEdges));
      const removedExpansions = JSON.parse(JSON.stringify(this.expansions));
      const removedNodeIntroducedBy = JSON.parse(JSON.stringify(this.nodeIntroducedBy));

      const allNodeIds = new Set(currentNodes.map((n) => n.id));
      const allEdgeIds = new Set(currentEdges.map((e) => e.id));

      await this.removeFromGraph(allNodeIds, allEdgeIds);

      // Everything is gone: reset live tracking. The captured copies above live
      // in the history entry for undo.
      this.expansions = [];
      this.nodeIntroducedBy = {};

      // One history entry — a single Ctrl+Z restores the whole canvas.
      this.historyManager.push({
        type: 'remove',
        data: {
          removedNodes,
          removedEdges,
          removedNodeIntroducedBy,
          removedExpansions,
        }
      });

      // Housekeeping (mirrors removeNodeById / undoRemove): clear selection and
      // re-sync pin badges to "none on canvas" and counts to 0.
      this.deselectAll();
      this.clearClearCanvasTimer();
      this.confirmingClearCanvas = false;
      this.$nextTick(() => {
        this.$refs.connectedEntitiesPanel?.refreshInGraphStatus();
        this.updateNeighborCounts();
      });
    },

    /**
     * True when the user is typing in a form field or the Cypher editor, so
     * keyboard shortcuts (e.g. Delete-to-remove) must not be hijacked.
     */
    isTypingContext() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      if (el.closest && el.closest('.monaco-editor')) return true;
      return false;
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

      // Clear both inactive and active states from all elements
      const combined = {};
      this.g6Graph.getNodeData().forEach((node) => {
        combined[node.id] = [];
      });
      this.g6Graph.getEdgeData().forEach((edge) => {
        combined[edge.id] = [];
      });

      // Re-apply active state to currently selected element
      if (this.clickedId) {
        combined[this.clickedId] = ['active'];
      }

      this.setElementState(combined);
    },

    // Delegate to utility function for extracting G6 graph data from query results
    extractGraphFromQueryResultMethod(queryResult) {
      return extractGraphFromQueryResult(
        queryResult,
        this.schema,
        this.settingsStore,
        this.settingsStore.performance
      );
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

    handleConnectedNodeClick(nodeId) {
      // Select the connected node in the graph
      try {
        const nodeData = this.g6Graph.getNodeData(nodeId);
        if (nodeData) {
          this.handleClick(nodeData);
        }
      } catch (e) {
        // Node not found in graph
        console.warn('Connected node not found in graph:', nodeId);
      }
    },

    async handleAddConnectedNode(entity) {
      if (!entity.rawNode || !entity.rawRel) {
        console.warn('Cannot add node: missing raw data');
        return;
      }

      const rawNode = entity.rawNode;
      // Pin the source node NOW: the user can select another node while the
      // fetch/add below are awaited, and the history entry must attribute the
      // add to the node it actually expanded (it is used to invalidate that
      // node's neighbour count on undo).
      const sourceNodeId = this.clickedId;
      const nodesBefore = new Set((this.g6Graph.getNodeData() || []).map(n => n.id));
      const edgesBefore = new Set((this.g6Graph.getEdgeData() || []).map(e => e.id));

      // Fetch all edges between the two nodes to add them in a single render
      const allRels = [entity.rawRel];
      try {
        const currentNodeData = this.g6Graph.getNodeData(sourceNodeId);
        const { tableName, primaryKeyName, primaryKeyValue } = this.getInfoForExpansion(currentNodeData);
        const newNodeTableName = rawNode._label;
        const newNodeSchema = this.schema.nodeTables.find(t => t.name === newNodeTableName);
        const newNodePkProp = newNodeSchema?.properties.find(p => p.isPrimaryKey);
        const newNodePkName = newNodePkProp?.name;
        const newNodePkValue = rawNode[newNodePkName];

        if (newNodePkName && newNodePkValue !== undefined) {
          const result = await NeighborsFetcher.fetchRelsBetween({
            tableA: tableName,
            primaryKeyNameA: primaryKeyName,
            primaryKeyValueA: primaryKeyValue,
            tableB: newNodeTableName,
            primaryKeyNameB: newNodePkName,
            primaryKeyValueB: newNodePkValue,
            relTables: this.schema.relTables,
            isWasm: this.modeStore.isWasm,
          });

          if (result && result.rows) {
            const initialRelId = entity.rawRel._id;
            result.rows.forEach(row => {
              const rel = row.r;
              if (rel && rel._id && (rel._id.table !== initialRelId.table || rel._id.offset !== initialRelId.offset)) {
                allRels.push(rel);
              }
            });
          }
        }
      } catch (e) {
        console.warn('Failed to fetch additional edges:', e);
      }

      const queryResult = {
        rows: [[rawNode, ...allRels]],
        dataTypes: ['NODE', ...allRels.map(() => 'REL')],
      };
      await this.addDataWithQueryResult(queryResult);

      // Complete the edge set among EVERY node now on the canvas — not just the
      // focus<->new-node edges above — so an edge between this new node and some
      // other pre-existing node is drawn immediately. Runs before the diff so
      // the among-edges fold into THIS operation's addedEdges and undo removes
      // both together.
      await this.completeEdgesAmongCurrentNodes();

      const nodesAfter = this.g6Graph.getNodeData() || [];
      const edgesAfter = this.g6Graph.getEdgeData() || [];
      const addedNodes = nodesAfter.filter(n => !nodesBefore.has(n.id));
      const addedEdges = edgesAfter.filter(e => !edgesBefore.has(e.id));

      if (addedNodes.length > 0 || addedEdges.length > 0) {
        this.historyManager.push({
          type: 'add-connected-node',
          data: {
            sourceNodeId,
            addedNodes: JSON.parse(JSON.stringify(addedNodes)),
            addedEdges: JSON.parse(JSON.stringify(addedEdges)),
          }
        });
      }
    },

    /**
     * Draw every edge whose BOTH endpoints already exist on the canvas but
     * that isn't yet drawn — the "complete-edge" pass shared by every
     * expand/add path so growing the graph never leaves inter-node edges
     * undrawn (the core reason the "Fully Expanded" state used to be a lie).
     *
     * Groups the current canvas nodes by (table, pk column), and asks the
     * fetcher for all edges AMONG those nodes in one bounded pass
     * (fetchRelsAmongNodes issues one query per rel-type x unordered table
     * pairing — constant in node count). Adds only edges: the node set already
     * exists, so addData skips the nodes and nodeIntroducedBy is untouched.
     *
     * Returns the edge objects it added (already on the canvas), so the caller
     * can fold them into the triggering operation's history entry. Callers that
     * compute their addedEdges diff AFTER awaiting this get the widened set for
     * free.
     */
    async completeEdgesAmongCurrentNodes() {
      if (!this.g6Graph) {
        return [];
      }
      let addedEdges = [];
      try {
        // Group EVERY node currently on the canvas by (table, pk column) — the
        // whole canvas, not just the focus node's fresh neighbours, is what lets
        // the edge engine see inter-node edges the focus->neighbour fetch never
        // asks for.
        const others = this.groupCanvasNodesByTable();
        if (others.length === 0) {
          return [];
        }

        const amongResult = await NeighborsFetcher.fetchRelsAmongNodes({
          nodes: others,
          relTables: this.schema.relTables,
          isWasm: this.modeStore.isWasm,
        });
        if (!amongResult || !amongResult.rows || amongResult.rows.length === 0) {
          return [];
        }

        const rels = [];
        amongResult.rows.forEach(row => {
          if (row.r && row.r._id) {
            rels.push(row.r);
          }
        });
        if (rels.length === 0) {
          return [];
        }

        const edgesBefore = new Set((this.g6Graph.getEdgeData() || []).map(e => e.id));
        // REL-only row: extractGraphFromQueryResult keys on dataTypes[column],
        // so no NODE columns means addData adds only the (new) edges.
        await this.addDataWithQueryResult({
          rows: [rels],
          dataTypes: rels.map(() => 'REL'),
        });
        addedEdges = (this.g6Graph.getEdgeData() || []).filter(e => !edgesBefore.has(e.id));
      } catch (e) {
        console.warn('Failed to complete edges among current nodes:', e);
      }
      return addedEdges;
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

    // Count only neighbours that are NOT already present on the canvas.
    // Neighbour identity uses the same {table}_{offset} g6 id encoding as the
    // rest of the graph, so a neighbour already drawn is never re-counted.
    // Pure over its inputs (reads only the g6 graph) so it is unit-testable.
    countNewNeighborNodes(neighborNodes) {
      if (!Array.isArray(neighborNodes)) {
        return 0;
      }
      const seen = new Set();
      let newCount = 0;
      neighborNodes.forEach(neighbor => {
        if (!neighbor || !neighbor._id) {
          return;
        }
        const neighborId = encodeId(neighbor._id);
        if (seen.has(neighborId)) {
          return;
        }
        seen.add(neighborId);
        try {
          this.g6Graph.getNodeData(neighborId);
          // Node already on the canvas, don't count.
        } catch (e) {
          // Node not present, count it as a NEW neighbour.
          newCount++;
        }
      });
      return newCount;
    },

    // Record a computed neighbour count and refresh the ">10 new neighbours"
    // profligate badge. Single source of truth for the badge threshold.
    recordNeighborCount(nodeId, newCount) {
      this.neighborCounts[nodeId] = newCount;
      if (newCount > 10) {
        this.profligateNodes.add(nodeId);
        this.updateNodeBadge(nodeId, true);
      } else {
        this.profligateNodes.delete(nodeId);
        this.updateNodeBadge(nodeId, false);
      }
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

        // One request per rel type, covering just this node.
        const neighborsByPk = await NeighborsFetcher.fetchNeighborNodesBatched({
          tableName,
          primaryKeyName,
          primaryKeyValues: [primaryKeyValue],
          relTables: this.schema.relTables,
          isWasm: this.modeStore.isWasm,
        });

        const neighborNodes = neighborsByPk[String(primaryKeyValue)] || [];
        const newCount = this.countNewNeighborNodes(neighborNodes);
        this.recordNeighborCount(nodeId, newCount);
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

        // Find leaf nodes (nodes that are visible but not yet expanded) that
        // still need a count: skip anything already cached or in flight so we
        // never refetch.
        const expandedNodeIds = new Set(this.expansions.map(e => e.id));
        const leafNodes = allNodes.filter(node =>
          !expandedNodeIds.has(node.id) &&
          this.neighborCounts[node.id] === undefined &&
          !this.neighborCountsLoading.has(node.id)
        );
        if (leafNodes.length === 0) {
          return;
        }

        // Group leaf nodes by their node table + primary-key column so each
        // batched query has a single consistent table and pk name. Leaf nodes
        // can span multiple node tables (one group -> M queries each).
        const groups = new Map();
        leafNodes.forEach(node => {
          try {
            const { tableName, primaryKeyName, primaryKeyValue } = this.getInfoForExpansion(node);
            const groupKey = tableName;
            if (!groups.has(groupKey)) {
              groups.set(groupKey, { tableName, primaryKeyName, entries: [] });
            }
            groups.get(groupKey).entries.push({ nodeId: node.id, primaryKeyValue });
            this.neighborCountsLoading.add(node.id);
          } catch (e) {
            console.error("Failed to resolve node for neighbor count:", e);
          }
        });

        // Fire one batched fetch per node-table group; within a group the
        // fetcher issues one query per rel type covering ALL nodes in the
        // group. Total requests scale with (groups x rel types), independent of
        // the number of leaf nodes. Runs in the background.
        Promise.all(
          Array.from(groups.values()).map(async group => {
            try {
              const neighborsByPk = await NeighborsFetcher.fetchNeighborNodesBatched({
                tableName: group.tableName,
                primaryKeyName: group.primaryKeyName,
                primaryKeyValues: group.entries.map(e => e.primaryKeyValue),
                relTables: this.schema.relTables,
                isWasm: this.modeStore.isWasm,
              });

              group.entries.forEach(entry => {
                const neighborNodes = neighborsByPk[String(entry.primaryKeyValue)] || [];
                const newCount = this.countNewNeighborNodes(neighborNodes);
                this.recordNeighborCount(entry.nodeId, newCount);
              });
            } catch (e) {
              console.error("Failed to fetch batched neighbor counts:", e);
              // Populate a zero count so readers don't spin forever.
              group.entries.forEach(entry => {
                if (this.neighborCounts[entry.nodeId] === undefined) {
                  this.neighborCounts[entry.nodeId] = 0;
                }
              });
            } finally {
              group.entries.forEach(entry => this.neighborCountsLoading.delete(entry.nodeId));
            }
          })
        ).catch(e => {
          console.error("Error updating neighbor counts:", e);
        });
      } catch (e) {
        console.error("Failed to update neighbor counts:", e);
      }
    },

    async expandOnNode(model) {
      const { tableName, primaryKeyValue, primaryKeyName } = this.getInfoForExpansion(model);
      const sizeLimit = this.settingsStore.performance.maxNumberOfNodesToExpand;
      let neighbors = null;
      try {
        neighbors = await NeighborsFetcher.fetchNeighbors({
          tableName,
          primaryKeyName,
          primaryKeyValue,
          relTables: this.schema.relTables,
          sizeLimit,
          isWasm: this.modeStore.isWasm,
        });
      } catch (e) {
        // Ignore error for now. Just don't expand if the core does not execute the query.
        console.error(e);
        return;
      }
      if (!neighbors) {
        return;
      }

      // Capture state BEFORE adding
      const nodesBefore = new Set((this.g6Graph.getNodeData() || []).map(n => n.id));
      const edgesBefore = new Set((this.g6Graph.getEdgeData() || []).map(e => e.id));

      await this.addDataWithQueryResult(neighbors);

      // Draw edges among ALL current nodes, not just focus->neighbour, so a
      // newly-added leaf that also connects to another on-canvas node gets that
      // edge immediately. Runs before the diff so those edges fold into this
      // expand's addedEdges and undo removes them with the expansion.
      await this.completeEdgesAmongCurrentNodes();

      // Capture added nodes/edges AFTER adding
      const nodesAfter = this.g6Graph.getNodeData() || [];
      const edgesAfter = this.g6Graph.getEdgeData() || [];
      const addedNodes = nodesAfter.filter(n => !nodesBefore.has(n.id));
      const addedEdges = edgesAfter.filter(e => !edgesBefore.has(e.id));

      this.expansions.push({
        id: model.id, neighbors
      });

      // Track which expansion introduced each new node (only if not already tracked)
      const nodeIntroducedByEntries = {};
      neighbors.rows.forEach((row) => {
        if (row.dst && row.dst._id) {
          const nodeId = encodeId(row.dst._id);
          if (!this.nodeIntroducedBy[nodeId] && !this.originalNodeIds.has(nodeId)) {
            this.nodeIntroducedBy[nodeId] = model.id;
            nodeIntroducedByEntries[nodeId] = model.id;
          }
        }
      });

      // Record command for undo/redo
      this.historyManager.push({
        type: 'expand',
        data: {
          sourceNodeId: model.id,
          addedNodes: JSON.parse(JSON.stringify(addedNodes)),
          addedEdges: JSON.parse(JSON.stringify(addedEdges)),
          expansionEntry: { id: model.id, neighbors },
          nodeIntroducedByEntries
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

          const neighbors = await NeighborsFetcher.fetchNeighbors({
            tableName,
            primaryKeyName,
            primaryKeyValue,
            relTables: this.schema.relTables,
            sizeLimit,
            isWasm: this.modeStore.isWasm,
          });

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
        const { nodes } = this.extractGraphFromQueryResultMethod(neighbors);

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

      // Capture state BEFORE adding for undo
      const nodesBefore = new Set((this.g6Graph.getNodeData() || []).map(n => n.id));
      const edgesBefore = new Set((this.g6Graph.getEdgeData() || []).map(e => e.id));

      // Track all expansions and nodeIntroducedBy entries for undo
      const allExpansionEntries = [];
      const allNodeIntroducedByEntries = {};

      // Add normal nodes only
      for (const { nodeId, neighbors } of nodesToExpand) {
        await this.addDataWithQueryResult(neighbors);
        const expansionEntry = { id: nodeId, neighbors };
        this.expansions.push(expansionEntry);
        allExpansionEntries.push(expansionEntry);

        // Track which expansion introduced each new node
        neighbors.rows.forEach((row) => {
          if (row.dst && row.dst._id) {
            const newNodeId = encodeId(row.dst._id);
            if (!this.nodeIntroducedBy[newNodeId] && !this.originalNodeIds.has(newNodeId)) {
              this.nodeIntroducedBy[newNodeId] = nodeId;
              allNodeIntroducedByEntries[newNodeId] = nodeId;
            }
          }
        });
      }

      // Complete edges among ALL nodes now on the canvas — the per-node
      // fetchNeighbors above only draws focus->neighbour edges, so edges
      // BETWEEN the newly-added leaves (or to other pre-existing nodes) would
      // otherwise stay undrawn even once every node reports as expanded. Runs
      // before the diff so those edges fold into this expansion's addedEdges.
      await this.completeEdgesAmongCurrentNodes();

      // Capture added nodes/edges AFTER adding for undo
      const nodesAfter = this.g6Graph.getNodeData() || [];
      const edgesAfter = this.g6Graph.getEdgeData() || [];
      const addedNodes = nodesAfter.filter(n => !nodesBefore.has(n.id));
      const addedEdges = edgesAfter.filter(e => !edgesBefore.has(e.id));

      // Record command for undo/redo (batch expansion)
      if (addedNodes.length > 0 || addedEdges.length > 0) {
        this.historyManager.push({
          type: 'expandGraph',
          data: {
            addedNodes: JSON.parse(JSON.stringify(addedNodes)),
            addedEdges: JSON.parse(JSON.stringify(addedEdges)),
            expansionEntries: allExpansionEntries,
            nodeIntroducedByEntries: allNodeIntroducedByEntries
          }
        });
      }

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
          nodeIds.add(encodeId(row.dst._id));
        }
        if (row.r && row.r._id) {
          edgeIds.add(encodeId(row.r._id));
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
            const nodeId = encodeId(row.dst._id);
            protectedNodeIds.add(nodeId);
          }
          if (row.r && row.r._id) {
            protectedEdgeIds.add(encodeId(row.r._id));
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

      // Capture removed expansions BEFORE modification
      const subtree = this.getExpansionSubtree(id);
      const removedExpansions = [];
      subtree.forEach(expId => {
        const exp = this.expansions.find(e => e.id === expId);
        if (exp) removedExpansions.push(JSON.parse(JSON.stringify(exp)));
      });

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

      // Capture full node/edge data BEFORE removal
      const currentNodes = this.g6Graph.getNodeData() || [];
      const currentEdges = this.g6Graph.getEdgeData() || [];
      const removedNodes = currentNodes.filter(n => nodeIdsToRemove.has(n.id));
      const removedEdges = currentEdges.filter(e => edgeIdsToRemove.has(e.id));

      // Capture nodeIntroducedBy entries being removed
      const removedNodeIntroducedBy = {};
      nodeIdsToRemove.forEach(nodeId => {
        if (this.nodeIntroducedBy[nodeId]) {
          removedNodeIntroducedBy[nodeId] = this.nodeIntroducedBy[nodeId];
        }
      });

      // 5. Remove from graph
      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);

      // 6. Clean up nodeIntroducedBy for removed nodes
      nodeIdsToRemove.forEach(nodeId => {
        delete this.nodeIntroducedBy[nodeId];
      });

      // Record command for undo/redo
      this.historyManager.push({
        type: 'collapse',
        data: {
          sourceNodeId: id,
          removedNodes: JSON.parse(JSON.stringify(removedNodes)),
          removedEdges: JSON.parse(JSON.stringify(removedEdges)),
          removedExpansions,
          removedNodeIntroducedBy
        }
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

    async addDataWithQueryResult(queryResult) {
      const { nodes, edges } = this.extractGraphFromQueryResultMethod(queryResult);
      await this.addData(nodes, edges);
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
        this.syncPinBadges();
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
      await this.applyLayoutInternal(layoutType);

      // Record command for undo/redo (only if layout actually changed)
      if (previousLayout !== this.currentLayout) {
        this.historyManager.push({
          type: 'layout',
          data: { from: previousLayout, to: layoutType }
        });
      }
    },

    /**
     * Apply a layout without recording to history.
     * Used by changeLayout() and undo/redo operations.
     */
    async applyLayoutInternal(layoutType) {
      if (!this.g6Graph) {
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

        // Update layout
        this.g6Graph.setLayout(layoutConfig);

        // Execute layout with animation
        await this.g6Graph.layout();

        // Update drag behaviors AFTER successful layout
        const wasForce = previousLayout === 'd3-force';
        const isForce = layoutType === 'd3-force';
        if (wasForce !== isForce) {
          try {
            this.g6Graph.updateBehavior({ key: 'drag-force', enable: isForce });
            this.g6Graph.updateBehavior({ key: 'drag-normal', enable: !isForce });
          } catch (e) {
            console.warn('Failed to update drag behavior:', e);
          }
        }

        // Update current layout state
        this.currentLayout = layoutType;

        // Save preference to settings store
        this.settingsStore.setGraphLayout(layoutType);

        // Clear any pending fit timeout before scheduling a new one
        if (this.layoutFitTimeout) {
          clearTimeout(this.layoutFitTimeout);
        }

        // After layout animation, center on graph and only zoom out if needed
        this.layoutFitTimeout = setTimeout(() => {
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

    /**
     * The G6 v5 badges style for a node given its pinned state. A pinned node
     * carries a single star badge at its top-right; an unpinned node carries an
     * empty badges array (which removes any previously-rendered badge). The star
     * glyph is drawn with the Font Awesome font already used for node icons.
     */
    pinBadgesFor(isPinned) {
      if (!isPinned) return [];
      return [{
        text: '\uf005', // fa-star (solid)
        placement: 'right-top',
        fontFamily: 'Font Awesome 6 Free',
        fontWeight: 900,
        fontSize: 12,
        fill: '#ffffff',
        backgroundFill: '#f5a623',
        padding: [2, 2],
      }];
    },

    /**
     * Reconcile the star badge on every canvas node with the active notebook's
     * pins. Reactive to pin/unpin and to the active notebook switching (both are
     * driven by the watcher on the pinned-key set below). Uses updateNodeData so
     * only badges change — no canvas rebuild.
     *
     * Delta-only: fresh badges arrays would defeat G6's shallow style dedup, so
     * only nodes whose badge PRESENCE actually changed are updated, and draw()
     * is skipped entirely when nothing changed. Current presence is read from
     * the node's own data model (style.badges) rather than a side Set, so it
     * survives graph rebuilds and undo/redo snapshot restores without going
     * stale.
     */
    syncPinBadges() {
      if (!this.g6Graph) return;
      try {
        const updates = [];
        (this.g6Graph.getNodeData() || []).forEach((node) => {
          const props = node.data && node.data.properties;
          const label = props && props._label;
          const pkName = label ? this.primaryKeyNameForLabel(label) : null;
          const pkValue = pkName ? props[pkName] : undefined;
          const pinned = label && pkValue !== undefined && pkValue !== null
            ? this.notebookStore.isPinned(label, String(pkValue))
            : false;
          const hasBadge = Boolean(node.style?.badges?.length);
          if (pinned !== hasBadge) {
            updates.push({ id: node.id, style: { badges: this.pinBadgesFor(pinned) } });
          }
        });
        if (updates.length > 0) {
          this.g6Graph.updateNodeData(updates);
          // draw() commits the style change WITHOUT re-running layout or
          // re-fitting the viewport (render() would do both), so the star badge
          // appears/disappears in place with no canvas rebuild or camera jump.
          this.g6Graph.draw();
        }
      } catch (e) {
        console.warn('Failed to sync pin badges:', e);
      }
    },

    // Investigation State Management Methods

    /**
     * Capture current investigation state for sharing.
     */
    getInvestigationState() {
      const queries = [];
      if (this.queryInfo && this.queryInfo.query) {
        queries.push({
          query: this.queryInfo.query,
          params: this.queryInfo.params || {},
          timestamp: this.queryInfo.timestamp || Date.now(),
        });
      }

      let graphData = { nodes: [], edges: [] };
      if (this.g6Graph) {
        graphData = {
          nodes: this.g6Graph.getNodeData() || [],
          edges: this.g6Graph.getEdgeData() || [],
        };
      }

      return {
        queries,
        graphData,
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

    // Investigation log handlers (pins / saved views panel)

    /**
     * The primary-key property name for a node label, per the schema. Falls
     * back to "id" (the Horkos cluster-id convention) when the schema is
     * unavailable, matching how pins are keyed elsewhere.
     */
    primaryKeyNameForLabel(label) {
      const table = (this.schema?.nodeTables || []).find(t => t.name === label);
      const pkProp = table?.properties?.find(p => p.isPrimaryKey);
      return pkProp ? pkProp.name : 'id';
    },

    /**
     * Find the on-canvas node matching a pin's label + primary key, or null.
     * Matches on the schema's primary-key property rather than a hard-coded
     * "id" so it stays correct if a node table keys on something else.
     */
    findCanvasNodeByLabelPk(label, pk) {
      if (!this.g6Graph) return null;
      const pkName = this.primaryKeyNameForLabel(label);
      return (this.g6Graph.getNodeData() || []).find((node) => {
        const props = node.data && node.data.properties;
        return props && props._label === label && String(props[pkName]) === String(pk);
      }) || null;
    },

    /**
     * Clear every element's selection state and mark one node active, then move
     * the viewport so it is visible. `focusElement` is G6 v5's viewport idiom
     * for bringing an element into view (used here rather than fitCenter, which
     * re-centres the whole graph). The exclusive-clear uses the array-form state
     * convention used everywhere else in this file (disableHighlightMode etc.).
     */
    async selectAndFocusNode(nodeData) {
      this.handleClick(nodeData);
      const combined = {};
      this.g6Graph.getNodeData().forEach((node) => {
        combined[node.id] = [];
      });
      this.g6Graph.getEdgeData().forEach((edge) => {
        combined[edge.id] = [];
      });
      combined[nodeData.id] = ['active'];
      await this.setElementState(combined);
      try {
        await this.g6Graph.focusElement(nodeData.id);
      } catch (e) {
        console.warn('Failed to focus pinned node:', e);
      }
    },

    /**
     * Select a pinned entity, always landing the user on it. A pin is a
     * promise: whatever the entity's state, clicking it in the notebook panel
     * takes you to it.
     *   - On canvas            -> select + move viewport to it.
     *   - Not on canvas        -> refetch by label+pk, add to the canvas with
     *                             any rels to existing canvas nodes, select +
     *                             focus, and record the addition for undo. On an
     *                             empty canvas the pin becomes the seed node.
     *   - Not in the database  -> toast; the entity no longer exists here.
     */
    async handleSelectPinnedEntity({ label, pk }) {
      // In-flight guard: a second click while a fetch-and-add is still running
      // would interleave a second nodesBefore/nodesAfter diff and push a
      // duplicate history entry. Drop re-entrant clicks until this one settles.
      if (this.pinSelectInFlight) {
        return;
      }
      this.pinSelectInFlight = true;
      try {
        await this.doSelectPinnedEntity(label, pk);
      } finally {
        this.pinSelectInFlight = false;
      }
    },

    async doSelectPinnedEntity(label, pk) {
      const match = this.findCanvasNodeByLabelPk(label, pk);
      if (match) {
        // On canvas -> select + focus it.
        await this.selectAndFocusNode(match);
        return;
      }
      // Not on canvas -> refetch and add, or report it's gone.
      await this.fetchAndAddPinnedEntity(label, pk);
    },

    /**
     * Refetch a pinned entity by label + primary key and add it to the canvas,
     * wiring up any rels connecting it to nodes already present, then select +
     * focus it. Pushes the addition to the history manager so it is undoable.
     * If the entity can't be found in the database, surfaces a toast (the only
     * remaining failure path).
     */
    async fetchAndAddPinnedEntity(label, pk) {
      // Refetch full node properties (dual server/WASM path, preserved via
      // refetchNodeProperties). Returns a { pk -> rawNode } map.
      // rethrowQueryErrors keeps a transient query/network failure distinct
      // from a genuinely empty result, so "no longer in this database" is only
      // ever shown when the database really answered with no rows.
      let propsMap;
      try {
        propsMap = await this.refetchNodeProperties(
          [{ label, pk: String(pk) }],
          { rethrowQueryErrors: true }
        );
      } catch (e) {
        console.warn('Pinned entity lookup failed:', e);
        this.showToast("Couldn't check the database — try again.", 5000);
        return;
      }
      const rawNode = propsMap[String(pk)];
      if (!rawNode || !rawNode._label) {
        this.showToast('This pinned entity is no longer in this database.', 5000);
        return;
      }

      // Fetch every rel connecting the pinned node to nodes already on the
      // canvas, grouped by the canvas nodes' table (mirrors how
      // handleAddConnectedNode gathers edges, batched across all present nodes).
      const focusPkName = this.primaryKeyNameForLabel(label);
      const rawRels = [];
      const others = this.groupCanvasNodesByTable();
      if (others.length > 0) {
        try {
          const relResult = await NeighborsFetcher.fetchRelsBetweenNodeAndMany({
            focusTable: label,
            focusPkName,
            focusPkValue: rawNode[focusPkName],
            others,
            relTables: this.schema.relTables,
            isWasm: this.modeStore.isWasm,
          });
          if (relResult && relResult.rows) {
            relResult.rows.forEach(row => {
              if (row.r && row.r._id) rawRels.push(row.r);
            });
          }
        } catch (e) {
          console.warn('Failed to fetch rels for pinned node:', e);
        }
      }

      // A graph instance normally already exists after any query (drawGraph
      // creates it even for a zero-row result), so the common path is a plain
      // incremental add. Only when no query has ever run is g6Graph null; in
      // that case spin up an empty graph first (setupGraphEventHandlers and
      // graphCreated are handled by initializeEmptyGraph) so the pin can seed it.
      const isSeedingEmptyCanvas = !this.g6Graph;
      if (isSeedingEmptyCanvas) {
        await this.initializeEmptyGraph([]);
        await this.$nextTick();
      }

      const nodesBefore = new Set((this.g6Graph?.getNodeData() || []).map(n => n.id));
      const edgesBefore = new Set((this.g6Graph?.getEdgeData() || []).map(e => e.id));

      const queryResult = {
        rows: [[rawNode, ...rawRels]],
        dataTypes: ['NODE', ...rawRels.map(() => 'REL')],
      };
      await this.addDataWithQueryResult(queryResult);

      // Open the overview panel the first time a searched entity lands on the canvas
      if (!this.isSidePanelOpen) {
        this.$emit('requestSidebarToggle');
        this.$nextTick(() => {
          this.handleResize();
        });
      }

      const addedG6Id = encodeId(rawNode._id);
      const nodesAfter = this.g6Graph ? (this.g6Graph.getNodeData() || []) : [];
      const edgesAfter = this.g6Graph ? (this.g6Graph.getEdgeData() || []) : [];
      const addedNodes = nodesAfter.filter(n => !nodesBefore.has(n.id));
      const addedEdges = edgesAfter.filter(e => !edgesBefore.has(e.id));

      // Record for undo. Reuse the existing 'add-connected-node' command so the
      // established undo/redo path removes exactly these nodes/edges.
      if (addedNodes.length > 0 || addedEdges.length > 0) {
        this.historyManager.push({
          type: 'add-connected-node',
          data: {
            sourceNodeId: null,
            addedNodes: JSON.parse(JSON.stringify(addedNodes)),
            addedEdges: JSON.parse(JSON.stringify(addedEdges)),
          }
        });
      }

      // getNodeData(id) THROWS on an unknown id (graphlib), it does not return
      // null — same guard idiom as handleConnectedNodeClick.
      let newNode = null;
      try {
        newNode = this.g6Graph ? this.g6Graph.getNodeData(addedG6Id) : null;
      } catch (e) {
        newNode = null;
      }
      if (newNode) {
        await this.selectAndFocusNode(newNode);
      } else {
        console.warn('Pinned node was fetched but not found on the canvas:', addedG6Id);
      }
    },

    /**
     * The single node primary-key column, asserted uniform across ALL node
     * tables. The two-step find query projects one pk column that must be valid
     * for every node table (true for the Horkos schema: every table keys on
     * `id`). Returns the shared pk name, or null if the tables disagree or the
     * schema is unavailable — in which case the caller surfaces the error banner
     * rather than guessing a column.
     */
    uniformNodePrimaryKey() {
      const tables = this.schema?.nodeTables || [];
      if (tables.length === 0) {
        return null;
      }
      let pkName = null;
      for (const table of tables) {
        const pkProp = (table.properties || []).find(p => p.isPrimaryKey);
        if (!pkProp) {
          return null;
        }
        if (pkName === null) {
          pkName = pkProp.name;
        } else if (pkName !== pkProp.name) {
          // Node tables key on different columns — the single-column projection
          // is unsafe; bail so the caller shows the error banner.
          return null;
        }
      }
      return pkName;
    },

    /**
     * Find the shortest connection between two entities and lay it on the
     * canvas. Sole entry point is the node side-panel "Find connection to…"
     * picker; endpoints are { label, pk }.
     *
     * Runs the two-step PathFinder query (discovery then hydration), setting the
     * outcome banner (the sole outcome surface, no toast):
     *   - a path was found -> merge it additively, highlight + focus the whole
     *     path, banner the hop count, pre-fill the sidebar's save-view name,
     *     record undo;
     *   - no path within MAX_HOPS -> 'no-path' banner;
     *   - a query timeout (HTTP 408) -> 'timeout' banner;
     *   - any other query/network error -> 'error' banner (never masquerades as
     *     no-path).
     *
     * @param {{label:string, pk:*}} a  first endpoint
     * @param {{label:string, pk:*}} b  second endpoint
     */
    async handleFindConnection(a, b) {
      if (this.findConnectionInFlight) {
        return;
      }
      // Same-entity guard: nothing to connect. Input feedback (not an outcome),
      // so it stays a toast.
      if (a && b && a.label === b.label && String(a.pk) === String(b.pk)) {
        this.showToast("That's the same entity — pick a different one to connect to.", 4000);
        return;
      }
      // Both labels must be real node tables before we interpolate them (params
      // can't stand in for identifiers). Escaping in PathFinder keeps a stray
      // value inert, but an unknown label can't produce a path anyway. Input
      // feedback, so it stays a toast.
      const validLabels = this.getValidNodeLabels();
      if (!a || !b || !validLabels.has(a.label) || !validLabels.has(b.label)) {
        this.showToast("Couldn't find a connection: unknown entity type.", 5000);
        return;
      }
      // The two-step query projects a single pk column valid for every node
      // table; if the schema doesn't offer one, surface the error banner rather
      // than guessing.
      const pkName = this.uniformNodePrimaryKey();
      if (!pkName) {
        this.connectionResult = { status: 'error', hops: 0, endpoints: [a, b] };
        return;
      }

      this.findConnectionInFlight = true;
      // Close the picker as soon as a find starts so it doesn't hover over the
      // result.
      this.closeConnectionPicker();
      try {
        let result;
        try {
          result = await PathFinder.findShortestPath({
            labelA: a.label,
            pkNameA: this.primaryKeyNameForLabel(a.label),
            pkValueA: a.pk,
            labelB: b.label,
            pkNameB: this.primaryKeyNameForLabel(b.label),
            pkValueB: b.pk,
            pkName,
            nodeLabelSet: this.getValidNodeLabels(),
            relLabelSet: this.getValidEdgeLabels(),
            maxHops: MAX_HOPS,
            isWasm: this.modeStore.isWasm,
          });
        } catch (e) {
          // A DB / network error must never be reported as "no connection". A
          // 408 (query timeout) gets its own banner status; anything else is a
          // generic error. WASM has no query timeout, so it never yields 408.
          console.warn('Find-connection query failed:', e);
          const status = (e && e.response && e.response.status === 408)
            ? 'timeout'
            : 'error';
          this.connectionResult = { status, hops: 0, endpoints: [a, b] };
          return;
        }

        if (!result.found) {
          this.connectionResult = {
            status: 'no-path',
            hops: 0,
            endpoints: [a, b],
          };
          return;
        }

        await this.addPathToCanvas(result, a, b);
      } finally {
        this.findConnectionInFlight = false;
      }
    },

    /**
     * Merge a found path onto the canvas, highlight and focus it, banner the hop
     * count, record undo, and pre-fill the sidebar's save-view name so the path
     * can be saved in one click. The hydration row is plain NODE / REL columns
     * (n0, r0, n1, …) with full properties, which the existing graph extractor
     * already handles — so it flows through addDataWithQueryResult exactly like
     * any other result, additively.
     */
    async addPathToCanvas(result, a, b) {
      // Seed an empty canvas if no query has ever run (same idiom as the pin
      // navigation flow).
      const isSeedingEmptyCanvas = !this.g6Graph;
      if (isSeedingEmptyCanvas) {
        await this.initializeEmptyGraph([]);
        await this.$nextTick();
      }

      const nodesBefore = new Set((this.g6Graph?.getNodeData() || []).map(n => n.id));
      const edgesBefore = new Set((this.g6Graph?.getEdgeData() || []).map(e => e.id));

      // The hydration row is plain NODE / REL columns; the extractor keys on
      // dataTypes[column] === 'NODE' / 'REL' and materializes each directly.
      const queryResult = { rows: [result.row], dataTypes: result.dataTypes };
      await this.addDataWithQueryResult(queryResult);

      const nodesAfter = this.g6Graph ? (this.g6Graph.getNodeData() || []) : [];
      const edgesAfter = this.g6Graph ? (this.g6Graph.getEdgeData() || []) : [];
      const addedNodes = nodesAfter.filter(n => !nodesBefore.has(n.id));
      const addedEdges = edgesAfter.filter(e => !edgesBefore.has(e.id));

      // Record for undo. Reuse the established 'add-connected-node' command with
      // a null source so the existing undo/redo path removes exactly these.
      if (addedNodes.length > 0 || addedEdges.length > 0) {
        this.historyManager.push({
          type: 'add-connected-node',
          data: {
            sourceNodeId: null,
            addedNodes: JSON.parse(JSON.stringify(addedNodes)),
            addedEdges: JSON.parse(JSON.stringify(addedEdges)),
          }
        });
      }

      // Highlight the whole path (its nodes + edges) with the 'active' state and
      // focus the viewport on it. The path's element ids are the encoded ids of
      // its _nodes/_rels; some may already have been on the canvas, so resolve
      // against what is actually present. Reset every other element first so a
      // prior selection/highlight can't linger (same reset idiom the highlight-
      // mode toggles use).
      const pathIds = new Set(this.pathElementIds(result.row).filter(id => this.elementExists(id)));
      const combined = {};
      (this.g6Graph?.getNodeData() || []).forEach(n => {
        combined[n.id] = pathIds.has(n.id) ? ['active'] : [];
      });
      (this.g6Graph?.getEdgeData() || []).forEach(e => {
        combined[e.id] = pathIds.has(e.id) ? ['active'] : [];
      });
      await this.setElementState(combined);
      const presentIds = [...pathIds];
      if (presentIds.length > 0 && this.g6Graph) {
        try {
          // G6 v5 focusElement accepts an id array to frame multiple elements.
          await this.g6Graph.focusElement(presentIds);
        } catch (e) {
          console.warn('Could not focus the connection path:', e);
        }
      }
      // Clear the selected-node side panel: the whole path is the focus now, not
      // a single node (mirrors addDataWithQueryResult clearing clickedId).
      this.clickedId = null;

      this.connectionResult = {
        status: 'found',
        hops: result.hops,
        endpoints: [a, b],
      };
    },

    /**
     * Encoded G6 element ids of a hydration row's NODE / REL columns (n0, r0,
     * n1, …). Pure over the row so highlight/focus target exactly the path.
     */
    pathElementIds(row) {
      if (!row) return [];
      const ids = [];
      Object.keys(row).forEach(key => {
        const col = row[key];
        if (col && col._id) {
          ids.push(encodeId(col._id));
        }
      });
      return ids;
    },

    // getNodeData/getEdgeData THROW on an unknown id (graphlib) rather than
    // returning null, so probe existence defensively.
    elementExists(id) {
      if (!this.g6Graph) return false;
      try {
        return Boolean(this.g6Graph.getNodeData(id));
      } catch (e) {
        try {
          return Boolean(this.g6Graph.getEdgeData(id));
        } catch (e2) {
          return false;
        }
      }
    },

    dismissConnectionResult() {
      this.connectionResult = null;
    },

    // Pin/unpin the clicked node from the top action bar, keying the notebook
    // store the same way EntityPinPanel does. The pinnedKeySignature watcher
    // re-syncs the canvas star badges off the resulting store change.
    togglePinClickedNode() {
      if (!this.clickedPk) return;
      this.notebookStore.togglePin(this.clickedLabel, this.clickedPk, this.clickedDisplayName);
    },

    // ---- Node-panel "Find connection to…" picker -----------------------
    // The picker is seeded with the active notebook's pins (the entities the
    // user is already tracking) and a live entity search (same /api/suggest
    // affordance NodeSearch uses). Picking a target runs handleFindConnection
    // from the currently-selected node to that target.
    openConnectionPicker() {
      if (!this.clickedIsNode || !this.clickedId) return;
      this.showConnectionPicker = true;
      this.connectionSearchQuery = "";
      this.connectionSearchResults = [];
      // Default the search entity-type to the clicked node's type so the most
      // likely target is one keystroke away.
      if (this.getValidNodeLabels().has(this.clickedLabel)) {
        this.connectionSearchType = this.clickedLabel;
      }
      // Esc / click-away dismissal (deferred so the opening click doesn't
      // immediately count as a click-away).
      this.$nextTick(() => {
        document.addEventListener("keydown", this.onConnectionPickerKeydown);
        document.addEventListener("mousedown", this.onConnectionPickerClickAway, true);
      });
    },
    closeConnectionPicker() {
      this.showConnectionPicker = false;
      document.removeEventListener("keydown", this.onConnectionPickerKeydown);
      document.removeEventListener("mousedown", this.onConnectionPickerClickAway, true);
      if (this.connectionSearchTimer) {
        window.clearTimeout(this.connectionSearchTimer);
        this.connectionSearchTimer = null;
      }
    },
    onConnectionPickerKeydown(e) {
      if (e.key === "Escape") {
        this.closeConnectionPicker();
      }
    },
    onConnectionPickerClickAway(e) {
      const el = this.$refs.connectionPicker;
      // Ignore clicks inside the picker; anything else closes it. The
      // "Find connection to…" button lives outside the picker, so re-clicking
      // it after a click-away close re-opens cleanly.
      if (el && !el.contains(e.target)) {
        this.closeConnectionPicker();
      }
    },
    // The clicked node as an endpoint { label, pk } — the fixed first end of
    // every find started from the picker. Reads the RAW pk off the live node
    // data (same source getInfoForExpansion uses for queries), not the
    // display-beautified clickedProperties, so the value binds correctly.
    clickedEndpoint() {
      let pk = null;
      try {
        const nodeData = this.g6Graph ? this.g6Graph.getNodeData(this.clickedId) : null;
        const props = nodeData && nodeData.data && nodeData.data.properties;
        const pkName = this.primaryKeyNameForLabel(this.clickedLabel);
        if (props && pkName) {
          pk = props[pkName];
        }
      } catch (e) {
        pk = null;
      }
      return { label: this.clickedLabel, pk, name: this.entityDisplayName };
    },
    // Notebook pins offered as connection targets, excluding the clicked node
    // itself (you can't connect an entity to itself).
    connectionPinTargets() {
      const self = this.clickedEndpoint();
      return this.notebookStore.pinnedEntities
        .filter(
          pin => !(pin.label === self.label && String(pin.pk) === String(self.pk))
        )
        .map(pin => ({ label: pin.label, pk: pin.pk, name: pin.name || pin.pk }));
    },
    onConnectionSearchInput() {
      if (this.connectionSearchTimer) {
        window.clearTimeout(this.connectionSearchTimer);
      }
      const q = (this.connectionSearchQuery || "").trim();
      if (q.length < 2) {
        this.connectionSearchResults = [];
        return;
      }
      this.connectionSearchTimer = window.setTimeout(() => {
        this.fetchConnectionSearch(q);
      }, 250);
    },
    async fetchConnectionSearch(query) {
      const requestId = ++this.connectionSearchRequestId;
      try {
        const response = await Axios.get("/api/suggest", {
          params: { q: query, type: this.connectionSearchType, limit: 10 },
        });
        // Ignore stale responses so a slower earlier request can't clobber a
        // newer one (same guard NodeSearch uses).
        if (requestId !== this.connectionSearchRequestId) return;
        this.connectionSearchResults = (response.data || [])
          .filter(item => item.cluster_id)
          .map(item => ({
            label: this.connectionSearchType,
            pk: item.cluster_id,
            name: item.name || item.cluster_id,
          }));
      } catch (e) {
        if (requestId !== this.connectionSearchRequestId) return;
        // 404 => the autocomplete endpoint isn't configured; hide the search and
        // fall back to pins only.
        if (e.response && e.response.status === 404) {
          this.connectionSearchUnavailable = true;
        }
        this.connectionSearchResults = [];
      }
    },
    pickConnectionTarget(target) {
      const self = this.clickedEndpoint();
      if (self.pk == null) {
        this.showToast("Couldn't identify the selected entity.", 4000);
        return;
      }
      this.handleFindConnection(self, target);
    },

    /**
     * Group the nodes currently on the canvas by their (table, primary-key
     * column) so a batched rel fetch can bind one pk list per distinct table.
     * Returns [{ table, primaryKeyName, primaryKeyValues }].
     */
    groupCanvasNodesByTable() {
      const byTable = {};
      (this.g6Graph?.getNodeData() || []).forEach((node) => {
        const props = node.data && node.data.properties;
        if (!props || !props._label) return;
        const table = props._label;
        const pkName = this.primaryKeyNameForLabel(table);
        const pkValue = props[pkName];
        if (pkValue === undefined || pkValue === null) return;
        if (!byTable[table]) {
          byTable[table] = { table, primaryKeyName: pkName, primaryKeyValues: [] };
        }
        byTable[table].primaryKeyValues.push(pkValue);
      });
      return Object.values(byTable);
    },

    /**
     * Save the current canvas as a named view in the investigation log. Reuses
     * the existing share serializer so a saved view stores the same compact,
     * refetch-on-restore representation as a share code (positions + label/pk +
     * hidden set), never raw entity properties.
     */
    handleSaveCurrentView(name) {
      const trimmed = (name || '').trim();
      if (!trimmed) return false;
      const state = this.getInvestigationState();
      if (!state.graphData || !state.graphData.nodes || state.graphData.nodes.length === 0) {
        this.showToast('Nothing to save — the graph is empty.', 4000);
        return false;
      }
      const { code } = generateExportCode(state);
      const saved = this.notebookStore.saveView(trimmed, code);
      if (saved) {
        this.showToast(`Saved view "${trimmed}".`, 3000);
      }
      // Report whether a view was actually written, so the notebook sidebar
      // can keep its typed name on failure instead of silently clearing it.
      return Boolean(saved);
    },

    /**
     * Restore a saved view onto the canvas. The stored state is a share code;
     * parse it back to the minimal shape and run the existing restore flow,
     * which refetches full properties from the database.
     */
    async handleRestoreSavedView(view) {
      if (!view || !view.state) return;
      const parsed = parseExportCode(view.state);
      if (!parsed) {
        this.showToast('Could not restore this view (it may be corrupted).', 5000);
        return;
      }
      await this.restoreInvestigationState(parsed);
    },


    /**
     * Restore graph from a shared investigation link.
     * Refetches full node/edge properties from database using label+pk, then rebuilds the graph.
     */
    async restoreInvestigationState(state) {
      if (!state) return;

      await this.$nextTick();

      if (!state.minimalNodes || state.minimalNodes.length === 0) {
        this.showToast('Import failed: no node data found in export code', 5000);
        return;
      }

      const nodePropsMap = await this.refetchNodeProperties(state.minimalNodes);
      const edgePropsMap = await this.refetchEdgeProperties(state.minimalEdges);

      // Build G6 nodes from refetched data + saved positions
      const nodes = [];

      state.minimalNodes.forEach(minNode => {
        if (!minNode.pk) return;

        const rawNode = nodePropsMap[minNode.pk];
        if (!rawNode) {
          console.warn('[ResultGraph] Could not refetch node:', minNode.pk);
          return;
        }

        const g6Id = encodeId(rawNode._id);

        const formattedLabel = formatNodeLabel(rawNode, this.schema, this.settingsStore);
        const g6Node = buildG6Node(g6Id, rawNode, this.settingsStore, {
          x: minNode.x,
          y: minNode.y,
          fx: minNode.x,
          fy: minNode.y,
          formattedLabel,
          rawProperties: rawNode,
        });

        if (g6Node) nodes.push(g6Node);
      });

      // Build G6 edges from refetched data
      const edges = [];
      const edgeCountBetweenNodes = {};

      state.minimalEdges.forEach(minEdge => {
        if (!minEdge.pk) return;

        const rawRel = edgePropsMap[minEdge.pk];
        if (!rawRel) {
          console.warn('[ResultGraph] Could not refetch edge:', minEdge.pk);
          return;
        }

        const edgeG6Id = encodeId(rawRel._id);

        const srcG6Id = encodeId(rawRel._src);
        const tgtG6Id = encodeId(rawRel._dst);

        const pairKey = [srcG6Id, tgtG6Id].sort().join('|');
        edgeCountBetweenNodes[pairKey] = (edgeCountBetweenNodes[pairKey] || 0) + 1;
        const overlapIndex = edgeCountBetweenNodes[pairKey];

        const g6Edge = buildG6Edge(
          edgeG6Id,
          srcG6Id,
          tgtG6Id,
          rawRel,
          this.settingsStore,
          this.schema,
          { overlapIndex }
        );

        if (g6Edge) edges.push(g6Edge);
      });

      // Initialize graph and load data
      if (!this.g6Graph) {
        await this.initializeEmptyGraph(edges);
        await this.$nextTick();
      }

      if (this.g6Graph) {
        this.g6Graph.clear();
        this.g6Graph.addData({ nodes, edges });
        await this.render();
        this.calculateCountersFromGraphData({ nodes, edges });
      } else {
        this.showToast('Import failed: could not initialize graph', 5000);
        return;
      }

      // Show success feedback
      if (nodes.length > 0 || edges.length > 0) {
        const skippedNodes = state.minimalNodes.filter(n => n.pk).length - nodes.length;
        const skippedEdges = state.minimalEdges.filter(e => e.pk).length - edges.length;
        const parts = [];
        if (nodes.length > 0) parts.push(`${nodes.length} nodes`);
        if (edges.length > 0) parts.push(`${edges.length} edges`);

        if (skippedNodes > 0 || skippedEdges > 0) {
          const skippedParts = [];
          if (skippedNodes > 0) skippedParts.push(`${skippedNodes} nodes`);
          if (skippedEdges > 0) skippedParts.push(`${skippedEdges} edges`);
          this.showToast(`Restored ${parts.join(', ')} (${skippedParts.join(', ')} not found)`, 5000);
        } else {
          this.showToast(`Successfully restored ${parts.join(' and ')}`, 3000);
        }
      } else if (state.minimalNodes.length > 0) {
        this.showToast('Import failed: none of the elements could be found in the database', 5000);
      }

      // Resize and fit
      this.$nextTick(() => {
        this.updateNeighborCounts();
        this.syncPinBadges();
      });

      await this.$nextTick();
      this.handleResize();
      await this.$nextTick();
      this.fitToView();
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

    getValidNodeLabels() {
      if (!this.schema || !this.schema.nodeTables) {
        return new Set();
      }
      return new Set(this.schema.nodeTables.map(t => t.name));
    },

    getValidEdgeLabels() {
      if (!this.schema || !this.schema.relTables) {
        return new Set();
      }
      return new Set(this.schema.relTables.map(t => t.name));
    },

    /**
     * Refetch node properties from database. Returns map of pk -> node data.
     *
     * By default query failures are swallowed (logged and treated as "no rows")
     * so bulk restore keeps going past one bad label. Callers that must tell a
     * transient fetch ERROR apart from a genuine empty result (e.g. pin
     * navigation's "no longer in this database" path) pass
     * `rethrowQueryErrors: true` to have the failure propagate instead.
     *
     * By contract this queries and keys on the `id` column, not the table's
     * declared primary key — every Horkos node table keys on `id`. Callers
     * supporting non-`id`-keyed tables must not rely on this method.
     */
    async refetchNodeProperties(minimalNodes, { rethrowQueryErrors = false } = {}) {
      if (!minimalNodes || minimalNodes.length === 0) {
        return {};
      }

      const validLabels = this.getValidNodeLabels();
      const nodesByLabel = {};
      let skippedInvalidLabels = 0;

      minimalNodes.forEach(node => {
        if (!node.label || !node.pk) return;
        if (!validLabels.has(node.label)) {
          skippedInvalidLabels++;
          return;
        }
        if (!nodesByLabel[node.label]) nodesByLabel[node.label] = [];
        nodesByLabel[node.label].push(node.pk);
      });

      if (skippedInvalidLabels > 0) {
        this.showToast(`Skipped ${skippedInvalidLabels} nodes with invalid labels`, 4000);
      }

      const results = {};
      for (const [label, pks] of Object.entries(nodesByLabel)) {
        // pks are attacker-supplied (share code). Bind them as a LIST parameter
        // instead of string-building the IN list, so a hostile pk (e.g. one with
        // a trailing backslash defeating a quote-only escape) cannot break out
        // into injected Cypher. `label` is NOT parameterizable (it's a table
        // identifier), but it is already allowlisted against the DB schema above
        // via validLabels.has(node.label), so interpolating it is safe.
        const query = `MATCH (n:${label}) WHERE n.id IN $pkList RETURN n`;
        const queryParams = { pkList: pks };

        try {
          let response;
          if (this.modeStore.isWasm) {
            const Kuzu = (await import('@/utils/KuzuWasm')).default;
            response = await Kuzu.query(query, queryParams);
          } else {
            const res = await Axios.post('/api/cypher', { query, params: queryParams, updateHistory: false });
            response = res.data;
          }
          if (response?.rows) {
            response.rows.forEach(row => {
              if (row.n?.id) results[row.n.id] = row.n;
            });
          }
        } catch (error) {
          console.warn('[ResultGraph] Failed to refetch nodes for label:', label, error);
          if (rethrowQueryErrors) {
            throw error;
          }
        }
      }
      return results;
    },

    /**
     * Refetch edge properties from database. Returns map of pk -> edge data.
     */
    async refetchEdgeProperties(minimalEdges) {
      if (!minimalEdges || minimalEdges.length === 0) {
        return {};
      }

      const validLabels = this.getValidEdgeLabels();
      const edgesByLabel = {};
      let skippedInvalidLabels = 0;

      minimalEdges.forEach(edge => {
        if (!edge.label || !edge.pk) return;
        if (!validLabels.has(edge.label)) {
          skippedInvalidLabels++;
          return;
        }
        if (!edgesByLabel[edge.label]) edgesByLabel[edge.label] = [];
        edgesByLabel[edge.label].push(edge.pk);
      });

      if (skippedInvalidLabels > 0) {
        this.showToast(`Skipped ${skippedInvalidLabels} edges with invalid labels`, 4000);
      }

      const results = {};
      for (const [label, pks] of Object.entries(edgesByLabel)) {
        // pks are attacker-supplied (share code). Bind them as a LIST parameter
        // instead of string-building the IN list, so a hostile pk cannot break
        // out into injected Cypher. `label` is a rel-table identifier and cannot
        // be parameterized, but it is already allowlisted against the DB schema
        // above via validLabels.has(edge.label), so interpolating it is safe.
        const query = `MATCH ()-[r:${label}]->() WHERE r.id IN $pkList RETURN r`;
        const queryParams = { pkList: pks };

        try {
          let response;
          if (this.modeStore.isWasm) {
            const Kuzu = (await import('@/utils/KuzuWasm')).default;
            response = await Kuzu.query(query, queryParams);
          } else {
            const res = await Axios.post('/api/cypher', { query, params: queryParams, updateHistory: false });
            response = res.data;
          }
          if (response?.rows) {
            response.rows.forEach(row => {
              if (row.r?.id) results[row.r.id] = row.r;
            });
          }
        } catch (error) {
          console.warn('[ResultGraph] Failed to refetch edges for label:', label, error);
        }
      }
      return results;
    },

    // ========== Undo/Redo Methods ==========

    /**
     * Undo the last graph action.
     */
    async undo() {
      if (this.isUndoRedoInProgress) return;
      const cmd = this.historyManager.undo();
      if (!cmd) return;

      this.isUndoRedoInProgress = true;
      try {
        switch (cmd.type) {
          case 'layout':
            await this.applyLayoutInternal(cmd.data.from);
            break;
          case 'expand':
            await this.undoExpand(cmd.data);
            break;
          case 'expandGraph':
            await this.undoExpandGraph(cmd.data);
            break;
          case 'collapse':
            await this.undoCollapse(cmd.data);
            break;
          case 'remove':
            await this.undoRemove(cmd.data);
            break;
          case 'add-connected-node':
            await this.undoAddConnectedNode(cmd.data);
            break;
        }
      } catch (e) {
        // Reverse the stack operation on failure
        this.historyManager.redoStack.pop();
        this.historyManager.undoStack.push(cmd);
        console.error('Undo failed:', e);
      } finally {
        this.isUndoRedoInProgress = false;
      }
    },

    /**
     * Redo the last undone graph action.
     */
    async redo() {
      if (this.isUndoRedoInProgress) return;
      const cmd = this.historyManager.redo();
      if (!cmd) return;

      this.isUndoRedoInProgress = true;
      try {
        switch (cmd.type) {
          case 'layout':
            await this.applyLayoutInternal(cmd.data.to);
            break;
          case 'expand':
            await this.redoExpand(cmd.data);
            break;
          case 'expandGraph':
            await this.redoExpandGraph(cmd.data);
            break;
          case 'collapse':
            await this.redoCollapse(cmd.data);
            break;
          case 'remove':
            await this.redoRemove(cmd.data);
            break;
          case 'add-connected-node':
            await this.redoAddConnectedNode(cmd.data);
            break;
        }
      } catch (e) {
        // Reverse the stack operation on failure
        this.historyManager.undoStack.pop();
        this.historyManager.redoStack.push(cmd);
        console.error('Redo failed:', e);
      } finally {
        this.isUndoRedoInProgress = false;
      }
    },

    /**
     * Undo expand = remove the expansion
     */
    async undoExpand(data) {
      const nodeIdsToRemove = new Set(data.addedNodes.map(n => n.id));
      const edgeIdsToRemove = new Set(data.addedEdges.map(e => e.id));

      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);
      this.expansions = this.expansions.filter(e => e.id !== data.sourceNodeId);

      Object.keys(data.nodeIntroducedByEntries || {}).forEach(nodeId => {
        delete this.nodeIntroducedBy[nodeId];
      });

      if (data.sourceNodeId === this.clickedId) {
        this.isCurrentNodeExpanded = false;
      }
      this.$nextTick(() => this.updateNeighborCounts());
    },

    /**
     * Redo expand = restore the expansion
     */
    async redoExpand(data) {
      await this.restoreNodesAndEdges(data.addedNodes, data.addedEdges);
      this.expansions.push(data.expansionEntry);
      Object.assign(this.nodeIntroducedBy, data.nodeIntroducedByEntries || {});

      if (data.sourceNodeId === this.clickedId) {
        this.isCurrentNodeExpanded = true;
      }
      this.$nextTick(() => this.updateNeighborCounts());
    },

    /**
     * Undo expandGraph = remove all nodes/edges added by batch expansion
     */
    async undoExpandGraph(data) {
      const nodeIdsToRemove = new Set(data.addedNodes.map(n => n.id));
      const edgeIdsToRemove = new Set(data.addedEdges.map(e => e.id));

      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);

      // Remove all expansion entries
      const expIdsToRemove = new Set(data.expansionEntries.map(e => e.id));
      this.expansions = this.expansions.filter(e => !expIdsToRemove.has(e.id));

      // Clean up nodeIntroducedBy
      Object.keys(data.nodeIntroducedByEntries || {}).forEach(nodeId => {
        delete this.nodeIntroducedBy[nodeId];
      });

      this.$nextTick(() => this.updateNeighborCounts());
    },

    /**
     * Redo expandGraph = restore all nodes/edges from batch expansion
     */
    async redoExpandGraph(data) {
      await this.restoreNodesAndEdges(data.addedNodes, data.addedEdges);

      // Restore all expansion entries
      data.expansionEntries.forEach(exp => this.expansions.push(exp));
      Object.assign(this.nodeIntroducedBy, data.nodeIntroducedByEntries || {});

      this.$nextTick(() => this.updateNeighborCounts());
    },

    /**
     * Undo collapse = restore removed nodes/edges
     */
    async undoCollapse(data) {
      await this.restoreNodesAndEdges(data.removedNodes, data.removedEdges);

      // Restore expansions in order
      data.removedExpansions.forEach(exp => this.expansions.push(exp));
      Object.assign(this.nodeIntroducedBy, data.removedNodeIntroducedBy || {});

      if (data.sourceNodeId === this.clickedId) {
        this.isCurrentNodeExpanded = true;
      }
      this.$nextTick(() => this.updateNeighborCounts());
    },

    /**
     * Redo collapse = remove nodes/edges again
     */
    async redoCollapse(data) {
      const nodeIdsToRemove = new Set(data.removedNodes.map(n => n.id));
      const edgeIdsToRemove = new Set(data.removedEdges.map(e => e.id));

      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);

      // Remove expansions
      const expIdsToRemove = new Set(data.removedExpansions.map(e => e.id));
      this.expansions = this.expansions.filter(e => !expIdsToRemove.has(e.id));

      Object.keys(data.removedNodeIntroducedBy || {}).forEach(nodeId => {
        delete this.nodeIntroducedBy[nodeId];
      });

      if (data.sourceNodeId === this.clickedId) {
        this.isCurrentNodeExpanded = false;
      }
      this.$nextTick(() => this.updateNeighborCounts());
    },

    /**
     * Undo remove = restore removed node/edges and their tracking
     */
    async undoRemove(data) {
      await this.restoreNodesAndEdges(data.removedNodes, data.removedEdges);

      (data.removedExpansions || []).forEach(exp => this.expansions.push(exp));
      Object.assign(this.nodeIntroducedBy, data.removedNodeIntroducedBy || {});

      this.$nextTick(() => {
        this.$refs.connectedEntitiesPanel?.refreshInGraphStatus();
        this.updateNeighborCounts();
      });
    },

    /**
     * Redo remove = remove the node/edges again
     */
    async redoRemove(data) {
      const nodeIdsToRemove = new Set(data.removedNodes.map(n => n.id));
      const edgeIdsToRemove = new Set(data.removedEdges.map(e => e.id));

      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);

      const expIdsToRemove = new Set((data.removedExpansions || []).map(e => e.id));
      this.expansions = this.expansions.filter(e => !expIdsToRemove.has(e.id));

      Object.keys(data.removedNodeIntroducedBy || {}).forEach(nodeId => {
        delete this.nodeIntroducedBy[nodeId];
      });

      this.$nextTick(() => {
        this.$refs.connectedEntitiesPanel?.refreshInGraphStatus();
        this.updateNeighborCounts();
      });
    },

    async undoAddConnectedNode(data) {
      const nodeIdsToRemove = new Set(data.addedNodes.map(n => n.id));
      const edgeIdsToRemove = new Set(data.addedEdges.map(e => e.id));

      nodeIdsToRemove.forEach(nodeId => {
        delete this.neighborCounts[nodeId];
        this.neighborCountsLoading.delete(nodeId);
      });
      if (data.sourceNodeId) {
        delete this.neighborCounts[data.sourceNodeId];
        this.neighborCountsLoading.delete(data.sourceNodeId);
      }

      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);

      this.$nextTick(() => {
        this.$refs.connectedEntitiesPanel?.refreshInGraphStatus();
        this.updateNeighborCounts();
      });
    },

    /**
     * Unlike restoreNodesAndEdges, don't pin restored nodes so layout positions them naturally
     */
    async redoAddConnectedNode(data) {
      if (data.sourceNodeId) {
        delete this.neighborCounts[data.sourceNodeId];
        this.neighborCountsLoading.delete(data.sourceNodeId);
      }

      const currentNodes = this.g6Graph.getNodeData() || [];
      const currentEdges = this.g6Graph.getEdgeData() || [];

      const pinnedExisting = currentNodes.map(node => ({
        ...node,
        data: { ...node.data, fx: node.style?.x, fy: node.style?.y }
      }));

      const restoredNodes = data.addedNodes.map(node => ({
        ...node,
        data: { ...node.data, fx: undefined, fy: undefined },
        style: { ...node.style, x: undefined, y: undefined }
      }));

      data.addedNodes.forEach(node => {
        const label = node.data?.properties?._label;
        if (label) {
          this.counters.node[label] = (this.counters.node[label] || 0) + 1;
          this.counters.total.node += 1;
        }
      });
      data.addedEdges.forEach(edge => {
        const label = edge.data?.properties?._label;
        if (label) {
          this.counters.rel[label] = (this.counters.rel[label] || 0) + 1;
          this.counters.total.rel += 1;
        }
      });

      const newData = {
        nodes: pinnedExisting.concat(restoredNodes),
        edges: currentEdges.concat(data.addedEdges),
      };

      this.g6Graph.setData(newData);
      await this.render();

      this.$nextTick(() => {
        this.$refs.connectedEntitiesPanel?.refreshInGraphStatus();
        this.updateNeighborCounts();
        this.syncPinBadges();
      });
    },

    /**
     * Shared helper to restore nodes and edges.
     * Used by undo collapse and redo expand.
     */
    async restoreNodesAndEdges(nodesToRestore, edgesToRestore) {
      const currentNodes = this.g6Graph.getNodeData() || [];
      const currentEdges = this.g6Graph.getEdgeData() || [];

      // Pin existing nodes
      const pinnedExisting = currentNodes.map(node => ({
        ...node,
        data: { ...node.data, fx: node.style?.x, fy: node.style?.y }
      }));

      // Restore with saved positions
      const restoredNodes = nodesToRestore.map(node => ({
        ...node,
        data: { ...node.data, fx: node.style?.x, fy: node.style?.y }
      }));

      // Update counters
      nodesToRestore.forEach(node => {
        const label = node.data?.properties?._label;
        if (label) {
          this.counters.node[label] = (this.counters.node[label] || 0) + 1;
          this.counters.total.node += 1;
        }
      });
      edgesToRestore.forEach(edge => {
        const label = edge.data?.properties?._label;
        if (label) {
          this.counters.rel[label] = (this.counters.rel[label] || 0) + 1;
          this.counters.total.rel += 1;
        }
      });

      const newData = {
        nodes: pinnedExisting.concat(restoredNodes),
        edges: currentEdges.concat(edgesToRestore),
      };

      this.g6Graph.setData(newData);
      await this.render();
      this.syncPinBadges();
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

    .result-graph__clear-confirm {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--bs-danger, #e15759);
      border-radius: 0.375rem;
      background-color: var(--bs-body-bg);
    }

    .result-graph__clear-confirm-msg {
      font-size: 0.8rem;
      line-height: 1.35;
      color: var(--bs-body-text);
    }

    .result-graph__clear-confirm-actions {
      display: flex;
      gap: 0.35rem;

      .btn {
        flex: 1;
        white-space: nowrap;
      }
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

        th,
        td {
          vertical-align: middle;
        }

        // Counts read as a column: right-aligned, digits in tabular figures so
        // rows line up against the variable-width label badges.
        td {
          width: 120px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      }

      scrollbar-width: none;
      scrollbar-color: transparent transparent;
    }

    .result-graph__entity-header {
      .entity-header-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;

        .entity-header-name {
          margin: 0;
          font-size: 1.05rem;
          font-weight: 600;
          color: var(--bs-body-text);
          word-break: break-word;
        }

        .entity-header-type-badge {
          flex-shrink: 0;
          font-size: 0.75rem;
          padding: 0.3rem 0.6rem;
        }
      }

    }

    .result-graph__provenance-section {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--bs-body-inactive);

      h6 {
        font-size: 0.9rem;
        font-weight: 600;
        margin-bottom: 0.75rem;
        color: var(--bs-body-text);
      }
    }

    .result-graph__properties-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
      padding: 1rem 0 0.25rem;
      border-top: 1px solid var(--bs-body-inactive);
      cursor: pointer;

      &:hover {
        opacity: 0.8;
      }

      > i {
        font-size: 0.7rem;
        width: 12px;
        text-align: center;
        color: var(--bs-body-inactive);
      }

      h6 {
        font-size: 0.9rem;
        font-weight: 600;
        margin: 0;
        color: var(--bs-body-text);
      }
    }

    .result-graph__properties-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 0.5rem;
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

    // Destructive triggers stay as quiet as their neutral siblings and only
    // adopt the danger colour once the pointer/focus reaches them. The double
    // class out-specifies the shared button:hover rule above.
    .btn.result-graph__clear-btn {
      &:hover,
      &:focus-visible {
        color: var(--bs-danger, #e15759);
        background-color: rgba(var(--bs-danger-rgb, 225, 87, 89), 0.08);
      }
    }

    button.btn-outline-primary {
      background-color: var(--bs-body-bg-accent);
      color: white;

      &:hover {
        background-color: var(--bs-body-bg-accent);
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

  // Undo/Redo Controls
  .result-graph__controls {
    position: absolute;
    top: 1rem;
    // right is set dynamically via :style binding
    display: flex;
    gap: 0.25rem;
    z-index: 1;  // Lower than sidebar (z-index: 2)
  }

  .result-graph__control-btn {
    background-color: var(--bs-body-bg-secondary);
    border: 1px solid var(--bs-body-inactive);
    border-radius: 0.375rem;
    padding: 0.5rem;
    cursor: pointer;
    color: var(--bs-body-text);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    transition: background-color 0.15s ease, opacity 0.15s ease;

    &:hover:not(:disabled) {
      background-color: var(--bs-body-bg-hover);
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
    }

    i {
      font-size: 0.875rem;
    }
  }
}

// ---- Find-connection picker (node side panel) --------------------------
.result-graph__connection-picker {
  margin: 0.5rem 0 0.75rem;
  padding: 0.5rem;
  border: 1px solid var(--bs-body-bg-accent);
  border-radius: 0.375rem;
  background-color: var(--bs-body-bg-secondary);

  .connection-picker__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 0.4rem;
    color: var(--bs-body-text);
  }

  .connection-picker__close {
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.1rem 0.25rem;
    border-radius: 0.25rem;

    &:hover {
      background-color: var(--bs-body-bg-hover);
      color: var(--bs-body-text);
    }
  }

  .connection-picker__section + .connection-picker__section {
    margin-top: 0.5rem;
  }

  .connection-picker__section-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--bs-body-text-secondary);
    margin-bottom: 0.25rem;
  }

  .connection-picker__search-row {
    display: flex;
    gap: 0.35rem;
  }

  .connection-picker__type {
    max-width: 8rem;
    flex: 0 0 auto;
  }

  .connection-picker__list {
    list-style: none;
    margin: 0.35rem 0 0;
    padding: 0;
    max-height: 12rem;
    overflow-y: auto;
  }

  .connection-picker__item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 0.3rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.8rem;
    color: var(--bs-body-text);
    cursor: pointer;

    &:hover {
      background-color: var(--bs-body-bg-hover);
    }
  }

  .connection-picker__item-type {
    display: inline-block;
    font-size: 0.65rem;
    text-transform: uppercase;
    color: var(--bs-body-text-secondary);
    margin-right: 0.35rem;
  }

  .connection-picker__empty {
    font-size: 0.75rem;
    color: var(--bs-body-text-secondary);
    margin: 0.25rem 0 0;
  }
}

// ---- Connection-result action bar --------------------------------------
.result-graph__connection-result {
  position: absolute;
  top: 4.25rem; // sits just below the info toast
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 400px;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--bs-body-bg-accent);
  border-radius: 0.375rem;
  background-color: var(--bs-body-bg-secondary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);

  .connection-result__body {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--bs-body-text);

    i {
      color: var(--bs-body-bg-accent);
    }
  }

  .connection-result__actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .connection-result__close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.125rem;
    border-radius: 0.25rem;

    &:hover {
      background-color: var(--bs-body-bg-hover);
      color: var(--bs-body-text);
    }
  }
}
</style>
