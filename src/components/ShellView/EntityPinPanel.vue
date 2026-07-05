<template>
  <div
    v-if="pk"
    class="entity-pin"
  >
    <div class="entity-pin__header">
      <h6>Investigation</h6>
      <button
        class="btn btn-sm"
        :class="pinned ? 'btn-warning' : 'btn-outline-secondary'"
        :title="pinned ? 'Unpin this entity' : 'Pin this entity to your investigation log'"
        @click="togglePin"
      >
        <i
          class="fa-star"
          :class="pinned ? 'fa-solid' : 'fa-regular'"
        />
        {{ pinned ? 'Pinned' : 'Pin' }}
      </button>
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
import { useInvestigationStore } from "../../store/InvestigationStore";

/**
 * Pin/unpin + per-entity note affordance for the selected graph node.
 *
 * Self-contained like ExternalLinksPanel: it receives the clicked entity's
 * type + beautified properties, derives the cluster id (primary key) from
 * them, and reads/writes the client-side InvestigationStore. No network
 * calls — everything persists to localStorage via the store.
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
    ...mapStores(useInvestigationStore),
    // The cluster id is the primary key; fall back to the "id" property.
    pk() {
      const pkProp = this.properties.find((p) => p.isPrimaryKey);
      if (pkProp && pkProp.value != null) return String(pkProp.value);
      const idProp = this.properties.find((p) => p.name === "id");
      return idProp && idProp.value != null ? String(idProp.value) : null;
    },
    displayName() {
      const nameProp =
        this.properties.find((p) => p.name === "name") ||
        this.properties.find((p) => p.name === "full");
      return nameProp && nameProp.value != null ? String(nameProp.value) : this.pk;
    },
    pinned() {
      return this.investigationStore.isPinned(this.entityType, this.pk);
    },
    savedNote() {
      return this.investigationStore.noteFor(this.entityType, this.pk);
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
  methods: {
    togglePin() {
      if (!this.pk) return;
      this.investigationStore.togglePin(this.entityType, this.pk, this.displayName);
    },
    // Commit the current draft to the entity it was typed against.
    flushDraft() {
      const { entityType, pk } = this.draftEntity;
      if (!pk) return;
      const saved = this.investigationStore.noteFor(entityType, pk);
      if (this.draftNote.trim() === saved) return;
      this.investigationStore.setNote(entityType, pk, this.draftNote);
    },
    commitNote() {
      if (!this.pk) return;
      if (this.draftNote.trim() === this.savedNote) return;
      this.investigationStore.setNote(this.entityType, this.pk, this.draftNote);
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
