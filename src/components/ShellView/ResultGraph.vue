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
        <button
          class="result-graph__sidebar-button--close"
          @click="toggleSidePanel"
        >
          <i class="fa-solid fa-times" />
        </button>

        <!-- Share Investigation Button - Always Visible -->
        <div
          v-if="queryInfo && queryInfo.query"
          class="result-graph__share-section"
        >
          <button
            class="btn btn-sm btn-primary w-100"
            @click="generateShareUrl()"
          >
            <i class="fa-solid fa-share-nodes" />
            Share Investigation
          </button>
        </div>

        <div
          v-if="clickedIsNode"
          class="result-graph__actions"
        >
          <h5>Actions</h5>
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
            Expand Neighbors
          </button>

          <button
            v-else
            class="btn btn-sm btn-outline-primary"
            @click="collapseSelectedNode()"
          >
            <i class="fa-solid fa-up-down-left-right" />
            Collapse Neighbors
          </button>
        </div>

        <!-- Neighbor Count Info -->
        <div
          v-if="clickedIsNode && currentNodeNeighborInfo && currentNodeNeighborInfo.hasCount"
          class="result-graph__neighbor-info"
        >
          <div class="neighbor-info-row">
            <span class="neighbor-info-label">
              <i class="fa-solid fa-diagram-project" /> Connections
            </span>
            <span
              class="neighbor-info-value"
              :class="{ 'neighbor-info-value--profligate': currentNodeNeighborInfo.isProfligate }"
            >
              {{ currentNodeNeighborInfo.count }} new
              <i
                v-if="currentNodeNeighborInfo.isProfligate"
                class="fa-solid fa-triangle-exclamation"
                title="High connectivity (>10 connections)"
              />
            </span>
          </div>
        </div>

        <br>
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
          <div
            v-if="clickedIsNode && externalLinks.length > 0"
            class="result-graph__external-links"
          >
            <h6>External Resources</h6>
            <div class="result-graph__links-grid">
              <a
                v-for="link in externalLinks"
                :key="link.label"
                :href="link.url"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-sm btn-outline-secondary result-graph__external-link"
              >
                <i :class="link.icon" /> {{ link.label }}
              </a>
            </div>
          </div>

          <!-- Source Provenance -->
          <div
            v-if="clickedIsNode && sourceRecords.length > 0"
            class="result-graph__source-provenance"
          >
            <h6>Data Sources</h6>
            <div class="result-graph__source-badges">
              <span
                v-for="source in sourceRecords"
                :key="source.id"
                class="badge result-graph__source-badge"
                :style="{
                  '--badge-bg-color': source.color,
                }"
              >
                {{ source.label }}
              </span>
            </div>
          </div>
        </div>
        <div v-else>
          <h5>Overview</h5>

          <div v-if="counters.total.node > 0">
            <div class="result-graph__summary-section">
              <p>
                Showing
                <span v-if="numHiddenNodes > 0">
                  {{ counters.total.node - numHiddenNodes }}/</span>{{ counters.total.node }} nodes
                <span v-if="numHiddenNodes > 0"> ({{ numHiddenNodes }} hidden) </span>
              </p>
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
            <hr>
            <table class="table table-sm table-borderless result-graph__overview-table">
              <tbody>
                <tr
                  v-for="label in Object.keys(counters.node)"
                  :key="label"
                >
                  <th scope="row">
                    <span
                      class="badge bg-primary"
                      :style="{ backgroundColor: ` ${getColor(label)} !important`, textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000', color: 'white !important' }"
                    >{{
                      label
                    }}</span>
                  </th>
                  <td>{{ counters.node[label] }}</td>
                </tr>
              </tbody>
            </table>
            <br>
          </div>

          <div v-if="counters.total.rel > 0">
            <p>
              Showing
              <span v-if="numHiddenRels > 0">
                {{ counters.total.rel - numHiddenRels }}/</span>{{ counters.total.rel }} rels
              <span v-if="numHiddenRels > 0"> ({{ numHiddenRels }} hidden) </span>
            </p>
            <hr>
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
                        backgroundColor: ` ${getColor(label)} !important`,
                        color: 'white !important',
                        textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                      }"
                    >
                      {{ label }}
                    </span>
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
    <div
      v-if="toastMessage"
      class="result-graph__toast"
      :style="{ right: (isSidePanelOpen ? sidebarWidth + 16 : 16) + 'px' }"
    >
      <div class="toast-content">
        <i class="fa-solid fa-info-circle" />
        <span>{{ toastMessage }}</span>
      </div>
      <button
        class="toast-close"
        @click="dismissToast"
      >
        <i class="fa-solid fa-times" />
      </button>
    </div>

    <!-- Share Investigation Modal -->
    <div
      v-if="shareModalVisible"
      class="result-graph__share-modal"
      @click.self="closeShareModal"
    >
      <div class="share-modal-content">
        <div class="share-modal-header">
          <h5>Share Investigation</h5>
          <button
            class="btn-close"
            @click="closeShareModal"
          >
            <i class="fa-solid fa-times" />
          </button>
        </div>

        <div class="share-modal-body">
          <p class="share-modal-description">
            Copy this URL to share your investigation. It includes all queries, expanded nodes, and hidden elements.
          </p>

          <!-- URL Size Warning -->
          <div
            v-if="shareUrlTooLarge"
            class="alert alert-warning"
          >
            <i class="fa-solid fa-triangle-exclamation" />
            <strong>Warning:</strong> This URL is very long ({{ shareUrlLength }} chars).
            Some browsers may not support URLs longer than 2000 characters.
          </div>

          <!-- Shareable URL -->
          <div class="share-url-container">
            <input
              ref="shareUrlInput"
              v-model="shareUrl"
              type="text"
              class="form-control"
              readonly
              @focus="$event.target.select()"
            >
            <button
              class="btn btn-primary"
              :class="{ 'btn-success': shareUrlCopied }"
              @click="copyShareUrl"
            >
              <i
                class="fa-solid"
                :class="shareUrlCopied ? 'fa-check' : 'fa-copy'"
              />
              {{ shareUrlCopied ? 'Copied!' : 'Copy' }}
            </button>
          </div>

          <!-- State Info -->
          <div class="share-state-info">
            <small class="text-muted">
              <i class="fa-solid fa-info-circle" />
              This URL contains your current query
              <span v-if="Object.keys(hiddenElements.nodes).length + Object.keys(hiddenElements.edges).length > 0">
                and {{ Object.keys(hiddenElements.nodes).length + Object.keys(hiddenElements.edges).length }} hidden elements
              </span>.
            </small>
          </div>
        </div>

        <div class="share-modal-footer">
          <button
            class="btn btn-secondary"
            @click="closeShareModal"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="js">
import { Graph, GraphEvent } from '@antv/g6';
import G6Utils from "../../utils/G6Utils";
import {
  DATA_TYPES, UI_SIZE, LOOP_POSITIONS, ARC_CURVE_OFFSETS
} from "../../utils/Constants";
import NeighborsFetcher from "../../utils/NeighborsFetcher";
import { useSettingsStore } from "../../store/SettingsStore";
import { useModeStore } from "../../store/ModeStore";
import { mapStores } from 'pinia'
import ValueFormatter from "../../utils/ValueFormatter";
import HoverContainer from "./HoverContainer.vue";
import g6Utils from '../../utils/G6Utils';
import { generateShareableUrl } from "../../utils/InvestigationState";

export default {
  name: "ResultGraph",
  components: {
    HoverContainer
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
    // Investigation state sharing
    shareModalVisible: false,
    shareUrl: '',
    shareUrlCopied: false,
    shareUrlLength: 0,
    shareUrlTooLarge: false,
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
    externalLinks() {
      if (!this.clickedIsNode || !this.displayLabel) {
        return [];
      }

      const links = [];
      const entityType = this.displayLabel;
      const properties = this.clickedProperties;

      // Get property value by name
      const getProperty = (name) => {
        const prop = properties.find(p => p.name === name);
        return prop ? prop.value : null;
      };

      const entityName = getProperty('name');

      // Common links for all entities
      if (entityName) {
        links.push({
          label: 'Google Search',
          url: `https://www.google.com/search?q=${encodeURIComponent(entityName)}`,
          icon: 'fa-brands fa-google'
        });
        links.push({
          label: 'Wikipedia',
          url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(entityName)}`,
          icon: 'fa-brands fa-wikipedia-w'
        });
      }

      // Entity-specific links
      if (entityType === 'Company') {
        const companyNumber = getProperty('company_number');
        const jurisdiction = getProperty('jurisdiction');

        if (companyNumber && jurisdiction === 'GB') {
          links.push({
            label: 'Companies House',
            url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`,
            icon: 'fa-solid fa-building'
          });
        }

        if (entityName) {
          links.push({
            label: 'OpenCorporates',
            url: `https://opencorporates.com/companies?q=${encodeURIComponent(entityName)}`,
            icon: 'fa-solid fa-briefcase'
          });
        }
      } else if (entityType === 'Person') {
        if (entityName) {
          links.push({
            label: 'Google News',
            url: `https://news.google.com/search?q=${encodeURIComponent(entityName)}`,
            icon: 'fa-solid fa-newspaper'
          });
        }
      } else if (entityType === 'Address') {
        const fullAddress = getProperty('full');
        const postCode = getProperty('post_code');

        const addressQuery = fullAddress || postCode;
        if (addressQuery) {
          links.push({
            label: 'Google Maps',
            url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}`,
            icon: 'fa-solid fa-map-marked-alt'
          });
          links.push({
            label: 'Street View',
            url: `https://www.google.com/maps/@?api=1&map_action=pano&parameters&query=${encodeURIComponent(addressQuery)}`,
            icon: 'fa-solid fa-street-view'
          });
        }
      }

      return links;
    },
    sourceRecords() {
      if (!this.clickedIsNode || !this.displayProperties) {
        return [];
      }

      // Find source_systems property
      const sourceProp = this.displayProperties.find(p => p.name === 'source_systems');
      if (!sourceProp || !sourceProp.value) {
        return [];
      }

      // Parse sources (could be array or string representation)
      let sources = [];
      if (Array.isArray(sourceProp.value)) {
        sources = sourceProp.value;
      } else if (typeof sourceProp.value === 'string') {
        // Handle string representation like "['psc', 'companies_house']"
        const cleaned = sourceProp.value.replace(/[\[\]'"]/g, '');
        sources = cleaned.split(',').map(s => s.trim()).filter(s => s);
      }

      // Map source system names to display names
      const sourceMap = {};
      sources.forEach(source => {
        let sourceType = 'Unknown';

        switch (source) {
          case 'companies_house':
            sourceType = 'Companies House';
            break;
          case 'psc':
            sourceType = 'PSC Register';
            break;
          case 'icij':
            sourceType = 'ICIJ Offshore Leaks';
            break;
          default:
            sourceType = source; // Show the raw value if unknown
        }

        if (!sourceMap[sourceType]) {
          sourceMap[sourceType] = 0;
        }
        sourceMap[sourceType] += 1;
      });

      // Convert to array with badge colors
      const sourceBadges = Object.entries(sourceMap).map(([type, count]) => {
        let color = '#6c757d'; // Gray for unknown
        let order = 999; // Default order for unknown sources

        if (type === 'Companies House') {
          color = '#28a745'; // Green
          order = 1;
        } else if (type === 'PSC Register') {
          color = '#17a2b8'; // Blue
          order = 2;
        } else if (type === 'ICIJ Offshore Leaks') {
          color = '#ffc107'; // Yellow
          order = 3;
        }

        return {
          id: type,
          label: type,
          color,
          count: count,
          order: order
        };
      });

      // Sort by predefined order
      return sourceBadges.sort((a, b) => a.order - b.order);
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
    getLayoutConfig(edges) {
      let nodeSpacing = edges.length * 8;
      nodeSpacing = nodeSpacing < 80 ? 80 : nodeSpacing;
      nodeSpacing = nodeSpacing > 500 ? 500 : nodeSpacing;

      const config = {
        type: 'd3-force',
        link: {
          // Dynamic distance:
          // Fixed distance for nodes with large number of neighbors will cause mass collision (a large circle)
          // Variable distance with multiple layers of variation will display the nodes in a spaced out manner (multiple circles around node)
          distance: (d) => {
            // Get the source and target node degrees
            const sourceDegree = d.source.data?.degree || 1;
            const targetDegree = d.target.data?.degree || 1;

            // Base distance increased to account for labels below nodes
            const baseDistance = 200;

            // For high-degree nodes (hubs), vary the distance based on connection index
            if (sourceDegree > 5 || targetDegree > 5) {
              // Use a hash of the edge ID to create pseudo-random but consistent distances
              const edgeHash = d.id ? d.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : 0;
              const variation = (edgeHash % 6) * 100 + 100;
              return baseDistance + variation;
            }

            // For regular nodes, use standard distance
            return baseDistance;
          },
          strength: 2,
        },
        collide: {
          // Increase collision radius significantly to account for labels below nodes
          // Node radius + label offset (8px) + label height (~50px for 3 lines) + padding
          radius: (d) => d.size / 2 + 80,
          strength: 1.2, // Stronger collision avoidance
        },
        manyBody: {
          strength: -1800,  // Increased repulsion to spread nodes apart
        },
        radial: {
          radius: 200,

        },
        alpha: 1,
        alphaMin: 0.2,
        alphaDecay: 0.03,
        velocityDecay: 0.45,

      };

      return config;
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
      // Apply force layout to loaded graphs for better visualization
      const layoutConfig = this.getLayoutConfig(edges);

      this.g6Graph = new Graph({
        container,
        width,
        height,
        layout: layoutConfig,
        node: {
          type: 'circle',
          style: {
            labelFontSize: 13,
            labelFontFamily: "Lexend, Helvetica Neue, Helvetica, Arial, sans-serif",
            labelFontWeight: 400,
            labelFill: this.labelColor,
            labelPlacement: 'bottom',
            labelOffsetY: 8,
            labelMaxWidth: 200,
            labelWordWrap: true,
            labelWordWrapWidth: 200,
            labelLineHeight: 16,
            labelMaxLines: 3,
            iconFontFamily: "Font Awesome 6 Free",
            iconFontSize: 24,
            iconFontWeight: 900,
            iconFill: "#ffffff",
            zIndex: 10,
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
            stroke: this.edgeColor,
            endArrow: true,
            labelFontSize: 12,
            labelFontFamily: "Lexend,Helvetica Neue, Helvetica, Arial, sans-serif",
            labelFontWeight: 350,
            labelFill: this.labelColor,
            labelAutoRotate: true,
            labelTextBaseline: 'bottom',
            labelOffsetY: -8,
            zIndex: 1,
          },
          state: {
            active: {
              lineWidth: 10,
              stroke: '#1890FF',
            },
          },
        },
        behaviors: ['zoom-canvas', 'drag-canvas',
          {
            type: 'optimize-viewport-transform',
            debounce: 300,
          },
          {
            type: 'drag-element-force',
            fixed: true,
          },
          {
            type: 'click-select',
            key: 'click-select-element',
            degree: 0,
            state: 'active',
            enable: true,
          },
          {
            type: 'click-select',
            key: 'click-highlight',
            degree: 1,
            state: 'active',
            unselectedState: 'inactive',
            enable: false,
            neighborState: 'active',
          },
        ],
      });

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

      this.g6Graph.on('node:dblclick', (e) => {
        const itemId = e.target.id;
        const isCurrentNodeExpanded = this.isNeighborExpanded(e.target);
        if (isCurrentNodeExpanded) {
          this.collapseNode(itemId);
          this.deselectAll();
          return this.redrawGraph();
        }
        const nodeData = this.g6Graph.getNodeData(itemId);
        this.expandOnNode(nodeData);
        this.deselectAll();
      });

      this.g6Graph.on('node:dragend', () => {
        const layout = this.g6Graph.getLayout();
        if (layout && layout.simulation) {
          layout.simulation.alpha(0.3).restart();
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
      if (nodes.length === 0) {
        this.$emit("graphEmpty");
      }

      const container = this.$refs.graph;
      const width = container.offsetWidth;
      const height = this.containerHeight === "auto" ? container.offsetHeight : parseInt(this.containerHeight);
      const layoutConfig = this.getLayoutConfig(edges);

      this.g6Graph = new Graph({
        container,
        width,
        height,
        layout: layoutConfig,
        node: {
          type: 'circle',
          style: {
            labelFontSize: 13,
            labelFontFamily: "Lexend, Helvetica Neue, Helvetica, Arial, sans-serif",
            labelFontWeight: 400,
            labelFill: this.labelColor,
            labelPlacement: 'bottom',
            labelOffsetY: 8,
            labelMaxWidth: 200,
            labelWordWrap: true,
            labelWordWrapWidth: 200,
            labelLineHeight: 16,
            labelMaxLines: 3,
            iconFontFamily: "Font Awesome 6 Free",
            iconFontSize: 24,
            iconFontWeight: 900,
            iconFill: "#ffffff",
            zIndex: 10,
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
            stroke: this.edgeColor,
            endArrow: true,
            labelFontSize: 12,
            labelFontFamily: "Lexend,Helvetica Neue, Helvetica, Arial, sans-serif",
            labelFontWeight: 350,
            labelFill: this.labelColor,
            labelAutoRotate: true,
            labelTextBaseline: 'bottom',
            labelOffsetY: -8,
            zIndex: 1,
          },
          state: {
            active: {
              lineWidth: 10,
              stroke: '#1890FF',
            },

          },
        },
        behaviors: ['zoom-canvas', 'drag-canvas',
          {
            type: 'optimize-viewport-transform',
            debounce: 300,
          },
          {
            type: 'drag-element-force',
            fixed: true,
          },
          {
            type: 'click-select',
            key: 'click-select-element',
            degree: 0,
            state: 'active',
            enable: true,
          },
          {
            type: 'click-select',
            key: 'click-highlight',
            degree: 1,
            state: 'active',
            unselectedState: 'inactive',
            enable: false,
            neighborState: 'active',
          },
        ],
      });

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
      this.deselectAll();

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
        // Only profligate nodes remain - check if we need to warn
        let needsWarning = false;
        profligateNodes.forEach(p => {
          if (!this.shownProfligateWarnings.has(p.nodeId)) {
            needsWarning = true;
            this.shownProfligateWarnings.add(p.nodeId);
          }
        });

        if (needsWarning) {
          this.showToast(`All ${profligateNodes.length} nodes have >10 connections. Double-click to expand individually.`, 4000);
        }
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

    collapseNode(id) {
      const expansion = this.expansions.find((e) => e.id === id);
      if (!expansion) {
        return;
      }
      const neighbors = expansion.neighbors;
      this.expansions = this.expansions.filter((e) => e.id !== id);
      // Recursively collapse neighbors
      neighbors.rows.forEach((neighbor) => {
        if (neighbor.dst) {
          const id = this.encodeId(neighbor.dst._id);
          this.collapseNode(id);
        }
      });
    },

    collapseSelectedNode() {
      this.collapseNode(this.clickedId);
      this.redrawGraph();
      this.isCurrentNodeExpanded = false;
      this.deselectAll();
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
      const newData = {
        nodes: currentNodes.concat(nodesToAdd),
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
      const layoutConfig = this.getLayoutConfig(currentData.edges);

      this.g6Graph = new Graph({
        container,
        width,
        height,
        layout: layoutConfig,
        node: {
          type: 'circle',
          style: {
            labelFontSize: 13,
            labelFontFamily: "Lexend, Helvetica Neue, Helvetica, Arial, sans-serif",
            labelFontWeight: 400,
            labelFill: this.labelColor,
            labelPlacement: 'bottom',
            labelOffsetY: 8,
            labelMaxWidth: 200,
            labelWordWrap: true,
            labelWordWrapWidth: 200,
            labelLineHeight: 16,
            labelMaxLines: 3,
            iconFontFamily: "Font Awesome 6 Free",
            iconFontSize: 24,
            iconFontWeight: 900,
            iconFill: "#ffffff",
            zIndex: 10,
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
            stroke: this.edgeColor,
            endArrow: true,
            labelFontSize: 12,
            labelFontFamily: "Lexend,Helvetica Neue, Helvetica, Arial, sans-serif",
            labelFontWeight: 350,
            labelFill: this.labelColor,
            labelAutoRotate: true,
            labelTextBaseline: 'bottom',
            labelOffsetY: -8,
            zIndex: 1,
          },
          state: {
            active: {
              lineWidth: 10,
              stroke: '#1890FF',
            },
          },
        },
        behaviors: ['zoom-canvas', 'drag-canvas',
          {
            type: 'optimize-viewport-transform',
            debounce: 300,
          },
          {
            type: 'drag-element-force',
            fixed: true,
          },
          {
            type: 'click-select',
            key: 'click-select-element',
            degree: 0,
            state: 'active',
            enable: true,
          },
          {
            type: 'click-select',
            key: 'click-highlight',
            degree: 1,
            state: 'active',
            unselectedState: 'inactive',
            enable: false,
            neighborState: 'active',
          },
        ],
      });

      // Register graph event handlers
      this.g6Graph.on('node:pointerenter', (e) => {
        const id = e.target.id;
        const nodeData = this.g6Graph.getNodeData(id);
        this.$refs.hoverContainer.handleHover(nodeData, e);
      });

      this.g6Graph.on('node:pointerleave', (e) => {
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

      this.g6Graph.on('edge:pointerleave', (e) => {
        this.$refs.hoverContainer.resetHover();
      });

      this.g6Graph.on('edge:pointermove', (e) => {
        this.$refs.hoverContainer.showTooltip(e);
      });

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

      this.g6Graph.on('node:dblclick', (e) => {
        const itemId = e.target.id;
        const isCurrentNodeExpanded = this.isNeighborExpanded(e.target);
        if (isCurrentNodeExpanded) {
          this.collapseNode(itemId);
          this.deselectAll();
          return this.redrawGraph();
        }
        const nodeData = this.g6Graph.getNodeData(itemId);
        this.expandOnNode(nodeData);
        this.deselectAll();
      });

      this.g6Graph.on('node:dragend', () => {
        const layout = this.g6Graph.getLayout();
        if (layout && layout.simulation) {
          layout.simulation.alpha(0.3).restart();
        }
      });

      this.g6Graph.on('canvas:click', () => {
        this.deselectAll();
      });

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
     * 1. Initializing an empty G6 graph (if needed) with appropriate force layout
     * 2. Loading all saved nodes and edges with their complete properties
     * 3. Re-applying hidden element states
     * 4. Restoring the viewport zoom level
     *
     * The parent component (ShellCell) is responsible for loading the query text into
     * the editor. This method focuses solely on reconstructing the graph visualization.
     *
     * @param {Object} state - Investigation state object from getInvestigationState()
     * @param {Array} state.queries - Array of executed queries (unused here, handled by parent)
     * @param {Object} state.graphData - Complete graph data {nodes: Array, edges: Array}
     * @param {Object} state.hiddenElements - Map of hidden elements {nodes: Object, edges: Object}
     * @param {Object} [state.viewport] - Optional viewport state {zoom: number}
     * @returns {Promise<void>}
     */
    async restoreInvestigationState(state) {
      if (!state) return;

      // Wait for graph to be initialized
      await this.$nextTick();

      // If we have saved graph data, load it directly
      if (state.graphData && state.graphData.nodes && state.graphData.nodes.length > 0) {
        // Initialize the graph if not already initialized
        if (!this.g6Graph) {
          // Initialize graph without processing queryResult (to avoid graphEmpty event)
          // Pass edges to set up force layout
          await this.initializeEmptyGraph(state.graphData.edges);
          await this.$nextTick();
        }

        // Clear existing graph and load saved data
        if (this.g6Graph) {
          this.g6Graph.clear();

          // Add all nodes and edges to the graph
          this.g6Graph.addData({
            nodes: state.graphData.nodes,
            edges: state.graphData.edges,
          });

          // Render the graph
          await this.render();
        } else {
          console.error('[ResultGraph] Failed to initialize graph');
          return;
        }
      }

      // Restore hidden elements
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

      // Restore viewport (zoom level)
      if (state.viewport && state.viewport.zoom && this.g6Graph) {
        try {
          await this.$nextTick();
          this.g6Graph.zoomTo(state.viewport.zoom, { duration: 300 });
        } catch (e) {
          console.warn('[ResultGraph] Failed to restore viewport zoom:', e);
        }
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
     * Generate shareable URL and show modal
     */
    generateShareUrl() {
      const state = this.getInvestigationState();
      const result = generateShareableUrl(state);

      this.shareUrl = result.url;
      this.shareUrlLength = result.estimatedLength;
      this.shareUrlTooLarge = result.isOversized;
      this.shareUrlCopied = false;
      this.shareModalVisible = true;

      // Auto-select the URL input after modal renders
      this.$nextTick(() => {
        if (this.$refs.shareUrlInput) {
          this.$refs.shareUrlInput.select();
        }
      });
    },

    /**
     * Copy share URL to clipboard
     */
    async copyShareUrl() {
      try {
        await navigator.clipboard.writeText(this.shareUrl);
        this.shareUrlCopied = true;

        // Reset copied state after 2 seconds
        setTimeout(() => {
          this.shareUrlCopied = false;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy URL:', error);
        // Fallback: select the text so user can manually copy
        if (this.$refs.shareUrlInput) {
          this.$refs.shareUrlInput.select();
        }
      }
    },

    /**
     * Close share modal
     */
    closeShareModal() {
      this.shareModalVisible = false;
      this.shareUrlCopied = false;
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
      padding: 1rem;
      padding-left: 1.5rem;

      /* Thin scrollbar always visible */
      scrollbar-width: thin;
      scrollbar-color: var(--bs-body-bg-accent) transparent;

      &::-webkit-scrollbar {
        width: 6px;
      }

      &::-webkit-scrollbar-track {
        background: transparent;
      }

      &::-webkit-scrollbar-thumb {
        background: var(--bs-body-bg-accent);
        border-radius: 3px;
      }

      &::-webkit-scrollbar-thumb:hover {
        background: var(--bs-body-text-secondary);
      }
    }

    .result-graph__sidebar-button--close {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: var(--bs-body-text);
      z-index: 3;

      &:hover {
        opacity: 0.7;
      }
    }

    .result-graph__actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1rem;

      h5 {
        margin-bottom: 0.5rem;
      }
    }

    .result-graph__neighbor-info {
      background-color: var(--bs-body-bg);
      border-radius: 0.5rem;
      padding: 0.75rem;
      margin-bottom: 1rem;

      .neighbor-info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
      }

      .neighbor-info-label {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--bs-body-text);
        display: flex;
        align-items: center;
        gap: 0.5rem;

        i {
          color: var(--bs-body-text-secondary);
        }
      }

      .neighbor-info-value {
        font-size: 0.8rem;
        font-weight: 500;
        color: var(--bs-body-text-secondary);
        display: flex;
        align-items: center;
        gap: 0.375rem;

        &.neighbor-info-value--profligate {
          color: #ffc107;
          font-weight: 600;

          i {
            color: #ffc107;
          }
        }

        i {
          font-size: 0.75rem;
        }
      }
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

        &:hover {
          .value-text {
            opacity: 0.8;
          }
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

    h5 {
      margin-bottom: 1rem;
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
    }

    button.btn-outline-primary {
      background-color: var(--bs-body-bg-accent);
      color: var(--bs-body-bg);
    }

    .badge.bg-primary {
      color: white !important;
    }

    .result-graph__external-links {
      margin-top: 1rem;

      h6 {
        font-size: 0.9rem;
        font-weight: 600;
        margin-bottom: 0.75rem;
        color: var(--bs-body-text);
      }

      .result-graph__links-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
      }

      .result-graph__external-link {
        padding: 0.4rem 0.6rem;
        font-size: 0.85rem;
        text-align: center;
        background-color: var(--bs-body-bg);
        color: var(--bs-body-text);
        border-color: var(--bs-body-inactive);
        border-radius: 0.375rem;
        text-decoration: none;
        transition: all 0.2s;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;

        &:hover {
          background-color: var(--bs-body-bg-hover);
          border-color: var(--bs-body-text);
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        i {
          margin-right: 0.25rem;
        }
      }
    }

    .result-graph__source-provenance {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--bs-body-inactive);

      h6 {
        font-size: 0.9rem;
        font-weight: 600;
        margin-bottom: 0.75rem;
        color: var(--bs-body-text);
      }

      .result-graph__source-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;

        .badge {
          padding: 0.375rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 500;
          border-radius: 0.375rem;
        }

        .result-graph__source-badge {
          background-color: var(--badge-bg-color) !important;
          color: white !important;
        }
      }
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
      opacity: 0.8;
    }

    i {
      font-size: 1.2rem;
    }
  }

  .result-graph__toast {
    position: absolute;
    top: 1rem;
    background-color: var(--bs-body-bg-secondary);
    border: 1px solid var(--bs-body-bg-accent);
    border-radius: 0.375rem;
    padding: 0.75rem 1rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 400px;
    animation: slideInRight 0.3s ease-out;

    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .toast-content {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex: 1;
      color: var(--bs-body-text);

      i {
        color: var(--bs-body-bg-accent);
        font-size: 1rem;
        flex-shrink: 0;
      }

      span {
        font-size: 0.85rem;
        line-height: 1.3;
      }
    }

    .toast-close {
      background: none;
      border: none;
      color: var(--bs-body-text-secondary);
      cursor: pointer;
      padding: 0.125rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 0.25rem;
      transition: background-color 0.2s, color 0.2s;

      &:hover {
        background-color: var(--bs-body-bg-hover);
        color: var(--bs-body-text);
      }

      i {
        font-size: 0.875rem;
      }
    }
  }

  // Share Investigation Section
  .result-graph__share-section {
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--bs-border-color);

    button {
      transition: all 0.2s;

      &:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      i {
        margin-right: 0.5rem;
      }
    }
  }

  // Share Modal
  .result-graph__share-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 1rem;

    .share-modal-content {
      background-color: var(--bs-body-bg);
      border-radius: 0.5rem;
      box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.3);
      max-width: 600px;
      width: 100%;
      max-height: 90vh;
      overflow: auto;
      animation: modalSlideIn 0.2s ease-out;
    }

    @keyframes modalSlideIn {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .share-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem;
      border-bottom: 1px solid var(--bs-border-color);

      h5 {
        margin: 0;
        font-size: 1.25rem;
        color: var(--bs-body-text);
      }

      .btn-close {
        background: none;
        border: none;
        color: var(--bs-body-text-secondary);
        cursor: pointer;
        padding: 0.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 0.25rem;
        transition: background-color 0.2s, color 0.2s;

        &:hover {
          background-color: var(--bs-body-bg-hover);
          color: var(--bs-body-text);
        }

        i {
          font-size: 1.25rem;
        }
      }
    }

    .share-modal-body {
      padding: 1.25rem;

      .share-modal-description {
        color: var(--bs-body-text-secondary);
        margin-bottom: 1rem;
        font-size: 0.95rem;
      }

      .alert {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        padding: 0.75rem;
        border-radius: 0.375rem;
        margin-bottom: 1rem;
        background-color: rgba(255, 193, 7, 0.1);
        border: 1px solid rgba(255, 193, 7, 0.3);
        color: var(--bs-body-text);

        i {
          color: #ffc107;
          font-size: 1rem;
          margin-top: 0.125rem;
        }
      }

      .share-url-container {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;

        input {
          flex: 1;
          font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
          font-size: 0.85rem;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--bs-border-color);
          border-radius: 0.375rem;
          background-color: var(--bs-body-bg-secondary);
          color: var(--bs-body-text);

          &:focus {
            outline: none;
            border-color: var(--bs-primary);
            box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.25);
          }
        }

        button {
          white-space: nowrap;
          transition: all 0.2s;

          &.btn-success {
            background-color: #28a745;
            border-color: #28a745;
          }

          i {
            margin-right: 0.375rem;
          }
        }
      }

      .share-state-info {
        padding: 0.75rem;
        background-color: var(--bs-body-bg-secondary);
        border-radius: 0.375rem;
        border: 1px solid var(--bs-border-color);

        small {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;

          i {
            color: var(--bs-body-bg-accent);
            margin-top: 0.125rem;
          }
        }
      }
    }

    .share-modal-footer {
      display: flex;
      justify-content: flex-end;
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--bs-border-color);
    }
  }
}
</style>
