<template>
  <div class="result-disclaimer">
    <button
      class="result-disclaimer__toggle"
      :aria-expanded="expanded ? 'true' : 'false'"
      @click="expanded = !expanded"
    >
      <i class="fa-solid fa-circle-info" />
      <span class="result-disclaimer__toggle-text">About this result</span>
      <i
        class="fa-solid result-disclaimer__chevron"
        :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'"
      />
    </button>

    <div
      v-show="expanded"
      class="result-disclaimer__body"
    >
      <p>{{ matchWarning }}</p>
      <p v-if="isUnlinkedPscCompany">
        This controller has no linked Companies House record. Controllers that are foreign,
        dissolved, or otherwise unregistered have no live UK record to connect to — a standalone
        node here is expected, not a missing link.
      </p>
      <p>
        Control type and ownership band shown are <strong>our interpretation</strong> of the
        register's nature-of-control text and may be misread — check the underlying filing.
      </p>
      <p>
        This reflects the source register at our last refresh, so it may be out of date;
        corrections are made at Companies House.
      </p>
      <a
        class="result-disclaimer__more"
        href="#privacy"
      >About our sources &amp; accuracy</a>
    </div>
  </div>
</template>

<script>
export default {
  name: "ResultDisclaimer",
  props: {
    // The clicked entity's label — 'Person' | 'Company' | 'Address'.
    entityType: {
      type: String,
      default: "",
    },
    // True when the entity is a PSC-only corporate controller (a Company with no
    // linked Companies House record) — adds a neutral data-quality caveat.
    isUnlinkedPscCompany: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      expanded: false,
    };
  },
  computed: {
    // The name-collision warning is sharpest for people (many share a name), but
    // the same automated-matching caveat applies to companies and addresses too.
    matchWarning() {
      switch (this.entityType) {
        case "Person":
          return (
            "People are grouped by automated matching, and many share the same or similar " +
            "names — this may not be the person you're looking for. Confirm identity against " +
            "the source filing before relying on it."
          );
        case "Company":
          return (
            "Companies and their connections are grouped by automated matching, which can be " +
            "wrong. Confirm against the source filing before relying on it."
          );
        case "Address":
          return (
            "Addresses are grouped by automated matching, which can be wrong — similar addresses " +
            "may be merged or split. Confirm against the source filing before relying on it."
          );
        default:
          return (
            "Entities are grouped by automated matching, which can be wrong. Confirm against the " +
            "source filing before relying on it."
          );
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.result-disclaimer {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bs-body-inactive);

  &__toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    color: var(--bs-body-text-secondary);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      color: var(--bs-body-text);
    }
  }

  &__toggle-text {
    flex: 1;
    text-align: left;
  }

  &__chevron {
    font-size: 0.7rem;
  }

  &__body {
    margin-top: 0.5rem;

    p {
      margin-bottom: 0.5rem;
      font-size: 0.8rem;
      line-height: 1.4;
      color: var(--bs-body-text-secondary);
    }
  }

  &__more {
    font-size: 0.8rem;
    font-weight: 500;
  }
}
</style>
