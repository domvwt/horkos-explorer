<template>
  <div class="investigation-panel">
    <div class="investigation-panel__header">
      <h6>
        <i class="fa-solid fa-folder-open" />
        Investigation Log
      </h6>
    </div>

    <!-- Pinned entities -->
    <div class="investigation-panel__section">
      <div class="investigation-panel__section-title">
        Pinned entities
        <span class="badge">{{ investigationStore.pinnedCount }}</span>
      </div>
      <p
        v-if="investigationStore.pinnedCount === 0"
        class="investigation-panel__empty"
      >
        No pinned entities. Select a node and click <strong>Pin</strong> to add it.
      </p>
      <ul
        v-else
        class="investigation-panel__list"
      >
        <li
          v-for="pin in investigationStore.pinnedEntities"
          :key="pin.key"
          class="investigation-panel__pin"
        >
          <button
            class="investigation-panel__pin-name"
            :title="`Select ${pin.name || pin.pk}`"
            @click="$emit('select-entity', { label: pin.label, pk: pin.pk })"
          >
            <span class="investigation-panel__pin-type">{{ pin.label }}</span>
            {{ pin.name || pin.pk }}
          </button>
          <button
            class="investigation-panel__icon-btn"
            title="Unpin"
            @click="investigationStore.unpin(pin.label, pin.pk)"
          >
            <i class="fa-solid fa-xmark" />
          </button>
        </li>
      </ul>
    </div>

    <!-- Saved graph views -->
    <div class="investigation-panel__section">
      <div class="investigation-panel__section-title">
        Saved views
        <span class="badge">{{ investigationStore.savedViewCount }}</span>
      </div>
      <div class="investigation-panel__save-row">
        <input
          v-model="newViewName"
          type="text"
          class="form-control form-control-sm"
          placeholder="Name this view…"
          @keyup.enter="saveView"
        >
        <button
          class="btn btn-sm btn-outline-primary"
          :disabled="!newViewName.trim()"
          title="Save the current canvas as a named view"
          @click="saveView"
        >
          <i class="fa-solid fa-floppy-disk" />
          Save
        </button>
      </div>
      <p
        v-if="investigationStore.savedViewCount === 0"
        class="investigation-panel__empty"
      >
        No saved views. Arrange the graph, name it above, and save.
      </p>
      <ul
        v-else
        class="investigation-panel__list"
      >
        <li
          v-for="view in investigationStore.savedViews"
          :key="view.id"
          class="investigation-panel__pin"
        >
          <button
            class="investigation-panel__pin-name"
            :title="`Restore ${view.name}`"
            @click="$emit('restore-view', view)"
          >
            <i class="fa-solid fa-diagram-project" />
            {{ view.name }}
          </button>
          <button
            class="investigation-panel__icon-btn"
            title="Delete this view"
            @click="investigationStore.removeView(view.id)"
          >
            <i class="fa-solid fa-xmark" />
          </button>
        </li>
      </ul>
    </div>

    <!-- Export / import -->
    <div class="investigation-panel__section">
      <div class="investigation-panel__section-title">
        Backup
      </div>
      <div class="investigation-panel__backup-row">
        <button
          class="btn btn-sm btn-outline-secondary"
          title="Download your investigation log as a JSON file"
          @click="exportLog"
        >
          <i class="fa-solid fa-file-export" />
          Export
        </button>
        <button
          class="btn btn-sm btn-outline-secondary"
          title="Import an investigation log from a JSON file (replaces the current log)"
          @click="triggerImport"
        >
          <i class="fa-solid fa-file-import" />
          Import
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          class="investigation-panel__file-input"
          @change="handleFileSelected"
        >
      </div>
      <p class="investigation-panel__notice">
        <i class="fa-solid fa-triangle-exclamation" />
        Exported files may contain notes about identifiable people and are your
        responsibility. Nothing is sent to the server — the log stays in this browser.
      </p>
      <p
        v-if="importMessage"
        class="investigation-panel__import-msg"
        :class="importOk ? 'is-ok' : 'is-error'"
      >
        {{ importMessage }}
      </p>
    </div>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useInvestigationStore } from "../../store/InvestigationStore";

/**
 * The investigation log panel: lists pinned entities and saved graph views,
 * and provides JSON export/import. Pin/note capture lives on the per-entity
 * EntityPinPanel; this panel is the log's home and its local backup surface.
 *
 * Saving/restoring a graph view needs the live G6 canvas, which this panel
 * doesn't own, so it emits "restore-view" up to ResultGraph and asks the
 * parent (via the request-save-view event) for the current canvas state.
 * Export/import act directly on the store — no network calls.
 */
export default {
  name: "InvestigationPanel",
  emits: ["select-entity", "restore-view", "request-save-view"],
  data() {
    return {
      newViewName: "",
      importMessage: "",
      importOk: false,
    };
  },
  computed: {
    ...mapStores(useInvestigationStore),
  },
  methods: {
    saveView() {
      const name = this.newViewName.trim();
      if (!name) return;
      // The parent (ResultGraph) captures the canvas state and calls back into
      // the store; we just hand it the chosen name.
      this.$emit("request-save-view", name);
      this.newViewName = "";
    },

    exportLog() {
      const payload = this.investigationStore.exportLog();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `investigation-${this.timestampSlug()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    // A filename-safe local timestamp; avoids ISO colons which some OSes reject.
    timestampSlug() {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      return (
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
      );
    },

    triggerImport() {
      this.importMessage = "";
      this.$refs.fileInput.click();
    },

    handleFileSelected(event) {
      const file = event.target.files && event.target.files[0];
      // Reset the input so selecting the same file again re-triggers change.
      event.target.value = "";
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const result = this.investigationStore.importLog(reader.result);
        this.importOk = result.ok;
        this.importMessage = result.ok
          ? "Investigation log imported."
          : result.error;
      };
      reader.onerror = () => {
        this.importOk = false;
        this.importMessage = "Could not read the selected file.";
      };
      reader.readAsText(file);
    },
  },
};
</script>

<style lang="scss" scoped>
.investigation-panel {
  &__header h6 {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
    color: var(--bs-body-text);

    i {
      margin-right: 0.4rem;
    }
  }

  &__section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--bs-body-inactive);
  }

  &__section-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--bs-body-text-secondary);
    margin-bottom: 0.5rem;

    .badge {
      background-color: var(--bs-body-bg-accent);
      color: #fff !important;
    }
  }

  &__empty {
    font-size: 0.8rem;
    color: var(--bs-body-text-secondary);
    margin: 0;
  }

  &__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  &__pin {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  &__pin-name {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    color: var(--bs-body-text);
    padding: 0.35rem 0.5rem;
    border-radius: 0.375rem;
    font-size: 0.85rem;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      background-color: var(--bs-body-bg-hover);
    }

    i {
      margin-right: 0.35rem;
      opacity: 0.7;
    }
  }

  &__pin-type {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.6;
    margin-right: 0.35rem;
  }

  &__icon-btn {
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    cursor: pointer;
    padding: 0.25rem 0.4rem;
    border-radius: 0.375rem;

    &:hover {
      background-color: var(--bs-body-bg-hover);
      color: var(--bs-body-text);
    }
  }

  &__save-row,
  &__backup-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  &__file-input {
    display: none;
  }

  &__notice {
    font-size: 0.75rem;
    color: var(--bs-body-text-secondary);
    margin: 0.5rem 0 0;
    line-height: 1.35;

    i {
      margin-right: 0.35rem;
      color: var(--bs-warning, #d5b441);
    }
  }

  &__import-msg {
    font-size: 0.8rem;
    margin: 0.5rem 0 0;

    &.is-ok {
      color: var(--bs-success, #59a14f);
    }

    &.is-error {
      color: var(--bs-danger, #e15759);
    }
  }
}
</style>
