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
          Copy this code to share your investigation. Paste it into the Import Investigation dialog to restore.
        </p>

        <div class="share-code-container">
          <textarea
            ref="codeInput"
            :value="exportCode"
            class="form-control"
            readonly
            rows="4"
            @focus="$event.target.select()"
          />
          <button
            class="btn btn-primary"
            :class="{ 'btn-success': codeCopied }"
            @click="copyCode"
          >
            <i
              class="fa-solid"
              :class="codeCopied ? 'fa-check' : 'fa-copy'"
            />
            {{ codeCopied ? 'Copied!' : 'Copy Code' }}
          </button>
        </div>

        <div class="share-state-info">
          <small class="text-muted">
            <i class="fa-solid fa-info-circle" />
            {{ exportCodeLength }} characters
            <span v-if="hiddenCount > 0">
              | {{ hiddenCount }} hidden elements
            </span>
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
    exportCode: {
      type: String,
      required: true,
    },
    exportCodeLength: {
      type: Number,
      required: true,
    },
    hiddenCount: {
      type: Number,
      required: true,
    },
  },
  emits: ['close'],
  data: () => ({
    codeCopied: false,
  }),
  watch: {
    visible(newVal) {
      if (newVal) {
        this.codeCopied = false;
        this.$nextTick(() => {
          if (this.$refs.codeInput) {
            this.$refs.codeInput.select();
          }
        });
      }
    }
  },
  methods: {
    async copyCode() {
      try {
        await navigator.clipboard.writeText(this.exportCode);
        this.codeCopied = true;
        setTimeout(() => {
          this.codeCopied = false;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy code:', error);
        if (this.$refs.codeInput) {
          this.$refs.codeInput.select();
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
    max-width: 550px;
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

    .share-code-container {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1rem;

      textarea {
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 0.8rem;
        padding: 0.75rem;
        border: 1px solid var(--bs-border-color);
        border-radius: 0.375rem;
        background-color: var(--bs-body-bg-secondary);
        color: var(--bs-body-text);
        resize: none;
        word-break: break-all;

        &:focus {
          outline: none;
          border-color: var(--bs-primary);
          box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.25);
        }
      }

      button {
        align-self: flex-start;
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
      padding: 0.5rem 0.75rem;
      background-color: var(--bs-body-bg-secondary);
      border-radius: 0.375rem;
      border: 1px solid var(--bs-border-color);

      small {
        display: flex;
        align-items: center;
        gap: 0.5rem;

        i {
          color: var(--bs-body-bg-accent);
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
