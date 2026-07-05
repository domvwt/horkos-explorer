<template>
  <div
    class="shell-main-view__wrapper"
    :class="{ 'is-maximized': maximizedCellIndex !== -1 }"
  >
    <div
      v-if="maximizedCellIndex < 0 && !isReadOnly"
      class="shell-main-view__add-cell-row"
    >
      <button
        type="button"
        class="btn btn-link text-body p-0 text-decoration-none"
        @click="addCell"
      >
        + Click here to add a new cell
      </button>
      <div class="flex-grow-1 border-top border-secondary" />
    </div>
    <ShellCell
      v-for="(cell, index) in shellCell"
      v-show="index === maximizedCellIndex || maximizedCellIndex < 0"
      :ref="getCellRef(index)"
      :key="cell.cellId"
      :schema="schema"
      :navbar-height="navbarHeight"
      :cell-id="cell.cellId"
      @remove="removeCell(index)"
      @add-cell="addCell()"
      @maximize="maximize(index)"
      @minimize="minimize()"
      @reload-schema="reloadSchema()"
    />
  </div>
</template>

<script lang="js">
import ShellCell from "./ShellCell.vue";
import { v4 as uuidv4 } from 'uuid';
import Axios from "@/utils/AxiosWrapper";
import { MODES } from "@/utils/Constants";
import { useModeStore } from "@/store/ModeStore";
export default {
  name: "ShellMainView",
  components: {
    ShellCell,
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
  },
  emits: ["reloadSchema"],
  setup() {
    const modeStore = useModeStore();
    return {
      modeStore,
    };
  },
  data: () => ({
    shellCell: [
      {
        cellId: uuidv4(),
      },
    ],
    isCellAddedToTheEnd: false,
    isWasm: false,
    isDemo: false,
    maximizedCellIndex: -1,
    isRestoringInvestigation: false,
    isDemoCellFinalized: false,
    demoCellQuery: "",
  }),
  computed: {
    isReadOnly() {
      return this.modeStore.isReadOnly;
    },
  },

  watch: {
    // The schema often arrives asynchronously after this component mounts
    // (MainLayout fetches /api/schema in its own mounted() hook). If the
    // demo cell was first populated with the schema-less fallback query,
    // upgrade it once the schema becomes available so it can target a
    // concrete relationship type - but only if the user hasn't edited the
    // cell in the meantime (upgradeDemoCell does the pristine check).
    schema(newSchema) {
      if (!newSchema || this.isDemoCellFinalized) {
        return;
      }
      this.upgradeDemoCell();
    },
  },

  async mounted() {
    try {
      const response = await Axios.get("/api/mode");
      this.isWasm = response.data.mode === MODES.WASM || response.data.mode === MODES.DEMO;
      this.isDemo = response.data.mode === MODES.DEMO;
    } catch (e) {
      // Ignore
    }

    // Normal loading - load demo or history
    this.$nextTick(() => {
      this.loadDemoCell();
    });
    this.loadCellsFromHistory();

    document.addEventListener("keydown", this.handleKeyDown);
  },

  beforeUnmount() {
    document.removeEventListener("keydown", this.handleKeyDown);
  },

  methods: {
    createCell() {
      return {
        cellId: uuidv4(),
      }
    },
    removeCell(index) {
      const uuid = this.shellCell[index].cellId;
      this.shellCell.splice(index, 1);
      this.$nextTick(() => {
        if (this.shellCell.length === 0) {
          this.shellCell.push(this.createCell());
        }
      });
      if (!uuid) {
        return;
      }
      // Remove from server history (if available)
      this.removeCellFromHistory(uuid).catch(() => {
        // Session endpoint not available - ignore
      });
    },
    removeCellFromHistory(uuid) {
      if (this.isWasm) {
        return Promise.resolve();
      }
      return Axios.delete(`/api/session/history/${uuid}`).catch(() => {
        // Session endpoint not available (DISABLE_SESSION_DB=true) - ignore
        console.debug('Server-side history delete not available');
      });
    },
    loadCellHistoryFromServer() {
      return Axios.get("/api/session/history").then(res => res.data);
    },
    async loadCellsFromHistory() {
      if (this.isWasm) {
        return;
      }
      try {
        const history = await this.loadCellHistoryFromServer();
        history.map(cell => {
          return {
            cellId: cell.uuid,
          };
        }).forEach(cell => {
          if (this.isCellAddedToTheEnd) {
            this.shellCell.unshift(cell);
          }
          else {
            this.shellCell.push(cell);
          }
        });
        this.$nextTick(() => {
          history.forEach((cell) => {
            const uuid = cell.uuid;
            const cellRef = this.$refs[this.getCellRefById(uuid)][0];
            cellRef.loadEditorFromHistory(cell);
          });
        });
      } catch (error) {
        // Session endpoint not available (DISABLE_SESSION_DB=true) - gracefully ignore
        // History will be loaded from localStorage instead
        console.debug('Server-side history not available, using localStorage');
      }
    },
    addCell() {
      const cell = this.createCell();
      if (this.isCellAddedToTheEnd) {
        this.shellCell.push(cell);
      }
      else {
        this.shellCell.unshift(cell);
      }
    },
    // Build a demo query from the loaded schema so it targets a single,
    // concrete relationship type. A wildcard `MATCH (a)-[r]->(b) RETURN *`
    // spanning every relationship table can fail on graphs where different
    // rel tables have divergent property (STRUCT) shapes, since Kuzu then
    // has to cast/union them into one result shape. Deriving the query from
    // the first relationship table in the schema avoids that entirely, and
    // keeps the demo schema-agnostic (no hardcoded rel type name). If no
    // schema/relTables are available yet, fall back to a node-only query,
    // which can never hit the cross-type cast.
    buildDemoQuery() {
      const relType = this.schema && this.schema.relTables && this.schema.relTables[0]
        ? this.schema.relTables[0].name
        : null;
      // Only build the single-type query when the first rel table actually
      // has a non-empty name; a malformed schema payload would otherwise
      // produce `[r:undefined]`. In that case fall back to the node-only
      // query, which can never hit the cross-type cast either.
      if (relType) {
        return `// Query to retrieve 5 "${relType}" relationships from the graph.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (a)-[r:${relType}]->(b) RETURN a, r, b LIMIT 5;`;
      }
      return `// Query to retrieve 5 nodes from the graph.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (n) RETURN n LIMIT 5;`;
    },
    // Whether the schema is loaded enough to derive the single-rel-type demo
    // query (as opposed to the node-only fallback). Used to decide when the
    // demo query is final and no further upgrade is needed.
    hasSchemaForDemo() {
      return !!(this.schema && this.schema.relTables && this.schema.relTables[0] && this.schema.relTables[0].name);
    },
    // Read the demo cell's current editor buffer, or null if unavailable.
    // There is no higher-level getter for a single cell's live text, so we
    // reach through the cell -> CypherEditor -> Monaco instance directly.
    getDemoCellText() {
      const cell = this.$refs[this.getCellRef(0)] && this.$refs[this.getCellRef(0)][0];
      const monaco = cell && cell.$refs.editor && cell.$refs.editor.editor;
      return monaco ? monaco.getValue() : null;
    },
    writeDemoCell(query) {
      const cell = this.$refs[this.getCellRef(0)] && this.$refs[this.getCellRef(0)][0];
      if (!cell) {
        return;
      }
      cell.loadEditorFromHistory({ cypherQuery: query });
      // Remember exactly what we wrote so a later schema-arrival upgrade can
      // tell whether the user has since edited the cell (see watch.schema).
      this.demoCellQuery = query;
      // Once the query is derived from a real schema it is final: stop
      // re-deriving it on subsequent schema updates (e.g. reloadSchema()).
      if (this.hasSchemaForDemo()) {
        this.isDemoCellFinalized = true;
      }
    },
    loadDemoCell() {
      this.$nextTick(() => {
        this.writeDemoCell(this.buildDemoQuery());
      });
    },
    // Called when the schema arrives after the demo cell was first populated
    // with the node-only fallback. Upgrade the fallback to the single-rel-type
    // query, but ONLY if the cell is still pristine (its buffer still equals
    // exactly the fallback text we wrote). If the user has typed anything, we
    // must not clobber their input: skip the overwrite and finalize so the
    // watcher stops firing.
    upgradeDemoCell() {
      this.$nextTick(() => {
        const current = this.getDemoCellText();
        const isPristine = current !== null && current === this.demoCellQuery;
        if (isPristine) {
          this.writeDemoCell(this.buildDemoQuery());
        } else {
          // User has edited (or the buffer is unreadable) - leave it alone.
          this.isDemoCellFinalized = true;
        }
      });
    },
    maximize(index) {
      this.maximizedCellIndex = index;
    },
    minimize() {
      this.maximizedCellIndex = -1;
    },
    reloadSchema() {
      this.$emit("reloadSchema");
    },
    getCellRef(index) {
      return `shell-cell-${this.shellCell[index].cellId}`;
    },
    getCellRefById(uuid) {
      return `shell-cell-${uuid}`;
    },
    handleKeyDown(event) {
      if (event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        this.evaluateCurrentCell();
      }
    },
    evaluateCurrentCell() {
      for (let i = 0; i < this.shellCell.length; ++i) {
        const currentCell = this.$refs[this.getCellRef(i)][0];
        if (currentCell.isActive()) {
          return currentCell.evaluateCell();
        }
      }
      try {
        const currentCell = this.$refs[this.getCellRef(0)][0];
        return currentCell.evaluateCell();
      } catch (e) {
        // Do nothing, there is no cell to evaluate
      }
    },
    // Redraw all graphs in all cells (called when theme changes)
    redrawAllGraphs() {
      for (let i = 0; i < this.shellCell.length; i++) {
        try {
          const cellRef = this.$refs[this.getCellRef(i)][0];
          if (cellRef && cellRef.redrawGraph) {
            cellRef.redrawGraph();
          }
        } catch (e) {
          // Cell may not have a graph, ignore
        }
      }
    },

    /**
     * Restore investigation state from import
     * Refetches full node/edge data from database using minimal state
     */
    async restoreInvestigation(state) {
      if (!state) {
        return;
      }

      if (!state.minimalNodes || state.minimalNodes.length === 0) {
        return;
      }

      this.isRestoringInvestigation = true;

      try {
        // Use the first (default) cell for restoration
        await this.$nextTick();

        const cellRef = this.getCellRef(0);
        const cell = this.$refs[cellRef]?.[0];
        if (!cell) {
          return;
        }

        // Load the query text into the editor (without executing)
        if (state.queries && state.queries.length > 0) {
          const lastQuery = state.queries[state.queries.length - 1];
          cell.loadEditorFromHistory({
            cypherQuery: lastQuery.query,
          });
        }

        // Wait for editor to load
        await new Promise(resolve => setTimeout(resolve, 100));

        // Load saved graph data directly into the cell
        await cell.loadSavedGraphData(state);

      } catch (error) {
        // Silently ignore restoration errors
      } finally {
        this.isRestoringInvestigation = false;
      }
    },

    /**
     * Get investigation state from the first shell cell
     * Used by MainLayout to generate share export code
     */
    getInvestigationState() {
      if (this.shellCell.length === 0) return null;
      const cellRef = this.getCellRef(0);
      const cell = this.$refs[cellRef]?.[0];
      if (cell) {
        return cell.getInvestigationState();
      }
      return null;
    },

    /**
     * Handle import investigation from modal
     * Receives parsed state from ImportModal component
     */
    async handleImportInvestigation(state) {
      if (!state) {
        return;
      }

      // Use the same restoration flow
      await this.restoreInvestigation(state);
    },
  },

}
</script>

<style lang="scss" scoped>
.shell-main-view__wrapper {
  width: 100%;
  height: 100%;

  &.is-maximized {
    margin-bottom: 2px;
  }

  .shell-main-view__add-cell-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
  }

  .shell-main-view__placeholder {
    margin: 20px;
    margin-top: 20px;
    padding: 8px;
    border: 2px solid $gray-300;

    a {
      font-style: italic;
      font-weight: 400;
      color: $body-tertiary-color;
      text-decoration: none;

      i {
        margin-right: 24px;
      }
    }
  }
}
</style>
