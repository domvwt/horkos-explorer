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
import { useModeStore } from "@/store/ModeStore";
import {
  saveViewThroughCell,
  restoreViewThroughCell,
  selectEntityThroughCell,
} from "@/utils/NotebookSidebarLogic";
import {
  buildDemoQuery,
  hasSchemaForDemo,
} from "@/utils/DemoQueryLogic";
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

  mounted() {
    // Seed the first cell with the example query, then load any saved history.
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
      return Axios.delete(`/api/session/history/${uuid}`).catch(() => {
        // Session endpoint not available (DISABLE_SESSION_DB=true) - ignore
        console.debug('Server-side history delete not available');
      });
    },
    loadCellHistoryFromServer() {
      return Axios.get("/api/session/history").then(res => res.data);
    },
    async loadCellsFromHistory() {
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
    // Demo-query derivation lives in @/utils/DemoQueryLogic (pure and unit
    // tested there): a curated Horkos example when the schema contains the
    // Person/Company node tables and the PersonOwnership rel table, else a
    // query derived from the schema's first relationship table, else the
    // node-only fallback when no usable schema is loaded yet.
    buildDemoQuery() {
      return buildDemoQuery(this.schema);
    },
    // Whether the schema is loaded enough to derive a final demo query (the
    // curated Horkos example or the single-rel-type derivation, as opposed
    // to the node-only fallback). Used to decide when the demo query is
    // final and no further schema-arrival upgrade is needed.
    hasSchemaForDemo() {
      return hasSchemaForDemo(this.schema);
    },
    // Read the demo cell's current editor buffer, or null if unavailable.
    // There is no higher-level getter for a single cell's live text, so we
    // reach through the cell -> CypherEditor -> Monaco instance directly.
    // Monaco loads on demand (see MonacoLoader.js), so writeDemoCell can run
    // before the editor exists yet: CypherEditor.setEditorContent buffers
    // that write in its non-reactive `pendingEditorContent` (undefined
    // sentinel = nothing buffered) and flushes it once the editor is
    // created. Reading only `cell.$refs.editor.editor` misses that buffered
    // write entirely - the pristine check would see null, treat the cell as
    // "unreadable", and finalize without ever applying the schema-derived
    // upgrade. Fall back to the pending buffer whenever the editor isn't up
    // yet.
    getDemoCellText() {
      const cell = this.$refs[this.getCellRef(0)] && this.$refs[this.getCellRef(0)][0];
      const cypherEditor = cell && cell.$refs.editor;
      if (!cypherEditor) {
        return null;
      }
      if (cypherEditor.editor) {
        return cypherEditor.editor.getValue();
      }
      return cypherEditor.pendingEditorContent !== undefined ? cypherEditor.pendingEditorContent : null;
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

    // ---- Notebook sidebar delegation -------------------------------------
    // The notebook sidebar is owned by MainLayout but its actions (select a
    // pinned/noted entity, save the current canvas as a view, restore a saved
    // view) must act on the live graph, which lives inside a shell cell. These
    // methods bridge MainLayout -> the active cell's ResultGraph, mirroring the
    // existing handleImportInvestigation delegation path.

    // The active cell (or the first cell as a fallback), or null if no cells
    // are mounted. Prefer whichever cell's editor is currently active; fall
    // back to the first cell so the sidebar always has a target (same
    // convention as the import/restore flow, which uses cell 0).
    activeCell() {
      if (this.shellCell.length === 0) return null;
      for (let i = 0; i < this.shellCell.length; i++) {
        const c = this.$refs[this.getCellRef(i)]?.[0];
        if (c && c.isActive && c.isActive()) {
          return c;
        }
      }
      return this.$refs[this.getCellRef(0)]?.[0] || null;
    },

    // The ResultGraph of the active cell, or null if no graph is mounted yet.
    activeResultGraph() {
      const cell = this.activeCell();
      if (!cell) return null;
      const container = cell.$refs[cell.getRefName(0)]?.[0];
      return container?.$refs?.resultGraph || null;
    },

    // Resolve the active cell's ResultGraph for an action that should work on
    // a fresh page, mounting an empty canvas first when no query has run yet
    // (the cell's own ensureResultGraph stub-mount, same as a picked search
    // suggestion). Returns null while a query is in flight — a stub-mount
    // would race the pending response — or when no cell/graph is available.
    async ensureActiveResultGraph() {
      const cell = this.activeCell();
      if (!cell || cell.isLoading) return null;
      return await cell.ensureResultGraph();
    },

    // Each action routes through the unit-tested NotebookSidebarLogic helpers
    // with the resolved ResultGraph as the delegate, and returns { ok, reason }
    // so MainLayout can hand the outcome back to the sidebar for feedback
    // (e.g. "no-graph" when the active cell shows a table / code view).

    // Route a pinned/noted entity click to the active cell's pin-navigation
    // handler (it already handles on-canvas / hidden / off-canvas / not-found).
    // Bootstraps an empty canvas when no query has run yet, so a pin click on
    // a fresh page seeds the graph instead of dead-ending on "no-graph".
    async selectNotebookEntity({ label, pk }) {
      const graph = await this.ensureActiveResultGraph();
      return selectEntityThroughCell(graph, { label, pk });
    },

    // Save the active cell's current canvas as a named saved view. No canvas
    // bootstrap here: with no graph mounted there is nothing to save, and
    // "no-graph" feedback is the honest outcome.
    saveNotebookView(name) {
      return saveViewThroughCell(this.activeResultGraph(), name);
    },

    // Restore a saved view onto the active cell's canvas, bootstrapping an
    // empty canvas first so a saved view opens on a fresh page too.
    async restoreNotebookView(view) {
      const graph = await this.ensureActiveResultGraph();
      return restoreViewThroughCell(graph, view);
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
