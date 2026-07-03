<template>
  <div
    class="confidence-indicator"
    :style="{ '--chip-color': state.color }"
  >
    <button
      class="confidence-chip"
      :class="{ 'confidence-chip--quiet': !band }"
      :aria-expanded="expanded ? 'true' : 'false'"
      :title="state.summary"
      @click="expanded = !expanded"
    >
      <span class="confidence-chip__dot" />
      <span class="confidence-chip__text">Confidence: {{ state.label }}</span>
      <i
        class="fa-solid confidence-chip__chevron"
        :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'"
      />
    </button>

    <div
      v-show="expanded"
      class="confidence-indicator__details"
    >
      <p class="confidence-indicator__summary">
        {{ state.summary }}
      </p>

      <ul
        v-if="concerns.length > 0"
        class="confidence-indicator__concerns"
      >
        <li
          v-for="(concern, index) in concerns"
          :key="index"
        >
          {{ concern }}
        </li>
      </ul>

      <p class="confidence-indicator__nudge">
        Always confirm an identity against the underlying source filing, registered address,
        or other identifiers before relying on it.
      </p>
    </div>
  </div>
</template>

<script>
export default {
  name: "ConfidenceIndicator",
  props: {
    // The clicked entity's beautified properties — an array of { name, value, ... }.
    properties: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      expanded: false,
    };
  },
  computed: {
    // The raw quality_level band written onto the node by the resolver. Kept in
    // clickedProperties (so this panel can read it) but hidden from the raw
    // Properties list; here it becomes the human-facing confidence band.
    band() {
      const prop = this.properties.find(p => p.name === 'quality_level');
      const value = prop ? prop.value : null;
      // Beautified NULLs arrive as the string "NULL"; treat as absent.
      if (value === null || value === undefined || value === '' || value === 'NULL') {
        return null;
      }
      return String(value).toUpperCase();
    },
    // One of five explicit display states. An unrecognised band is treated as
    // unknown rather than silently implying HIGH.
    state() {
      switch (this.band) {
        case 'SINGLETON':
          return {
            // Neutral colour — a single record is not a merge, so no merge-quality claim.
            label: 'Single source record',
            color: '#6c757d',
            summary: 'Built from a single source record — not merged.',
          };
        case 'HIGH':
          return {
            label: 'High',
            color: '#28a745',
            summary: 'The records merged into this entity are a strong, consistent match.',
          };
        case 'MEDIUM':
          return {
            label: 'Medium',
            color: '#ffc107',
            summary: 'The records merged into this entity are a reasonable but imperfect match.',
          };
        case 'LOW':
          return {
            label: 'Low',
            color: '#dc3545',
            summary: 'The records merged into this entity are a weak match — treat with caution.',
          };
        default:
          // NULL / absent / unrecognised — never implied-HIGH, never hidden.
          return {
            label: 'Unavailable',
            color: '#6c757d',
            summary: 'Confidence indicator unavailable for this entity.',
          };
      }
    },
    // The quality_concerns behind a HIGH/MEDIUM/LOW band, rendered as the "why".
    // Stored as a STRING column; parse defensively (JSON first, then the
    // bracket-strip-split fallback used by SourceProvenancePanel).
    concerns() {
      const prop = this.properties.find(p => p.name === 'quality_concerns');
      const value = prop ? prop.value : null;
      if (value === null || value === undefined || value === '' || value === 'NULL') {
        return [];
      }
      if (Array.isArray(value)) {
        return value.map(c => String(c).trim()).filter(c => c);
      }
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            return parsed.map(c => String(c).trim()).filter(c => c);
          }
        } catch (e) {
          // Not JSON — fall through to the bracket-strip-split fallback.
        }
        const cleaned = value.replace(/[[\]'"]/g, '');
        return cleaned.split(',').map(c => c.trim()).filter(c => c);
      }
      return [];
    },
  },
};
</script>

<style lang="scss" scoped>
.confidence-indicator {
  margin-top: 0.5rem;

  .confidence-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0.6rem;
    background: none;
    border: 1px solid var(--bs-body-inactive);
    border-radius: 1rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--bs-body-text);
    cursor: pointer;

    &:hover {
      border-color: var(--chip-color);
    }

    &__dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background-color: var(--chip-color);
      flex-shrink: 0;
    }

    &__chevron {
      font-size: 0.6rem;
      color: var(--bs-body-text-secondary);
    }

    // Absent band — keep it visible (never implied-HIGH) but quiet.
    &--quiet {
      color: var(--bs-body-text-secondary);
      font-weight: 400;

      .confidence-chip__dot {
        opacity: 0.5;
      }
    }
  }

  &__details {
    margin-top: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--chip-color, var(--bs-body-inactive));
    background-color: var(--bs-body-bg);
    border-radius: 0 0.375rem 0.375rem 0;
  }

  &__summary {
    margin-bottom: 0.5rem;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--bs-body-text);
  }

  &__concerns {
    margin: 0 0 0.5rem;
    padding-left: 1.1rem;

    li {
      font-size: 0.8rem;
      line-height: 1.4;
      color: var(--bs-body-text-secondary);
    }
  }

  &__nudge {
    margin-bottom: 0;
    font-size: 0.8rem;
    line-height: 1.4;
    font-weight: 600;
    color: var(--bs-body-text-secondary);
  }
}
</style>
