<template>
  <div
    ref="modal"
    class="modal"
    tabindex="-1"
  >
    <div class="modal-dialog modal-xl">
      <div class="modal-content bg-transparent border-0 border-transparent">
        <div
          v-if="Object.keys(currentSettings).length > 0"
          class="modal-body settings-body"
        >
          <!-- Viewing Options -->
          <h2> Viewing Options </h2>
          <div class="settings-group settings-group-rows">
            <div class="settings-row">
              <h4>Theme</h4>
              <div>
                <button
                  :class="{
                    'active-btn': modeStore.theme === 'vs-light',
                    'inactive-btn': modeStore.theme !== 'vs-light'
                  }"
                  @click="setTheme('vs-light')"
                >
                  Light
                </button>
                <button
                  :class="{
                    'active-btn': modeStore.theme === 'vs-dark',
                    'inactive-btn': modeStore.theme !== 'vs-dark'
                  }"
                  @click="setTheme('vs-dark')"
                >
                  Dark
                </button>
              </div>
            </div>
          </div>
          <hr>

          <!-- Graph Visualization Options -->
          <h2> Graph Visualization Options </h2>

          <!-- Nodes -->
          <h3> Nodes </h3>
          <div class="settings-group">
            <table>
              <thead>
                <tr>
                  <th>
                    Label
                  </th>
                  <th>
                    Color
                  </th>
                  <th>
                    Size (px)
                  </th>
                  <th>
                    Caption
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(node, key, index) in currentSettings.graphViz.nodes"
                  :key="index"
                >
                  <td>
                    {{ node.name }}
                  </td>
                  <td>
                    <input
                      v-model="node.g6Settings.style.fill"
                      type="color"
                      class="form-control form-control-color"
                      title="Choose color for node"
                    >
                  </td>
                  <td>
                    <input
                      v-model="node.g6Settings.size"
                      type="number"
                      class="form-control"
                      min="10"
                      max="200"
                      title="Choose size for node"
                    >
                  </td>
                  <td>
                    <select
                      v-model="node.label"
                      class="form-select"
                    >
                      <option
                        v-for="option in getCaptionOptions(node, true)"
                        :key="option.text"
                        :value="option.value"
                      >
                        {{ option.text }}
                      </option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Relationships -->
          <h3> Relationships </h3>
          <div class="settings-group">
            <table>
              <thead>
                <tr>
                  <th>
                    Label
                  </th>
                  <th>
                    Color
                  </th>
                  <th>
                    Size (px)
                  </th>
                  <th>
                    Caption
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(rel, key, index) in currentSettings.graphViz.rels"
                  :key="index"
                >
                  <td>
                    {{ rel.name }}
                  </td>
                  <td>
                    <input
                      v-model="rel.g6Settings.style.stroke"
                      type="color"
                      class="form-control form-control-color"
                      title="Choose color for rel"
                      @change="syncRelFill(rel)"
                    >
                  </td>
                  <td>
                    <input
                      v-model="rel.g6Settings.size"
                      type="number"
                      class="form-control"
                      min="1"
                      max="20"
                      title="Choose size for rel"
                    >
                  </td>
                  <td>
                    <select
                      v-model="rel.label"
                      class="form-select"
                    >
                      <option
                        v-for="option in getCaptionOptions(rel, false)"
                        :key="option.text"
                        :value="option.value"
                      >
                        {{ option.text }}
                      </option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Performance Options -->
          <h3> Performance Options </h3>
          <div class="settings-group settings-group-rows">
            <div class="settings-row">
              <h4>
                Max number of nodes to draw for graph visualization
              </h4>
              <input
                v-model="currentSettings.performance.maxNumberOfNodes"
                type="number"
                min="1"
                max="2000"
                class="settings-input"
                placeholder="500"
                required
              >
            </div>
            <div class="settings-row">
              <h4>
                Max number of nodes to display labels
              </h4>
              <input
                v-model="currentSettings.performance.maxNumberOfNodesWithLabels"
                type="number"
                min="1"
                max="2000"
                class="settings-input"
                placeholder="200"
                required
              >
            </div>
            <div class="settings-row">
              <h4>
                Max number of nodes to expand on double click
              </h4>
              <input
                v-model="currentSettings.performance.maxNumberOfNodesToExpand"
                type="number"
                min="5"
                max="1000"
                class="settings-input"
                placeholder="50"
                required
              >
            </div>
          </div>
          <hr>

          <!-- Schema View Options -->
          <h2> Schema View Options </h2>
          <div class="settings-group settings-group-rows">
            <div class="settings-row">
              <h4> Show relationship labels </h4>
              <div>
                <button
                  :class="{
                    'active-btn': currentSettings.schemaView.showRelLabels === showRelLabelsOptions.HOVER,
                    'inactive-btn': currentSettings.schemaView.showRelLabels !== showRelLabelsOptions.HOVER
                  }"
                  @click="currentSettings.schemaView.showRelLabels = showRelLabelsOptions.HOVER"
                >
                  On hover or click
                </button>
                <button
                  :class="{
                    'active-btn': currentSettings.schemaView.showRelLabels === showRelLabelsOptions.ALWAYS,
                    'inactive-btn': currentSettings.schemaView.showRelLabels !== showRelLabelsOptions.ALWAYS
                  }"
                  @click="currentSettings.schemaView.showRelLabels = showRelLabelsOptions.ALWAYS"
                >
                  Always
                </button>
              </div>
            </div>
          </div>
          <hr>

          <!-- Table View Options -->
          <h2> Table View Options </h2>
          <div class="settings-group settings-group-rows">
            <div class="settings-row">
              <h4> Number of rows per page </h4>
              <input
                v-model="currentSettings.tableView.rowsPerPage"
                type="number"
                min="1"
                max="500"
                class="settings-input"
                placeholder="10"
                required
              >
            </div>
          </div>
        </div>

        <div class="modal-footer settings-footer d-flex justify-content-end">
          <button
            class="btn btn-secondary"
            @click="hideModal()"
          >
            Close
          </button>
          <button
            class="btn btn-primary"
            @click="saveAndHideModal()"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="js">
import { useSettingsStore } from "../../store/SettingsStore";
import { useModeStore } from "../../store/ModeStore";
import { mapStores } from 'pinia';
import { Modal } from 'bootstrap';
import {
  SHOW_REL_LABELS_OPTIONS,
} from "../../utils/Constants";

export default {
  name: "SettingsMainView",
  props: {
    schema: {
      type: Object,
      required: false,
      default: null,
    },
  },
  emits: ["ready", "settingsSaved"],
  data: () => ({
    currentSettings: {},
    modal: null,
    showRelLabelsOptions: SHOW_REL_LABELS_OPTIONS,
    wasSaved: false,
  }),
  computed: {
    ...mapStores(useSettingsStore, useModeStore),
  },
  mounted() {
    this.modal = new Modal(this.$refs.modal);
    this.$refs.modal.addEventListener('hidden.bs.modal', this.handleModalClose);
    // Tell the parent the modal instance exists: this view is loaded async,
    // so the parent cannot open the modal on a ref it holds before mount.
    this.$emit('ready');
  },
  beforeUnmount() {
    this.$refs.modal.removeEventListener('hidden.bs.modal', this.handleModalClose);
    this.modal.dispose();
  },
  methods: {
    toggleModal() {
      this.modal.toggle();
    },
    showModal() {
      this.copyCurrentSettings();
      this.wasSaved = false;
      this.modal.show();
    },
    hideModal() {
      this.wasSaved = false;
      this.modal.hide();
    },
    copyCurrentSettings() {
      const settingState = this.settingsStore.allSettings;
      this.currentSettings = JSON.parse(JSON.stringify(settingState));
    },
    saveAndHideModal() {
      this.settingsStore.updateSettings(this.currentSettings);
      this.wasSaved = true;
      this.$nextTick(() => {
        this.modal.hide();
      });
    },
    getCaptionOptions(entity, isNode) {
      const name = entity.name;
      const properties = (isNode ? this.schema.nodeTables : this.schema.relTables)
        .find(
          (table) => table.name === name
        ).properties;
      const options = [
        {
          value: "_label",
          text: "(Table Label)",
        },
        {
          value: null,
          text: "(No Caption)",
        }
      ]
      properties.forEach((property) => {
        options.push({
          value: property.name,
          text: property.name,
        });
      });
      return options;
    },
    handleModalClose() {
      // If settings were saved, emit event to redraw all graphs
      if (this.wasSaved) {
        this.$emit('settingsSaved');
      }
      // Reset state
      this.wasSaved = false;
      this.resetSettings();
    },
    resetSettings() {
      // Bootstrap modal can also be closed by clicking outside of the modal.
      // This way ensures that we can get the event when the modal is closed.
      this.currentSettings = {};
    },
    syncRelFill(rel) {
      if (!rel.g6Settings.style.endArrow) {
        rel.g6Settings.style.endArrow = {};
      }
      rel.g6Settings.style.endArrow.fill = rel.g6Settings.style.stroke;
    },
    setTheme(theme) {
      // Save theme preference to cookie
      this.setCookie('themePreference', theme, 365);
      // Update store
      this.modeStore.setTheme(theme);
    },
    setCookie(name, value, days) {
      let expires = "";
      if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
      }
      document.cookie = name + "=" + (value || "") + expires + "; path=/";
    },
  },
}
</script>

<style lang="scss" scoped>
.modal-body {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  border: 0px;
  border-color: transparent;
}

span.pull-left {
  position: absolute;
  left: 12px;
}

.settings-body {
  border-radius: 1rem 1rem 0 0;
  width: 100%;
  background-color: var(--bs-body-bg-secondary);
  border: 1px solid var(--bs-body-inactive);
  padding: 1.25rem;
  max-height: calc(100vh - 200px);
  overflow-y: auto;

  h2 {
    font-weight: 500;
    font-size: 1.25rem;
    margin-bottom: 0.75rem;
  }

  h3 {
    font-weight: 600;
    font-size: 1rem;
    margin-top: 1.25rem;
    margin-bottom: 0.75rem;
  }

  h4 {
    font-weight: 400;
    font-size: 1rem;
    margin: 0;
  }

  span {
    font-weight: 400;
    font-size: 1rem;
  }

  table {
    width: 100%;
    table-layout: auto;
    border-collapse: collapse;
  }

  th {
    padding: 0.5rem 1rem;
    font-size: 1rem;
    font-weight: 500;
  }

  td {
    padding: 0.5rem 1rem;
    font-size: 1rem;
  }

  hr {
    height: 1px;
    margin: 1.25rem 0;
    background-color: var(--bs-body-inactive);
    border: none;
  }

}

.settings-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;

  label {
    color: var(--bs-body-text);
    font-size: 1rem;
    cursor: pointer;
  }

  input {
    appearance: none;
    width: 2.75rem;
    height: 1.25rem;
    background-color: var(--bs-body-bg-secondary);
    border-radius: 9999px;
    cursor: pointer;
    transition: background-color 0.3s;

    &:checked {
      background-color: var(--bs-body-bg-accent);
    }
  }
}


.toggle-switch {
  position: relative;
  display: inline-block;
  width: 2.75rem;
  height: 1.25rem;

}

.settings-group {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-self: flex-start;
  margin-top: 0.5rem;
  border-radius: 1rem;
  padding: 0.5rem 1rem;
  width: 100%;
  background-color: var(--bs-body-bg);
}

.settings-group-rows {
  flex-direction: column;

  .settings-row {
    padding: 0.5rem 1rem;
  }
}

.switch-slider {
  position: absolute;
  top: 0;
  left: 0;
  width: 1.25rem;
  height: 1.25rem;
  background-color: var(--bs-body-inactive);
  border: 1px solid var(--bs-body-inactive);
  border-radius: 9999px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition: transform 0.3s;

  .switch-input:checked+& {
    transform: translateX(1.5rem);
  }
}

.settings-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  border-radius: 1rem;
  padding: 0.5rem 0;
  width: 100%;

  > div:last-child {
    min-width: 200px;
    text-align: right;
  }
}

.settings-input {
  background-color: var(--bs-body-bg);
  border: 1px solid var(--bs-body-inactive);
  color: var(--bs-body-text);
  font-size: 1rem;
  border-radius: 0.5rem;
  padding: 0.375rem 0.75rem;
  width: 200px;
  min-width: 200px;
}

.active-btn {
  background-color: var(--bs-body-bg-accent);
  color: white;
  border-radius: 0.5rem;
  padding: 0.5rem 1rem;
  margin-right: 1rem;
  border: 0px;
}

.inactive-btn {
  background-color: var(--bs-body-bg);
  border-radius: 0.5rem;
  padding: 0.5rem 1rem;
  margin-right: 1rem;
  border: 0px;
}

.settings-footer {
  background-color: var(--bs-body-bg-secondary);
  border: 1px solid var(--bs-body-inactive);
  border-top: none;
  border-radius: 0 0 1rem 1rem;
  display: flex;
  gap: 0.75rem;
  padding: 1.25rem;
}
</style>
