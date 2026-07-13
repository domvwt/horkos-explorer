import { defineStore } from "pinia";
import chroma from 'chroma-js';
import Axios from "@/utils/AxiosWrapper";
import {
  SHOW_REL_LABELS_OPTIONS,
} from "../utils/Constants";
import G6Utils from "../utils/G6Utils";

const COLOR_PALETTE = [
  "#76b7b2", // teal
  "#9c755f", // brown
  "#e58d96", // pink
  "#d5b441", // yellow
  "#af7aa1", // purple
  "#d97f27", // orange
  "#e15759", // red
  "#59a14f", // green
  "#4e79a7", // blue
];

// Fixed color mappings for Horkos entity types (colorblind-friendly)
const ENTITY_TYPE_COLORS = {
  "Person": "#76b7b2",
  "Company": "#d97f27",
  "Address": "#af7aa1",
};

function randomChromaColor() {
  const randomSaturation = Math.random() * 0.2 + 0.6;  //Sets saturation to a random value between 0.6 and 0.8
  const randomLightness = Math.random() * 0.2 + 0.6;   //Sets lightness to a random value between 0.6 and 0.8
  return chroma.random().set('hsl.s', randomSaturation).set('hsl.l', randomLightness).hex();
}

const NULL_COLOR = "#d9d9d9";
const DEFAULT_NUMBER_OF_NODES_TO_EXPAND = 50;
const DEFAULT_NUMBER_OF_NODES_WITH_LABELS = 200;

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    graphViz: {
      default: {
        node: {
          labelCfg: {
            style: {
              fontSize: 12,
              fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
              fontWeight: 300,
              fill: "#ffffff",
            },
          },
          size: 75,
          style: {
            lineWidth: 3,
            fill: "#FF0000",
          },
        },
        rel: {
          size: 3,
          opacity: 1,
          style: {
            endArrow: {
              path: 'M 0,0 L 8,4 L 8,-4 Z',
              fill: "#e2e2e2",
            },
            stroke: "#e2e2e2",
          },
          labelCfg: {
            style: {
              fontSize: 12,
              fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
              fontWeight: 300,
              background: {
                fill: "#ffffff",
                padding: [2, 2, 2, 2],
                radius: 2,
              },
            },
            autoRotate: true,
          },
        },
      },
      nodes: {},
      rels: {},
    },
    performance: {
      maxNumberOfNodes: 500,
      maxNumberOfNodesWithLabels: DEFAULT_NUMBER_OF_NODES_WITH_LABELS,
      maxNumberOfNodesToExpand: DEFAULT_NUMBER_OF_NODES_TO_EXPAND,
    },
    tableView: {
      rowsPerPage: 10,
    },
    schemaView: {
      showRelLabels: SHOW_REL_LABELS_OPTIONS.ALWAYS,
    },
    colors: COLOR_PALETTE,
    graphLayout: 'd3-force',
  }),

  getters: {
    graphVizSettings(state) {
      return state.graphViz;
    },
    colorForLabel(state) {
      return (label) => {
        if (!label) {
          return NULL_COLOR;
        }
        const node = state.graphViz.nodes[label];
        if (node) {
          return node.g6Settings.style.fill;
        }
        const rel = state.graphViz.rels[label];
        if (rel) {
          return rel.g6Settings.style.stroke;
        }
        return NULL_COLOR;
      };
    },
    settingsForLabel(state) {
      return (label) => {
        if (!label) {
          return null;
        }
        const node = state.graphViz.nodes[label];
        if (node) {
          return node;
        }
        const rel = state.graphViz.rels[label];
        if (rel) {
          return rel;
        }
        return null;
      };
    },
    defaultNode(state) {
      return state.graphViz.default.node;
    },
    defaultRel(state) {
      return state.graphViz.default.rel;
    },
    allSettings(state) {
      return {
        graphViz: state.graphViz,
        performance: state.performance,
        tableView: state.tableView,
        schemaView: state.schemaView,
        graphLayout: state.graphLayout,
      };
    },
  },

  actions: {
    initDefaultNode(node) {
      const nodeDefault = this.graphViz.default.node;
      const name = node.name;
      const g6Settings = JSON.parse(JSON.stringify(nodeDefault));

      let color;
      if (ENTITY_TYPE_COLORS[name]) {
        color = ENTITY_TYPE_COLORS[name];
      } else {
        color = this.colors.pop();
        if (!color) {
          color = randomChromaColor();
        }
      }

      g6Settings.style.fill = color;
      g6Settings.style.stroke = G6Utils.shadeColor(color);

      // Special handling for Address nodes - use "full" property
      let label = "name";
      if (name === "Address") {
        const hasFullProperty = node.properties.some((p) => p.name === "full");
        if (hasFullProperty) {
          label = "full";
        }
      } else {
        // Prefer "name" property if it exists, otherwise use primary key
        const hasNameProperty = node.properties.some((p) => p.name === "name");
        if (!hasNameProperty) {
          let primaryKey = node.properties.filter((p) => p.isPrimaryKey)[0];
          if (!primaryKey) {
            primaryKey = node.properties[0];
          }
          label = primaryKey.name;
        }
      }

      const nodeSettings = {
        name,
        g6Settings,
        label,
      };
      return nodeSettings;
    },

    initDefaultRel(rel) {
      const relDefault = this.graphViz.default.rel;
      const name = rel.name;
      const g6Settings = JSON.parse(JSON.stringify(relDefault));
      const label = "_label";
      const relSettings = {
        name,
        g6Settings,
        label,
      };
      return relSettings;
    },

    initSettings(schema, storedSettings) {
      const storedSettingsCopy = JSON.parse(JSON.stringify(storedSettings));
      if (storedSettingsCopy.graphViz) {
        this.graphViz = storedSettingsCopy.graphViz;
      }
      if (storedSettingsCopy.performance) {
        if (!storedSettingsCopy.performance.maxNumberOfNodesToExpand) {
          // Migrate old settings
          storedSettingsCopy.performance.maxNumberOfNodesToExpand =
            DEFAULT_NUMBER_OF_NODES_TO_EXPAND;
        }
        if(!storedSettingsCopy.performance.maxNumberOfNodesWithLabels) {
          // Migrate old settings
          storedSettingsCopy.performance.maxNumberOfNodesWithLabels = 200;
        }
        this.performance = storedSettingsCopy.performance;
      }
      if (storedSettingsCopy.tableView) {
        this.tableView = storedSettingsCopy.tableView;
      }
      if (storedSettingsCopy.schemaView) {
        this.schemaView = storedSettingsCopy.schemaView;
      }
      if (storedSettingsCopy.colors) {
        this.colors = storedSettingsCopy.colors;
      }
      if (storedSettingsCopy.graphLayout) {
        this.graphLayout = storedSettingsCopy.graphLayout;
      }
      // The schema may be changed outside of Kuzu Explorer, so we reset the
      // graphViz settings and merge the stored settings with current schema.
      this.graphViz.nodes = {};
      this.graphViz.rels = {};
      const storedGraphViz = storedSettings.graphViz || { nodes: {}, rels: {} };
      schema.nodeTables.forEach((node) => {
        const nodeSettings =
          storedGraphViz.nodes[node.name] || this.initDefaultNode(node);
        this.graphViz.nodes[node.name] = nodeSettings;
        // Migrate old settings
        this.graphViz.nodes[node.name].g6Settings.style.stroke =
          G6Utils.shadeColor(
            this.graphViz.nodes[node.name].g6Settings.style.fill
          );
        this.graphViz.nodes[node.name].g6Settings.style.lineWidth = 3;

        // Migrate label from primary key to "name" if name property exists and label is currently "_label" or "id"
        // Special case: Address nodes should use "full" property
        const currentLabel = this.graphViz.nodes[node.name].label;
        if (node.name === "Address") {
          const hasFullProperty = node.properties.some((p) => p.name === "full");
          if (hasFullProperty && (currentLabel === "_label" || currentLabel === "id" || currentLabel === "name")) {
            this.graphViz.nodes[node.name].label = "full";
          }
        } else {
          const hasNameProperty = node.properties.some((p) => p.name === "name");
          if (hasNameProperty && (currentLabel === "_label" || currentLabel === "id")) {
            this.graphViz.nodes[node.name].label = "name";
          }
        }
      });

      schema.relTables.forEach((rel) => {
        const relSettings =
          storedGraphViz.rels[rel.name] || this.initDefaultRel(rel);
        this.graphViz.rels[rel.name] = relSettings;
        // Migrate old settings
        if (!this.graphViz.rels[rel.name].g6Settings.style.endArrow) {
          this.graphViz.rels[rel.name].g6Settings.style.endArrow = {
            path: 'M 0,0 L 8,4 L 8,-4 Z',
            fill: "transparent",
          };
        }
        this.graphViz.rels[rel.name].g6Settings.style.startArrow = false;
        if (
          !this.graphViz.rels[rel.name].g6Settings.labelCfg.style.background
        ) {
          this.graphViz.rels[rel.name].g6Settings.labelCfg.style.background = {
            fill: "#FFFFFF",
            padding: [2, 2, 2, 2],
            radius: 2,
          };
        }
        this.graphViz.rels[rel.name].g6Settings.labelCfg.style.fontWeight = 300;
      });
      this.uploadSettings();
    },

    updateSettings(settings) {
      this.graphViz = settings.graphViz;
      this.performance = settings.performance;
      this.tableView = settings.tableView;
      this.schemaView = settings.schemaView;
      if (settings.graphLayout) {
        this.graphLayout = settings.graphLayout;
      }
      this.uploadSettings();
    },

    setGraphLayout(layout) {
      this.graphLayout = layout;
      this.uploadSettings();
    },

    handleSchemaReload(schema) {
      const nodeTables = new Set(schema.nodeTables.map((node) => node.name));
      for (let table in this.graphViz.nodes) {
        if (!nodeTables.has(table)) {
          delete this.graphViz.nodes[table];
        }
      }
      schema.nodeTables.forEach((node) => {
        if (!this.graphViz.nodes[node.name]) {
          const nodeSettings = this.initDefaultNode(node);
          this.graphViz.nodes[node.name] = nodeSettings;
        }
      });
      const relTables = new Set(schema.relTables.map((rel) => rel.name));
      for (let table in this.graphViz.rels) {
        if (!relTables.has(table)) {
          delete this.graphViz.rels[table];
        }
      }
      schema.relTables.forEach((rel) => {
        if (!this.graphViz.rels[rel.name]) {
          const relSettings = this.initDefaultRel(rel);
          this.graphViz.rels[rel.name] = relSettings;
        }
      });
      this.uploadSettings();
    },

    addNewNodeTable(name) {
      const nodeDefault = this.graphViz.default.node;
      const g6Settings = JSON.parse(JSON.stringify(nodeDefault));

      let color;
      if (ENTITY_TYPE_COLORS[name]) {
        color = ENTITY_TYPE_COLORS[name];
      } else {
        color = this.colors.pop();
        if (!color) {
          color = randomChromaColor();
        }
      }

      g6Settings.style.fill = color;
      const nodeSettings = {
        name,
        g6Settings,
        label: "name",
      };
      this.graphViz.nodes[name] = nodeSettings;
    },

    addNewRelTable(name) {
      const relDefault = this.graphViz.default.rel;
      const g6Settings = JSON.parse(JSON.stringify(relDefault));
      const relSettings = {
        name,
        g6Settings,
        label: "_label",
      };
      this.graphViz.rels[name] = relSettings;
    },

    removeNodeTable(label) {
      delete this.graphViz.nodes[label];
    },

    updateNodeTableLabel(name, label) {
      const node = this.graphViz.nodes[name];
      if (node) {
        node.label = label;
      }
    },

    removeRelTable(label) {
      delete this.graphViz.rels[label];
    },

    loadSettingsFromLocalStorage() {
      const settings = localStorage.getItem("settings");
      if (settings) {
        return JSON.parse(settings);
      }
      return {};
    },

    async uploadSettings() {
      const settings = JSON.parse(JSON.stringify(this.allSettings));
      settings.colors = this.colors;
      try {
        localStorage.setItem("settings", JSON.stringify(settings));
      } catch (error) {
        // localStorage full or unavailable — nothing else we can safely do,
        // and it must never throw into the calling UI handler.
        console.warn("[SettingsStore] Failed to persist settings:", error.message);
      }
      try {
        const response = await Axios.post("/api/session/settings", settings)
        return response.data;
      } catch (error) {
        // Ignore the error
      }
    },
  },
});
