<template>
  <div>
    <div
      v-if="tooltipVisible"
      class="result-graph__graph-tooltip"
      :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
    >
      <div class="result-graph__tooltip-header">
        <h5>{{ hoveredIsNode ? 'Node' : 'Rel' }} Properties</h5>
      </div>
      <div class="result-graph__properties-list">
        <div
          v-for="property in hoveredProperties"
          :key="property.name"
          class="property-item"
          :class="{ 'property-item--label': property.isLabel }"
        >
          <div class="property-name">
            <span class="property-label">{{ property.name }}</span>
            <span
              v-if="property.isPrimaryKey"
              class="badge bg-primary pk-badge"
            >PK</span>
          </div>
          <div class="property-value">
            <span class="value-text">{{ property.value }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="js">
import { useSettingsStore } from "../../store/SettingsStore";
import { mapStores } from 'pinia'
import ValueFormatter from "../../utils/ValueFormatter";

export default {
  props: {
    schema: {
      type: Object,
      required: true
    }
  },
  data: () => ({
    tooltipVisible: false,
    tooltipX: 0,
    tooltipY: 0,
    hoveredLabel: "",
    hoveredProperties: [],
    hoveredIsNode: false,
    debounceTimeout: null,
    debounceDelay: 150,
  }),
  computed: {
    ...mapStores(useSettingsStore)
  },
  methods: {
    getColor(label) {
      return this.settingsStore.colorForLabel(label);
    },
    handleHover(model, event) {
      const data = model.data;
      const label = data.properties._label;
      this.hoveredLabel = label;
      this.hoveredProperties = ValueFormatter.filterAndBeautifyProperties(data.properties, this.schema);
      this.hoveredIsNode = !(data.properties._src && data.properties._dst);
      this.showTooltip(event);
    },
    resetHover() {
      this.hoveredLabel = "";
      this.hoveredProperties = [];
      this.hoveredIsNode = false;
      this.hideTooltip();
    },
    showTooltip(event) {
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
      }
      this.debounceTimeout = setTimeout(() => {
        this.tooltipX = event.viewport.x + 10;
        this.tooltipY = event.viewport.y + 20;
        this.tooltipVisible = true;
      }, this.debounceDelay);
    },
    hideTooltip() {
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
      }
      this.tooltipVisible = false;
      this.tooltipX = 0;
      this.tooltipY = 0;
    },
  }
}


</script>

<style lang="scss" scoped>
.result-graph__graph-tooltip {
  position: absolute;
  z-index: 1000;
  background-color: var(--bs-body-bg-secondary);
  border: 1px solid var(--bs-body-inactive);
  border-radius: 0.5rem;
  padding: 1rem;
  pointer-events: none;
  max-width: 350px;
  color: var(--bs-body-color);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

  .result-graph__tooltip-header {
    margin-bottom: 0.75rem;

    h5 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--bs-body-text);
    }
  }

  .result-graph__properties-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    .property-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      background-color: var(--bs-body-bg);
      border-radius: 0.375rem;
      padding: 0.375rem 0.5rem;
      min-height: 28px;

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
      text-align: right;
      flex: 1;
      min-width: 0;

      .value-text {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }
}
</style>
