<template>
  <div
    v-if="visible"
    class="share-modal"
    @click.self="$emit('close')"
  >
    <div class="share-modal-content">
      <div class="share-modal-header">
        <h5>Share Investigation</h5>
        <button
          class="btn-close"
          @click="$emit('close')"
        >
          <i class="fa-solid fa-times" />
        </button>
      </div>

      <div class="share-modal-body">
        <p class="share-modal-description">
          Copy this URL to share your investigation. It includes all queries, expanded nodes, and hidden elements.
        </p>

        <!-- URL Size Warning -->
        <div
          v-if="urlTooLarge"
          class="alert alert-warning"
        >
          <i class="fa-solid fa-triangle-exclamation" />
          <strong>Warning:</strong> This URL is very long ({{ urlLength }} chars).
          Some browsers may not support URLs longer than 2000 characters.
        </div>

        <!-- Shareable URL -->
        <div class="share-url-container">
          <input
            ref="urlInput"
            :value="url"
            type="text"
            class="form-control"
            readonly
            @focus="$event.target.select()"
          >
          <button
            class="btn btn-primary"
            :class="{ 'btn-success': urlCopied }"
            @click="copyUrl"
          >
            <i
              class="fa-solid"
              :class="urlCopied ? 'fa-check' : 'fa-copy'"
            />
            {{ urlCopied ? 'Copied!' : 'Copy' }}
          </button>
        </div>

        <!-- State Info -->
        <div class="share-state-info">
          <small class="text-muted">
            <i class="fa-solid fa-info-circle" />
            This URL contains your current query
            <span v-if="hiddenCount > 0">
              and {{ hiddenCount }} hidden elements
            </span>.
          </small>
        </div>
      </div>

      <div class="share-modal-footer">
        <button
          class="btn btn-secondary"
          @click="$emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "ShareModal",
  props: {
    visible: {
      type: Boolean,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    urlLength: {
      type: Number,
      required: true,
    },
    urlTooLarge: {
      type: Boolean,
      required: true,
    },
    hiddenCount: {
      type: Number,
      required: true,
    },
  },
  emits: ['close'],
  data: () => ({
    urlCopied: false,
  }),
  watch: {
    visible(newVal) {
      if (newVal) {
        // Reset copied state when modal opens
        this.urlCopied = false;
        // Auto-select URL after modal renders
        this.$nextTick(() => {
          if (this.$refs.urlInput) {
            this.$refs.urlInput.select();
          }
        });
      }
    }
  },
  methods: {
    async copyUrl() {
      try {
        await navigator.clipboard.writeText(this.url);
        this.urlCopied = true;

        // Reset copied state after 2 seconds
        setTimeout(() => {
          this.urlCopied = false;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy URL:', error);
        // Fallback: select the text so user can manually copy
        if (this.$refs.urlInput) {
          this.$refs.urlInput.select();
        }
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.share-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 1rem;

  .share-modal-content {
    background-color: var(--bs-body-bg);
    border-radius: 0.5rem;
    box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.3);
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow: auto;
    animation: modalSlideIn 0.2s ease-out;
  }

  @keyframes modalSlideIn {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .share-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem;
    border-bottom: 1px solid var(--bs-border-color);

    h5 {
      margin: 0;
      font-size: 1.25rem;
      color: var(--bs-body-text);
    }

    .btn-close {
      background: none;
      border: none;
      color: var(--bs-body-text-secondary);
      cursor: pointer;
      padding: 0.25rem;
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
        font-size: 1.25rem;
      }
    }
  }

  .share-modal-body {
    padding: 1.25rem;

    .share-modal-description {
      color: var(--bs-body-text-secondary);
      margin-bottom: 1rem;
      font-size: 0.95rem;
    }

    .alert {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.75rem;
      border-radius: 0.375rem;
      margin-bottom: 1rem;
      background-color: rgba(255, 193, 7, 0.1);
      border: 1px solid rgba(255, 193, 7, 0.3);
      color: var(--bs-body-text);

      i {
        color: #ffc107;
        font-size: 1rem;
        margin-top: 0.125rem;
      }
    }

    .share-url-container {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;

      input {
        flex: 1;
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 0.85rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--bs-border-color);
        border-radius: 0.375rem;
        background-color: var(--bs-body-bg-secondary);
        color: var(--bs-body-text);

        &:focus {
          outline: none;
          border-color: var(--bs-primary);
          box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.25);
        }
      }

      button {
        white-space: nowrap;
        transition: all 0.2s;

        &.btn-success {
          background-color: #28a745;
          border-color: #28a745;
        }

        i {
          margin-right: 0.375rem;
        }
      }
    }

    .share-state-info {
      padding: 0.75rem;
      background-color: var(--bs-body-bg-secondary);
      border-radius: 0.375rem;
      border: 1px solid var(--bs-border-color);

      small {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;

        i {
          color: var(--bs-body-bg-accent);
          margin-top: 0.125rem;
        }
      }
    }
  }

  .share-modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--bs-border-color);
  }
}
</style>
