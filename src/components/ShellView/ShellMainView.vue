<template>
  <div
    class="shell-main-view__wrapper"
    :class="{ 'is-maximized': maximizedCellIndex !== -1 }"
  >
    <div v-if="maximizedCellIndex < 0 && !isReadOnly">
      <div class="d-flex align-items-center gap-3 m-4">
        <button
          type="button"
          class="btn btn-link text-body p-0 text-decoration-none"
          @click="addCell"
        >
          + Click here to add a new cell
        </button>
        <div class="flex-grow-1 border-top border-secondary" />
      </div>
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
  }),
  computed: {
    isReadOnly() {
      return this.modeStore.isReadOnly;
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
    this.$nextTick(() => {
      this.loadDemoCell();
    });
    document.addEventListener("keydown", this.handleKeyDown);
    this.loadCellsFromHistory();
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
      return Axios.delete(`/api/session/history/${uuid}`).catch((error) => {
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
    loadDemoCell() {
      this.$nextTick(() => {
        const cell = this.$refs[this.getCellRef(0)][0]
        cell.loadEditorFromHistory({
          cypherQuery: `// Query to retrieve 5 relationships from the graph.
// ▶️ Run this query by clicking the play button or pressing Shift + Enter.
MATCH (a)-[r]->(b) RETURN * LIMIT 5;`,
          isQueryGenerationMode: false,
          gptQuestion: "",
        });
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
  },

}
</script>

<style lang="scss" scoped>
.shell-main-view__wrapper {
  width: 100%;
  height: 100%;
  overflow-y: auto;

  &.is-maximized {
    overflow-y: hidden;
    margin-bottom: 2px;
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
