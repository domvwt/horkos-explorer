<template>
  <div
    v-if="suggestions.length > 0"
    class="autocomplete-dropdown"
    :style="rootStyle"
    role="listbox"
  >
    <div
      v-for="(suggestion, index) in suggestions"
      :key="index"
      class="autocomplete-item"
      :class="{ selected: index === selectedIndex }"
      role="option"
      :aria-selected="index === selectedIndex"
      @click="$emit('select', suggestion)"
      @mouseenter="$emit('hover', index)"
    >
      <div class="autocomplete-item__name">{{ suggestion.name }}</div>
      <div
        v-if="suggestion.detail"
        class="autocomplete-item__detail"
      >
        {{ suggestion.detail }}
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "AutocompleteDropdown",
  props: {
    // Suggestion objects: { name, detail?, clusterId?, canonicalName? }
    suggestions: {
      type: Array,
      required: true,
    },
    selectedIndex: {
      type: Number,
      default: -1,
    },
    // Viewport coordinates { top, left, width, maxHeight } for fixed
    // positioning (used when teleported to body so overflow ancestors
    // can't clip the list). Omit to position against the nearest
    // relative parent.
    position: {
      type: Object,
      default: null,
    },
  },
  emits: ["select", "hover"],
  computed: {
    rootStyle() {
      if (!this.position) return null;
      return {
        position: "fixed",
        top: `${this.position.top}px`,
        left: `${this.position.left}px`,
        width: `${this.position.width}px`,
        right: "auto",
        maxHeight: `${this.position.maxHeight}px`,
        marginTop: "0",
      };
    },
  },
};
</script>

<style lang="scss" scoped>
.autocomplete-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1000;
  max-height: 260px;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--bs-body-bg);
  border: 1px solid var(--bs-body-inactive);
  border-radius: 0.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  margin-top: 2px;
}

.autocomplete-item {
  padding: 0.375rem 0.75rem;
  cursor: pointer;

  &:hover,
  &.selected {
    background-color: var(--bs-primary);
    color: var(--bs-white);

    .autocomplete-item__detail {
      color: var(--bs-white);
      opacity: 0.8;
    }
  }
}

.autocomplete-item__name {
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.autocomplete-item__detail {
  font-size: 0.7rem;
  color: var(--bs-secondary-color, #6c757d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
