<template>
  <div
    v-if="suggestions.length > 0"
    class="autocomplete-dropdown"
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
      {{ suggestion }}
    </div>
  </div>
</template>

<script>
export default {
  name: "AutocompleteDropdown",
  props: {
    suggestions: {
      type: Array,
      required: true,
    },
    selectedIndex: {
      type: Number,
      default: -1,
    },
  },
  emits: ["select", "hover"],
};
</script>

<style lang="scss" scoped>
.autocomplete-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1000;
  max-height: 200px;
  overflow-y: auto;
  background-color: var(--bs-body-bg);
  border: 1px solid var(--bs-body-inactive);
  border-radius: 0.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  margin-top: 2px;
}

.autocomplete-item {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover,
  &.selected {
    background-color: var(--bs-primary);
    color: var(--bs-white);
  }
}
</style>
