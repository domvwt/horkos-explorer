<template>
  <div
    class="result-table__wrapper"
    :style="{ height: containerHeight }"
  >
    <p
      v-if="truncatedCaption"
      class="result-table__truncated-caption"
    >
      {{ truncatedCaption }}
    </p>
    <div
      v-if="totalPages > 1"
      class="result-table__pagination__wrapper"
    >
      <nav>
        <ul class="pagination">
          <li :class="['page-item', { disabled: isPrevDisabled }]">
            <a
              class="page-link"
              href="#"
              @click="page -= 1"
            >
              <span>&laquo;</span>
            </a>
          </li>
          <li
            v-for="currPage in pageList"
            :key="currPage"
            :class="['page-item', { active: currPage === page }]"
          >
            <a
              v-if="currPage > 0"
              class="page-link"
              href="#"
              @click="page = currPage"
            >
              {{ currPage }}
            </a>
            <span
              v-else
              class="page-link"
            >...</span>
          </li>
          <li :class="['page-item', { disabled: isNextDisabled }]">
            <a
              class="page-link"
              href="#"
              @click="page += 1"
            >
              <span>&raquo;</span>
            </a>
          </li>
        </ul>
      </nav>
    </div>

    <div class="result-table__table__wrapper">
      <table class="table table-hover">
        <thead class="fixed-top">
          <tr>
            <th
              v-for="header in tableHeaders"
              :key="header.text"
            >
              {{ header.text }}
              <span class="badge bg-[var(--bs-body-accent)]">{{ header.type }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in rows"
            :key="i"
          >
            <td
              v-for="(cell, j) in row"
              :key="j"
              :style="{ 'white-space': 'pre-wrap' }"
            >
              <div
                v-if="Array.isArray(cell)"
                class="result-table__node-cell"
              >
                <ul class="list-group">
                  <li
                    v-for="(item, k) in cell"
                    :key="k"
                    class="list-group-item"
                  >
                    <b>{{ item.name }}:</b> {{ item.value }}
                  </li>
                </ul>
                <button
                  v-if="pinMetaFor(i, j)"
                  type="button"
                  class="result-table__pin-toggle"
                  :class="{ 'result-table__pin-toggle--pinned': isCellPinned(pinMetaFor(i, j)) }"
                  :aria-label="isCellPinned(pinMetaFor(i, j)) ? 'Unpin entity' : 'Pin entity'"
                  :aria-pressed="isCellPinned(pinMetaFor(i, j)) ? 'true' : 'false'"
                  :title="isCellPinned(pinMetaFor(i, j)) ? 'Unpin from notebook' : 'Pin to notebook'"
                  @click="togglePin(pinMetaFor(i, j))"
                >
                  <i
                    class="fa-star"
                    :class="isCellPinned(pinMetaFor(i, j)) ? 'fa-solid' : 'fa-regular'"
                  />
                </button>
              </div>
              <div
                v-else-if="isColumnRecursiveRel(j)"
                class="result-table__recursive-rel__wrapper"
              >
                <div
                  v-for="(subcolumn, subcolumnId) in cell"
                  :key="subcolumnId"
                >
                  <div
                    v-for="(item, k) in subcolumn"
                    :key="k"
                  >
                    <ul class="list-group">
                      <li
                        v-for="(field, m) in item"
                        :key="m"
                        class="list-group-item"
                      >
                        <b>{{ m === 0 ? field.value : field.name + ":" }}</b>
                        <span v-if="m > 0">{{ field.value }}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
              <span v-else>{{ cell }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script lang="js">
import ValueFormatter from "../../utils/ValueFormatter";
import { UI_SIZE, DATA_TYPES } from "../../utils/Constants";
import { useSettingsStore } from "../../store/SettingsStore";
import { useNotebookStore } from "../../store/NotebookStore";
import { nodeCellPinMeta } from "../../utils/NodeCellPin";
import { mapStores } from 'pinia'
export default {
  name: "ResultTable",
  props: {
    queryResult: {
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
      default: "auto"
    },
  },
  data: () => ({
    page: 1,
    maxLength: 8,
    rows: [],
    // Parallel to `rows`: pin metadata { label, pk, name } for NODE cells,
    // null for every other cell. Rides alongside the displayed value so the
    // rendered cell text stays byte-identical while carrying the label+pk a
    // pin toggle needs.
    rowMeta: [],
    tableHeaders: [],
    tableWidth: 0,
  }),
  computed: {
    totalPages() {
      const numRows = this.queryResult ? this.queryResult.rows.length : 0;
      return Math.ceil(numRows / this.itemsPerPage);
    },
    pageList() {
      const page = this.page;
      const totalPages = this.totalPages;
      const maxLength = this.maxLength;
      const range = (start, end) => {
        return Array.from(Array(end - start + 1), (_, i) => i + start);
      }

      const sideWidth = maxLength < 9 ? 1 : 2;
      const leftWidth = (maxLength - sideWidth * 2 - 3) >> 1;
      const rightWidth = (maxLength - sideWidth * 2 - 2) >> 1;
      if (totalPages <= maxLength) {
        return range(1, totalPages);
      }
      if (page <= maxLength - sideWidth - 1 - rightWidth) {
        return range(1, maxLength - sideWidth - 1)
          .concat(0, range(totalPages - sideWidth + 1, totalPages));
      }
      if (page >= totalPages - sideWidth - 1 - rightWidth) {
        return range(1, sideWidth)
          .concat(0, range(totalPages - sideWidth - 1 - rightWidth - leftWidth, totalPages));
      }
      return range(1, sideWidth)
        .concat(0, range(page - leftWidth, page + rightWidth),
          0, range(totalPages - sideWidth + 1, totalPages));
    },
    isPrevDisabled() {
      return this.page === 1;
    },
    isNextDisabled() {
      return this.page === this.totalPages;
    },
    itemsPerPage() {
      return this.settingsStore && this.settingsStore.tableView ? this.settingsStore.tableView.rowsPerPage : 10;
    },
    // queryResult.truncated is the response-level flag /api/cypher sets when
    // the server cut the result to KUZU_QUERY_SIZE_LIMIT rows (see
    // processSingleResult in src/server/Cypher.js) — distinct from the
    // per-result `truncated` NeighborsFetcher/ConnectedEntitiesPanel use for
    // neighbour-expansion caps. Only rendered when the server actually
    // truncated the response, so a normal result stays byte-identical.
    truncatedCaption() {
      if (!this.queryResult || !this.queryResult.truncated) {
        return "";
      }
      const shownRows = this.queryResult.rows.length;
      return `Truncated to ${shownRows} rows by the server limit`;
    },
    ...mapStores(useSettingsStore, useNotebookStore),
  },
  watch: {
    page() {
      this.renderTable();
    },
    itemsPerPage(newVal, oldVal) {
      if (newVal > oldVal) {
        const numberOfPagesNew = Math.ceil(this.queryResult.rows.length / newVal);
        if (this.page > numberOfPagesNew) {
          this.page = numberOfPagesNew;
        }
      }
      this.renderTable();
    }
  },
  mounted() {
    this.computeTableWidth();
    window.addEventListener("resize", this.computeTableWidth);
  },
  beforeUnmount() {
    window.removeEventListener("resize", this.computeTableWidth);
  },
  methods: {
    isColumnRecursiveRel(columnIndex) {
      return this.tableHeaders[columnIndex].type === DATA_TYPES.RECURSIVE_REL;
    },
    // Pin metadata { label, pk, name } for the cell at (rowIndex, columnIndex),
    // or null when the cell is not a pinnable node.
    pinMetaFor(rowIndex, columnIndex) {
      const rowMeta = this.rowMeta[rowIndex];
      return rowMeta ? rowMeta[columnIndex] || null : null;
    },
    // Reactive derivation from the store, so pins made elsewhere (graph panel,
    // notebook sidebar) light up the table's star immediately, and unpinning
    // there clears it.
    isCellPinned(meta) {
      return meta ? this.notebookStore.isPinned(meta.label, meta.pk) : false;
    },
    togglePin(meta) {
      if (!meta) {
        return;
      }
      this.notebookStore.togglePin(meta.label, meta.pk, meta.name);
    },
    renderTable() {
      if (!this.queryResult) {
        return;
      }
      this.tableHeaders = [];
      this.rows = [];
      this.rowMeta = [];
      if (this.queryResult.rows.length === 0) {
        return;
      }
      const tableFields = Object.keys(this.queryResult.rows[0]);
      const tableTypes = this.queryResult.dataTypes;
      tableFields.forEach((field) => {
        this.tableHeaders.push({
          text: field,
          type: tableTypes[field],
        });
      });
      const numRows = this.queryResult.rows.length;
      const start = (this.page - 1) * this.itemsPerPage;
      const end = Math.min(start + this.itemsPerPage, numRows);
      const rowsForPage = this.queryResult.rows.slice(start, end);
      rowsForPage.forEach((row) => {
        const cells = [];
        const meta = [];
        for (let key in row) {
          if (row[key] === null || row[key] === undefined) {
            cells.push('NULL');
            meta.push(null);
          }
          else if (tableTypes[key] === DATA_TYPES.RECURSIVE_REL) {
            // Value is a recursive relationship
            cells.push(ValueFormatter.beautifyRecursiveRelValue(row[key], this.schema));
            meta.push(null);
          }
          else if (tableTypes[key] === DATA_TYPES.NODE || tableTypes[key] === DATA_TYPES.REL) {
            // Value is a node or relationship
            const beautified = ValueFormatter.filterAndBeautifyProperties(row[key], this.schema);
            cells.push(beautified);
            // Only NODE cells are pinnable; the raw value carries the `_label`
            // the beautified list keeps only as a display name, so derive pin
            // metadata from the raw value here.
            meta.push(
              tableTypes[key] === DATA_TYPES.NODE
                ? nodeCellPinMeta(row[key], beautified)
                : null
            );
          }
          else {
            // Value is a primitive type
            cells.push(ValueFormatter.beautifyValue(row[key], tableTypes[key]));
            meta.push(null);
          }
        }
        this.rows.push(cells);
        this.rowMeta.push(meta);
      });
    },

    computeTableWidth() {
      let mainContainerWidth = document.documentElement.clientWidth;
      mainContainerWidth -= UI_SIZE.DEFAULT_MARGIN * 2;
      mainContainerWidth -= UI_SIZE.SHELL_TOOL_BAR_WIDTH;

      this.tableWidth = mainContainerWidth;

      return mainContainerWidth;
    },
  },
};
</script>

<style lang="scss" scoped>
.result-table__wrapper {
  /* Width is set by style binding from tableWidth */
  width: v-bind(tableWidth)px;
  /* Use v-bind to link to the data property */
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.result-table__truncated-caption {
  font-size: 0.85rem;
  color: var(--bs-body-text-secondary);
  margin: 0 0 0.5rem;
}

.result-table__pagination__wrapper {
  display: flex;
  justify-content: center;
  align-items: center;

  nav {
    padding-top: 8px;
    padding-bottom: 8px;

    ul {
      margin-bottom: 0;
    }
  }
}

.result-table__node-cell {
  display: flex;
  align-items: flex-start;
  gap: 0.25rem;
}

.result-table__node-cell .list-group {
  flex: 1;
  min-width: 0;
}

.result-table__pin-toggle {
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: 2px;
  padding: 2px 4px;
  border: 0;
  background: transparent;
  color: var(--bs-body-inactive);
  cursor: pointer;
  line-height: 1;
  /* Hidden until the row is hovered; the pinned state overrides this below so a
     pinned entity's star is always visible. */
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

tr:hover .result-table__pin-toggle {
  opacity: 1;
}

.result-table__pin-toggle:hover,
.result-table__pin-toggle:focus-visible {
  opacity: 1;
  color: var(--bs-warning, #d5b441);
}

.result-table__pin-toggle--pinned {
  opacity: 1;
  color: var(--bs-warning, #d5b441);
}

.result-table__table__wrapper {
  flex: 1;
  overflow-y: scroll;
  overflow-x: auto;
  border-top: 1px solid (var(--bs-body-inactive));
  border-bottom: 1px solid (var(--bs-body-inactive));
  border-radius: 10px;

  table {
    width: 100%;

    thead {
      position: sticky;
      border: 0;
      top: 0;

      th {
        background-color: (var(--bs-body-bg-secondary));
        border-bottom: 0;
      }
    }

    tbody {
      tr {
        border-style: none;
      }
    }

    margin-bottom: 0;

    .result-table__recursive-rel__wrapper {
      display: flex;

      >div {
        flex: 1;

        &:not(:last-child) {
          margin-right: 4px;
        }
      }
    }
  }
}
</style>
