<template>
  <div>
    <div>
      <div class="d-flex justify-content-between">
        <h5>Node Tables</h5>
      </div>
      <hr>
      <table
        v-if="schema"
        class="table table-sm table-borderless schema_side-panel__overview-table"
      >
        <tbody>
          <tr
            v-for="nodeTable in schema.nodeTables"
            :key="nodeTable.name"
          >
            <td scope="row">
              <span
                class="badge bg-[var(--bs-body-accent)]"
                :style="chipStyle(getColor(nodeTable.name))"
              >{{
                nodeTable.name }}</span>
              <br>
              <small>
                {{ nodeTable.properties.length }} properties
              </small>
            </td>
          </tr>
          <tr v-if="schema.nodeTables.length === 0">
            <td colspan="2">
              There are no node tables in this schema.
            </td>
          </tr>
        </tbody>
      </table>
      <br>
    </div>

    <div>
      <div class="d-flex justify-content-between">
        <h5>Relationship Tables</h5>
      </div>
      <hr>
      <table
        v-if="schema"
        class="table table-sm table-borderless schema_side-panel__overview-table"
      >
        <tbody>
          <tr
            v-for="relTable in schema.relTables"
            :key="relTable.name"
          >
            <td
              scope="row"
              :colspan="relTable.group ? 2 : 1"
            >
              <span
                class="badge bg-[var(--bs-body-accent)]"
                :style="chipStyle(getColor(relTable.name))"
              >
                {{ relTable.name }}</span>
              <br>
              <small>
                {{ relTable.properties.length }}
                {{ relTable.properties.length <= 1 ? "property" : "properties" }} </small>
              <small v-if="relTable.group">
                &nbsp;&nbsp; <b>{{ relTable.group }} </b> group
              </small>
            </td>
          </tr>
          <tr v-if="schema.relTables.length === 0">
            <td colspan="2">
              There are no relationship tables in this schema.
            </td>
          </tr>
        </tbody>
      </table>
      <br>
    </div>
  </div>
</template>

<script lang="js">
import { useSettingsStore } from "../../store/SettingsStore";
import { mapStores } from 'pinia'
import { chipStyle } from "../../utils/ChipContrast";
export default {
  name: "SchemaSidebarOverview",
  props: {
    schema: {
      type: Object,
      required: true,
    },
  },
  computed: {
    ...mapStores(useSettingsStore)
  },
  methods: {
    // Theme-adaptive chip wash for entity colours (shared util).
    chipStyle,
    getColor(label) {
      return this.settingsStore.colorForLabel(label);
    },
  },
};
</script>

<style scoped lang="scss">
.schema_side-panel__overview-table-buttons-container {
  width: 90px;
  text-align: center;
  vertical-align: middle;

  &.schema_side-panel__overview-rel-groups-buttons-container {
    width: 50px;
  }
}

.schema_side-panel__overview-table {

  border-radius: 1rem;
  padding: 2px;
}

btn {
  background: var(--bs-body-accent);
}

small {
  padding-left: 6px;
}

ul {
  margin-bottom: 4px;
}

/* Chip ink comes from the inline chipStyle() binding — no forced colour. */
.badge {
  display: inline-block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>
