<template>
  <div
    ref="panel"
    class="connected-entities"
  >
    <div
      class="connected-entities-header"
      @click="togglePanel"
    >
      <i
        class="fa-solid"
        :class="isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'"
      />
      <h6>Connected Entities</h6>
      <span
        v-if="totalCount > 0"
        class="badge bg-secondary total-count"
      >{{ totalCount }}</span>
    </div>

    <div
      v-show="isExpanded"
      class="connected-entities-content"
    >
      <div
        v-if="isLoading"
        class="loading-state"
      >
        <i class="fa-solid fa-spinner fa-spin" /> Loading...
      </div>

      <div
        v-else-if="error"
        class="error-state"
      >
        <small>{{ error }}</small>
      </div>

      <div
        v-else-if="groupedConnections.length === 0"
        class="no-connections"
      >
        <small>No connected entities found</small>
      </div>

      <template v-else>
        <div
          v-if="hasMore"
          class="has-more-notice"
        >
          <small>Showing the first {{ totalCount }} connected entities. This entity has more connections than are shown.</small>
        </div>
        <div
          v-for="group in groupedConnections"
          :key="group.label"
          class="entity-group"
        >
          <div
            class="entity-group-header"
            @click.stop="toggleGroup(group.label)"
          >
            <i
              class="fa-solid"
              :class="expandedGroups[group.label] ? 'fa-chevron-down' : 'fa-chevron-right'"
            />
            <span class="group-label">{{ group.displayLabel }}</span>
            <span class="badge bg-secondary group-count">{{ group.entities.length }}</span>
          </div>

          <div
            v-show="expandedGroups[group.label]"
            class="entity-list"
          >
            <div
              v-for="entity in group.entities"
              :key="entity.id"
              class="entity-row"
              :class="{ 'entity-row--in-graph': entity.inGraph }"
              @click.stop="handleEntityClick(entity)"
            >
              <span
                class="entity-name"
                :title="entity.displayName"
              >{{ entity.displayName }}</span>
              <span class="entity-relationship">{{ entity.relationshipLabels.join(', ') }}<template
                v-if="entity.ownershipShares.length"
              > ({{ entity.ownershipShares.join(', ') }})</template></span>
              <button
                v-if="!entity.inGraph"
                class="add-button"
                title="Add to graph"
                @click.stop="handleAddNode(entity)"
              >
                <i class="fa-solid fa-plus" />
              </button>
              <i
                v-else
                class="fa-solid fa-check in-graph-indicator"
                title="In graph"
              />
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import NeighborsFetcher from "../../utils/NeighborsFetcher";
import {
  buildEdgeRows,
  collapseByEntity,
} from "../../utils/ConnectedEntities";
import { entityGroupLabel } from "../../utils/DisplayPolicy";

export default {
  name: "ConnectedEntitiesPanel",
  props: {
    nodeId: {
      type: String,
      required: true,
    },
    nodeLabel: {
      type: String,
      required: true,
    },
    nodeProperties: {
      type: Array,
      required: true,
    },
    schema: {
      type: Object,
      required: true,
    },
    g6Graph: {
      type: Object,
      required: false,
      default: null,
    },
    settingsStore: {
      type: Object,
      required: true,
    },
  },
  emits: ['selectNode', 'addNode'],
  data() {
    return {
      isExpanded: false,
      isLoading: false,
      error: null,
      connectedEntities: [],
      expandedGroups: {},
      hasFetched: false,
      hasMore: false,
      maxResults: 200,
      fetchId: 0, // Counter to detect stale responses from rapid node selection
    };
  },
  computed: {
    groupedConnections() {
      const groups = {};

      this.connectedEntities.forEach(entity => {
        if (!groups[entity.label]) {
          groups[entity.label] = {
            label: entity.label,
            displayLabel: entityGroupLabel(entity.label),
            entities: [],
          };
        }
        groups[entity.label].entities.push(entity);
      });

      // Sort entities within each group alphabetically by name, with an id
      // tie-break so the display order is fully deterministic.
      Object.values(groups).forEach(group => {
        group.entities.sort((a, b) => {
          const nameA = (a.displayName || '').toLowerCase();
          const nameB = (b.displayName || '').toLowerCase();
          const byName = nameA.localeCompare(nameB);
          if (byName !== 0) return byName;
          return String(a.id).localeCompare(String(b.id));
        });
      });

      // Sort groups alphabetically by label
      return Object.values(groups).sort((a, b) => a.label.localeCompare(b.label));
    },
    totalCount() {
      return this.connectedEntities.length;
    },
  },
  watch: {
    nodeId: {
      handler() {
        // Reset state when node changes
        this.connectedEntities = [];
        this.expandedGroups = {};
        this.hasFetched = false;
        this.hasMore = false;
        this.error = null;
        // If panel is already expanded, fetch immediately
        if (this.isExpanded) {
          this.fetchConnectedEntities();
        }
      },
    },
    groupedConnections: {
      immediate: true,
      handler(groups) {
        // Initialize expanded state for any new groups (collapsed by default)
        groups.forEach(group => {
          if (this.expandedGroups[group.label] === undefined) {
            this.expandedGroups[group.label] = false;
          }
        });
      },
    },
  },
  methods: {
    async togglePanel() {
      this.isExpanded = !this.isExpanded;
      if (this.isExpanded) {
        if (!this.hasFetched) {
          await this.fetchConnectedEntities();
        }
        // Reveal the newly-expanded panel within its own scrollable side
        // panel. Use block: 'nearest' rather than 'start': 'start' aligns the
        // panel to the top of the *viewport*, which forces every scroll
        // ancestor to move and drags the shell editor's top margin up under
        // the header, collapsing the header-to-search gap. 'nearest' scrolls
        // only the minimum needed to bring the panel into view, leaving the
        // outer layout untouched.
        this.$nextTick(() => {
          this.$refs.panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    },

    async fetchConnectedEntities() {
      // Increment fetch ID to track this specific request
      const currentFetchId = ++this.fetchId;

      this.isLoading = true;
      this.error = null;

      try {
        const { tableName, primaryKeyName, primaryKeyValue } = this.getNodeInfo();

        // Fetch maxResults + 1 to detect if there are more
        const result = await NeighborsFetcher.fetchNeighbors({
          tableName,
          primaryKeyName,
          primaryKeyValue,
          relTables: this.schema.relTables,
          sizeLimit: this.maxResults + 1,
        });

        // Discard stale response if user selected a different node while fetching
        if (currentFetchId !== this.fetchId) {
          return;
        }

        if (result && result.rows) {
          // Collapse per-relationship rows so counts and the list reflect
          // distinct entities, not edges.
          const edgeRows = this.parseNeighborResults(result);
          const allEntities = collapseByEntity(edgeRows);

          // Truncation must key off RAW edge rows (result.truncated), not the
          // collapsed entity count: a full fetch window can collapse to fewer
          // distinct entities than the cap while neighbours were never fetched.
          this.hasMore = Boolean(result.truncated)
            || allEntities.length > this.maxResults;
          this.connectedEntities = allEntities.slice(0, this.maxResults);
        } else {
          this.connectedEntities = [];
          this.hasMore = false;
        }

        this.hasFetched = true;
      } catch (e) {
        // Discard stale errors too
        if (currentFetchId !== this.fetchId) {
          return;
        }
        console.error('Failed to fetch connected entities:', e);
        this.error = 'Failed to load connected entities';
      } finally {
        // Only update loading state if this is still the current request
        if (currentFetchId === this.fetchId) {
          this.isLoading = false;
        }
      }
    },

    getNodeInfo() {
      const tableName = this.nodeLabel;
      const tableSchema = this.schema.nodeTables.find(t => t.name === tableName);

      if (!tableSchema) {
        throw new Error(`Schema not found for table: ${tableName}`);
      }

      const primaryKeyProp = tableSchema.properties.find(p => p.isPrimaryKey);
      if (!primaryKeyProp) {
        throw new Error(`Primary key not found for table: ${tableName}`);
      }

      const primaryKeyName = primaryKeyProp.name;

      // Find the primary key value from node properties
      const pkProp = this.nodeProperties.find(p => p.name === primaryKeyName);
      const primaryKeyValue = pkProp ? pkProp.value : null;

      return { tableName, primaryKeyName, primaryKeyValue };
    },

    parseNeighborResults(result) {
      // Rows are objects with named properties: {r: relationship, dst: node}.
      // The pure row-shaping (per-type, direction-aware dedupe) lives in
      // buildEdgeRows; only the display-environment lookups are supplied here.
      return buildEdgeRows(result.rows, {
        getDisplayName: node => this.getEntityDisplayName(node),
        isInGraph: nodeId => {
          if (!this.g6Graph) return false;
          try {
            this.g6Graph.getNodeData(nodeId);
            return true;
          } catch (e) {
            return false;
          }
        },
      });
    },

    toggleGroup(label) {
      this.expandedGroups[label] = !this.expandedGroups[label];
    },

    getEntityDisplayName(node) {
      // Use the configured label property from settings store
      if (node._label && this.settingsStore) {
        const nodeSettings = this.settingsStore.settingsForLabel(node._label);
        if (nodeSettings && nodeSettings.label) {
          const labelProp = nodeSettings.label;
          if (node[labelProp] !== undefined && node[labelProp] !== null) {
            return String(node[labelProp]);
          }
        }
      }

      // Fallback: prefer the pk (named 'id' on every node table in this
      // schema) over the internal table:offset id
      if (node.id !== undefined && node.id !== null) {
        return String(node.id);
      }
      if (node._id) {
        return `${node._id.table}:${node._id.offset}`;
      }
      return 'Unknown';
    },

    handleEntityClick(entity) {
      if (entity.inGraph) {
        // If already in graph, select it
        this.$emit('selectNode', entity.id);
      }
      // If not in graph, do nothing on row click - use the + button
    },

    handleAddNode(entity) {
      // Guard against missing raw data - the parent will reject this
      if (!entity.rawNode || !entity.rawRel) {
        console.warn('Cannot add node: missing raw data');
        return;
      }
      this.$emit('addNode', entity);
      // Optimistic UI update - the parent's add path is async but always adds
      // the node when rawNode/rawRel are present, and undo re-syncs the flag
      // via refreshInGraphStatus.
      entity.inGraph = true;
    },

    /**
     * Refresh inGraph status for all entities by checking against the current
     * graph. Called by the parent after undo/redo operations so each row's
     * +/check indicator stays accurate (the single-add path relies on the
     * optimistic entity.inGraph flag instead).
     */
    refreshInGraphStatus() {
      if (!this.g6Graph) return;
      this.connectedEntities.forEach(entity => {
        try {
          this.g6Graph.getNodeData(entity.id);
          entity.inGraph = true;
        } catch (e) {
          entity.inGraph = false;
        }
      });
    },
  },
};
</script>

<style lang="scss" scoped>
.connected-entities {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bs-body-inactive);

  .connected-entities-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    padding: 0.25rem 0;

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
      flex: 1;
    }

    .total-count {
      font-size: 0.75rem;
      padding: 0.15rem 0.4rem;
    }
  }

  .connected-entities-content {
    margin-top: 0.5rem;
  }

  .loading-state,
  .error-state,
  .no-connections {
    color: var(--bs-body-inactive);
    font-size: 0.85rem;
    padding: 0.5rem 0;
  }

  .error-state {
    color: var(--bs-danger);
  }

  .has-more-notice {
    color: var(--bs-body-inactive);
    font-size: 0.75rem;
    padding: 0.25rem 0 0.5rem;
    font-style: italic;
  }

  .entity-group {
    margin-bottom: 0.75rem;

    .entity-group-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0;
      cursor: pointer;

      &:hover {
        opacity: 0.8;
      }

      i {
        font-size: 0.65rem;
        width: 10px;
        text-align: center;
        color: var(--bs-body-inactive);
      }

      .group-label {
        font-weight: 500;
        font-size: 0.8rem;
        flex: 1;
      }

      .group-count {
        font-size: 0.7rem;
        padding: 0.1rem 0.35rem;
      }
    }

    .entity-list {
      margin-left: 1rem;
      background-color: var(--bs-body-bg);
      border-radius: 0.25rem;
      padding: 0.25rem;

      .entity-row {
        display: grid;
        grid-template-columns: 1fr auto 24px;
        gap: 0.5rem;
        align-items: center;
        padding: 0.25rem 0.5rem;
        font-size: 0.8rem;
        cursor: pointer;
        border-radius: 0.2rem;

        &:hover {
          background-color: var(--bs-body-bg-hover, rgba(0, 0, 0, 0.05));
        }

        &--in-graph {
          opacity: 0.5;
        }

        .entity-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 500;
          min-width: 0;
        }

        .entity-relationship {
          color: var(--bs-body-text);
          opacity: 0.7;
          white-space: nowrap;
          font-size: 0.75rem;
        }

        .add-button {
          background: none;
          border: 1px solid var(--bs-body-inactive);
          border-radius: 0.2rem;
          width: 20px;
          height: 20px;
          padding: 0;
          cursor: pointer;
          color: var(--bs-body-text);
          opacity: 0.4;
          transition: opacity 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;

          &:hover {
            opacity: 1;
            border-color: var(--bs-body-text);
          }

          i {
            font-size: 0.6rem;
          }
        }

        .in-graph-indicator {
          color: var(--bs-success);
          font-size: 0.6rem;
          width: 20px;
          text-align: center;
        }
      }
    }
  }
}
</style>
