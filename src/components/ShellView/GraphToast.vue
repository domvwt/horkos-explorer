<template>
  <div
    v-if="message"
    class="graph-toast"
    :style="{ right: rightPosition + 'px' }"
  >
    <div class="toast-content">
      <i class="fa-solid fa-info-circle" />
      <span>{{ message }}</span>
    </div>
    <button
      class="toast-close"
      @click="$emit('dismiss')"
    >
      <i class="fa-solid fa-times" />
    </button>
  </div>
</template>

<script>
export default {
  name: "GraphToast",
  props: {
    message: {
      type: String,
      default: null,
    },
    rightPosition: {
      type: Number,
      default: 16,
    },
  },
  emits: ['dismiss'],
};
</script>

<style lang="scss" scoped>
.graph-toast {
  position: absolute;
  top: 1rem;
  background-color: var(--bs-body-bg-secondary);
  border: 1px solid var(--bs-body-bg-accent);
  border-radius: 0.375rem;
  padding: 0.75rem 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: 400px;
  animation: slideInRight 0.3s ease-out;

  @keyframes slideInRight {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .toast-content {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    color: var(--bs-body-text);

    i {
      color: var(--bs-body-bg-accent);
      font-size: 1rem;
      flex-shrink: 0;
    }

    span {
      font-size: 0.85rem;
      line-height: 1.3;
    }
  }

  .toast-close {
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.125rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    transition: background-color 0.2s, color 0.2s;

    &:hover {
      background-color: var(--bs-body-bg-hover);
      color: var(--bs-body-text);
    }

    i {
      font-size: 0.875rem;
    }
  }
}
</style>
