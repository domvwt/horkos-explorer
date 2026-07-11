<template>
  <div>
    <div>
      <h5>
        <span
          class="badge bg-[var(--bs-body-accent)]"
          :style="chipStyle(getColor(label))"
        >
          {{ label }}
        </span>
      </h5>
      <hr>

      <div v-if="!isNode">
        <h6
          v-for="conn in connectivity"
          :key="conn"
        >
          <span
            class="badge bg-[var(--bs-body-accent)]"
            :style="chipStyle(getColor(conn.src))"
          >
            {{ conn.src }}
          </span>
          &nbsp;
          <i class="fa-solid fa-arrow-right" />
          &nbsp;
          <span
            class="badge bg-[var(--bs-body-accent)]"
            :style="chipStyle(getColor(conn.dst))"
          >
            {{ conn.dst }}
          </span>
        </h6>
        <br>
      </div>

      <table
        v-if="schema"
        class="table table-sm table-borderless schema_side-panel__overview-table"
      >
        <thead>
          <tr v-if="tableProperties.length > 0">
            <th scope="col">
              Name
            </th>
            <th scope="col">
              Type
            </th>
          </tr>
          <tr v-else>
            <th scope="col">
              There are no properties in this table
            </th>
          </tr>
        </thead>
        <tbody v-if="tableProperties.length > 0">
          <tr
            v-for="property in tableProperties"
            :key="property.name"
          >
            <td scope="row">
              {{ property.name }}
              <span
                v-if="property.isPrimaryKey"
                class="badge bg-[var(--bs-body-accent)]"
              >
                PK </span>
            </td>
            <td>
              {{ property.type }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script lang="js">
import { useSettingsStore } from "../../store/SettingsStore";
import { mapStores } from 'pinia'
import { chipStyle } from "../../utils/ChipContrast";
export default {
  name: "SchemaSidebarReadOnlyView",
  props: {
    schema: {
      type: Object,
      required: true,
    },
    label: {
      type: String,
      required: true,
    },
    isNode: {
      type: Boolean,
      required: true,
    },
  },
  computed: {
    ...mapStores(useSettingsStore),

    connectivity() {
      if (!this.schema || !this.label || this.isNode) {
        return null;
      }
      return this.schema.relTables.find(t => t.name === this.label).connectivity;
    },

    tableProperties() {
      if (!this.schema || !this.label) {
        return [];
      }
      if (this.isNode) {
        const table = this.schema.nodeTables.find(t => t.name === this.label);
        return table ? table.properties : [];
      } else {
        const table = this.schema.relTables.find(t => t.name === this.label);
        return table ? table.properties : [];
      }
    },
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
.badge {
  display: inline-block;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>
