<template>
  <div
    v-if="sourceRecords.length > 0"
    class="source-provenance"
    :class="{ 'source-provenance--embedded': embedded }"
  >
    <h6 v-if="!embedded">
      Data Sources
    </h6>
    <div class="source-badges">
      <span
        v-for="source in sourceRecords"
        :key="source.id"
        class="badge source-badge"
        :style="{
          '--badge-bg-color': source.color,
        }"
        :title="source.count ? `${source.count} source record${source.count === 1 ? '' : 's'} from ${source.label}` : source.label"
      >
        {{ source.label }}<span
          v-if="source.count"
          class="source-badge__count"
        > · {{ source.count }}</span>
      </span>
    </div>
  </div>
</template>

<script>
// A list-valued property may arrive as an actual array or as a string
// representation like "['psc', 'companies_house']".
function parseArrayValue(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value !== 'NULL') {
    const cleaned = value.replace(/[\[\]'"]/g, '');
    return cleaned.split(',').map(s => s.trim()).filter(s => s);
  }
  return [];
}

export default {
  name: "SourceProvenancePanel",
  props: {
    properties: {
      type: Array,
      required: true,
    },
    // Render badges only, without the section chrome, for embedding
    // inside a host section (e.g. "Sources & Matching").
    embedded: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    sourceRecords() {
      if (!this.properties) {
        return [];
      }

      // Find source_systems property
      const sourceProp = this.properties.find(p => p.name === 'source_systems');
      if (!sourceProp || !sourceProp.value) {
        return [];
      }

      const sources = parseArrayValue(sourceProp.value);

      // Count records per system from the source_records ids, which are
      // prefixed "system:..." — note the prefix spells systems with hyphens
      // ("companies-house") where source_systems uses underscores.
      const recordsProp = this.properties.find(p => p.name === 'source_records');
      const recordCounts = {};
      parseArrayValue(recordsProp && recordsProp.value).forEach(record => {
        const system = String(record).split(':')[0].replace(/-/g, '_');
        recordCounts[system] = (recordCounts[system] || 0) + 1;
      });

      // Map source system names to display names
      const sourceMap = {};
      sources.forEach(source => {
        let sourceType = 'Unknown';

        switch (source) {
          case 'companies_house':
            sourceType = 'Companies House';
            break;
          case 'psc':
            sourceType = 'PSC Register';
            break;
          case 'icij':
            sourceType = 'ICIJ Offshore Leaks';
            break;
          default:
            sourceType = source; // Show the raw value if unknown
        }

        if (!sourceMap[sourceType]) {
          sourceMap[sourceType] = 0;
        }
        sourceMap[sourceType] += recordCounts[source] || 0;
      });

      // Convert to array with badge colors
      const sourceBadges = Object.entries(sourceMap).map(([type, count]) => {
        let color = '#6c757d'; // Gray for unknown
        let order = 999; // Default order for unknown sources

        if (type === 'Companies House') {
          color = '#28a745'; // Green
          order = 1;
        } else if (type === 'PSC Register') {
          color = '#17a2b8'; // Blue
          order = 2;
        } else if (type === 'ICIJ Offshore Leaks') {
          color = '#ffc107'; // Yellow
          order = 3;
        }

        return {
          id: type,
          label: type,
          color,
          count: count,
          order: order
        };
      });

      // Sort by predefined order
      return sourceBadges.sort((a, b) => a.order - b.order);
    }
  }
};
</script>

<style lang="scss" scoped>
.source-provenance {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bs-body-inactive);

  &--embedded {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }

  h6 {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
    color: var(--bs-body-text);
  }

  .source-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;

    .badge {
      padding: 0.375rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 500;
      border-radius: 0.375rem;
    }

    .source-badge {
      background-color: var(--badge-bg-color) !important;
      color: white !important;
    }

    .source-badge__count {
      font-weight: 400;
      opacity: 0.85;
    }
  }
}
</style>
