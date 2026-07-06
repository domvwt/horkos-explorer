<template>
  <div
    v-if="pk"
    class="entity-pin"
  >
    <div class="entity-pin__header">
      <h6>Notebook</h6>
    </div>

    <div class="entity-pin__note">
      <label class="entity-pin__note-label">Note</label>
      <textarea
        v-model="draftNote"
        class="form-control form-control-sm entity-pin__note-input"
        rows="3"
        placeholder="Add a note about this entity…"
        @blur="commitNote"
      />
      <small
        v-if="dirty"
        class="entity-pin__note-hint"
      >Unsaved — click away to save</small>
    </div>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useNotebookStore } from "../../store/NotebookStore";
import { useSettingsStore } from "../../store/SettingsStore";

/**
 * Pin/unpin + per-entity note affordance for the selected graph node.
 *
 * Self-contained like ExternalLinksPanel: it receives the clicked entity's
 * type + beautified properties, derives the cluster id (primary key) from
 * them, and reads/writes the client-side NotebookStore's active notebook. No
 * network calls — everything persists to localStorage via the store.
 */
export default {
  name: "EntityPinPanel",
  props: {
    entityType: {
      type: String,
      required: true,
    },
    properties: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      // Local draft so typing doesn't thrash localStorage on every keystroke;
      // committed to the store on blur.
      draftNote: "",
      // The entity the current draftNote belongs to, so we can flush a pending
      // draft to the right entity if the selection changes before blur fires.
      draftEntity: { entityType: null, pk: null },
    };
  },
  computed: {
    ...mapStores(useNotebookStore, useSettingsStore),
    // The cluster id is the primary key; fall back to the "id" property.
    pk() {
      const pkProp = this.properties.find((p) => p.isPrimaryKey);
      if (pkProp && pkProp.value != null) return String(pkProp.value);
      const idProp = this.properties.find((p) => p.name === "id");
      return idProp && idProp.value != null ? String(idProp.value) : null;
    },
    // Resolve a human-readable caption through the same per-entity-type mapping
    // ResultGraph.entityDisplayName uses: settingsForLabel(type).label names the
    // property to caption on (Address -> "full", Person/Company -> "name", else
    // the pk's property). Fall back to the raw pk for an unknown/virtual type or
    // a missing/NULL caption property.
    displayName() {
      const labelProp = this.settingsStore.settingsForLabel(this.entityType)?.label;
      if (labelProp) {
        const named = this.properties.find((p) => p.name === labelProp);
        if (named && named.value != null && named.value !== "NULL") {
          return String(named.value);
        }
      }
      return this.pk;
    },
    savedNote() {
      return this.notebookStore.noteFor(this.entityType, this.pk);
    },
    dirty() {
      return this.draftNote.trim() !== this.savedNote;
    },
  },
  watch: {
    // Reload the draft whenever the selected entity changes (pk drives it).
    // Flush any pending edit to the OUTGOING entity first, so switching
    // selection without blurring the textarea doesn't silently drop a note.
    pk: {
      immediate: true,
      handler() {
        this.flushDraft();
        this.draftNote = this.savedNote;
        this.draftEntity = { entityType: this.entityType, pk: this.pk };
      },
    },
  },
  // Blur doesn't fire when the panel is removed programmatically (e.g. a new
  // query result clears the selection), so flush any pending draft here too.
  beforeUnmount() {
    this.flushDraft();
  },
  methods: {
    // Commit the current draft to the entity it was typed against.
    flushDraft() {
      const { entityType, pk } = this.draftEntity;
      if (!pk) return;
      const saved = this.notebookStore.noteFor(entityType, pk);
      if (this.draftNote.trim() === saved) return;
      this.notebookStore.setNote(entityType, pk, this.draftNote, this.displayName);
    },
    commitNote() {
      if (!this.pk) return;
      if (this.draftNote.trim() === this.savedNote) return;
      this.notebookStore.setNote(this.entityType, this.pk, this.draftNote, this.displayName);
    },
  },
};
</script>

<style lang="scss" scoped>
.entity-pin {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bs-body-inactive);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;

    h6 {
      font-size: 0.9rem;
      font-weight: 600;
      margin: 0;
      color: var(--bs-body-text);
    }

    i {
      margin-right: 0.25rem;
    }
  }

  &__note-label {
    display: block;
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--bs-body-text-secondary);
  }

  &__note-input {
    resize: vertical;
    background-color: var(--bs-body-bg);
    color: var(--bs-body-text);
  }

  &__note-hint {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--bs-body-text-secondary);
    font-style: italic;
  }
}
</style>
