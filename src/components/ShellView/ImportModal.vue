<template>
  <div
    v-if="visible"
    class="import-modal"
    @click.self="$emit('close')"
  >
    <div class="import-modal-content">
      <div class="import-modal-header">
        <h5>Open a shared view</h5>
        <button
          class="btn-close"
          @click="$emit('close')"
        >
          <i class="fa-solid fa-times" />
        </button>
      </div>

      <div class="import-modal-body">
        <p class="import-modal-description">
          Paste a share code to open a shared view, or save it to this notebook
          for later.
        </p>

        <div class="import-code-container">
          <textarea
            ref="codeInput"
            v-model="importCode"
            class="form-control"
            rows="5"
            placeholder="Paste share code here (HKS1:...:Z)"
            @paste="handlePaste"
          />
        </div>

        <!-- Error message -->
        <div
          v-if="errorMessage"
          class="alert alert-danger"
        >
          <i class="fa-solid fa-circle-exclamation" />
          {{ errorMessage }}
        </div>

        <!-- Info hint -->
        <div class="import-hint">
          <small class="text-muted">
            <i class="fa-solid fa-info-circle" />
            Get a share code from the Share action on any saved view, then copy the code.
          </small>
        </div>
      </div>

      <div class="import-modal-footer">
        <button
          class="btn btn-secondary"
          @click="$emit('close')"
        >
          Cancel
        </button>
        <button
          class="btn btn-outline-primary"
          :disabled="!importCode.trim() || isImporting"
          @click="saveToNotebook"
        >
          <i class="fa-solid fa-floppy-disk" />
          Save to notebook
        </button>
        <button
          class="btn btn-primary"
          :disabled="!importCode.trim() || isImporting"
          @click="openSharedView"
        >
          <span v-if="isImporting">
            <i class="fa-solid fa-spinner fa-spin" />
            Opening…
          </span>
          <span v-else>
            <i class="fa-solid fa-diagram-project" />
            Open now
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { validateImportCode } from "@/utils/NotebookSidebarLogic";

// Maps a validateImportCode() failure reason to the message shown under the
// textarea. Kept out of the (pure, framework-free) logic module so copy lives
// with the component.
const ERROR_MESSAGES = {
  empty: 'Please paste a share code.',
  truncated: 'The share code looks truncated. Make sure you copied the whole code.',
  invalid: 'Invalid share code. Make sure it starts with "HKS1:" and ends with ":Z".',
  'no-data': 'This share code contains no graph data.',
};

export default {
  name: "ImportModal",
  props: {
    visible: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['close', 'open', 'save'],
  data: () => ({
    importCode: '',
    errorMessage: '',
    isImporting: false,
  }),
  watch: {
    visible(newVal) {
      if (newVal) {
        // Reset state when modal opens
        this.importCode = '';
        this.errorMessage = '';
        this.isImporting = false;
        // Focus the textarea
        this.$nextTick(() => {
          if (this.$refs.codeInput) {
            this.$refs.codeInput.focus();
          }
        });
      }
    }
  },
  methods: {
    handlePaste(event) {
      // Clear error on paste
      this.errorMessage = '';

      // Get pasted text from clipboard
      const pastedText = (event.clipboardData || window.clipboardData).getData('text');
      if (!pastedText) return;

      const code = pastedText.trim();

      // A complete, valid code auto-opens on paste (the primary action), matching
      // the previous one-step behaviour.
      if (code.startsWith('HKS1:') && code.endsWith(':Z')) {
        const result = validateImportCode(code);
        if (result.ok) {
          event.preventDefault();
          this.importCode = code;
          this.$nextTick(() => {
            this.openSharedView();
          });
        }
      }
    },
    // Shared validation for both footer actions. On failure it surfaces the
    // message and returns null; on success it returns { code, state }.
    validate() {
      this.errorMessage = '';
      const result = validateImportCode(this.importCode);
      if (!result.ok) {
        this.errorMessage = ERROR_MESSAGES[result.reason] || ERROR_MESSAGES.invalid;
        return null;
      }
      return result;
    },
    // "Open now": restore the shared view into the active cell (existing flow).
    openSharedView() {
      const result = this.validate();
      if (!result) return;

      this.isImporting = true;

      // Emit the parsed state to the parent to restore into the active cell.
      this.$emit('open', result.state);

      // Close modal after a brief delay
      setTimeout(() => {
        this.isImporting = false;
        this.$emit('close');
      }, 500);
    },
    // "Save to notebook": file the code as a saved view WITHOUT opening it.
    // Emits the raw wire code (a saved view stores it verbatim); the sidebar
    // persists it into the active notebook.
    saveToNotebook() {
      const result = this.validate();
      if (!result) return;

      this.$emit('save', result.code);
      this.$emit('close');
    },
  },
};
</script>

<style lang="scss" scoped>
.import-modal {
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

  .import-modal-content {
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

  .import-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem;
    border-bottom: 1px solid var(--bs-body-inactive);

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

  .import-modal-body {
    padding: 1.25rem;

    .import-modal-description {
      color: var(--bs-body-text-secondary);
      margin-bottom: 1rem;
      font-size: 0.875rem;
    }

    .import-code-container {
      margin-bottom: 1rem;

      textarea {
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 0.8rem;
        padding: 0.75rem;
        border: 1px solid var(--bs-body-inactive);
        border-radius: 0.375rem;
        background-color: var(--bs-body-bg-secondary);
        color: var(--bs-body-text);
        resize: vertical;
        word-break: break-all;

        &:focus {
          outline: none;
          border-color: var(--bs-primary);
          box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.25);
        }

        &::placeholder {
          color: var(--bs-body-text-secondary);
          opacity: 0.7;
        }
      }
    }

    .alert {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.75rem;
      border-radius: 0.375rem;
      margin-bottom: 1rem;

      &.alert-danger {
        background-color: rgba(220, 53, 69, 0.1);
        border: 1px solid rgba(220, 53, 69, 0.3);
        color: var(--bs-body-text);

        i {
          color: #dc3545;
          font-size: 1rem;
          margin-top: 0.125rem;
        }
      }
    }

    .import-hint {
      padding: 0.75rem;
      background-color: var(--bs-body-bg-secondary);
      border-radius: 0.375rem;
      border: 1px solid var(--bs-body-inactive);

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

  .import-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1.25rem;
    border-top: 1px solid var(--bs-body-inactive);

    button i {
      margin-right: 0.375rem;
    }
  }
}
</style>
