<template>
  <div class="node-search__wrapper">
    <div class="node-search__form" @keydown.enter.prevent="executeSearch">
      <!-- Name Filter and Entity Type -->
      <div class="row g-2 mb-2">
        <div class="col-6">
          <label class="form-label-sm">{{ nameFieldLabel }}</label>
          <input
            v-model="filters.name"
            type="text"
            class="form-control form-control-sm"
            :placeholder="nameFieldPlaceholder"
          >
        </div>
        <div class="col-6">
          <label class="form-label-sm">Entity Type</label>
          <select v-model="selectedType" class="form-select form-select-sm">
            <option value="Person">Person</option>
            <option value="Company">Company</option>
            <option value="Address">Address</option>
          </select>
        </div>
      </div>

      <!-- Company-Specific Filters -->
      <div v-if="selectedType === 'Company'" class="row g-2 mb-2">
        <div class="col-6">
          <label class="form-label-sm">Company Number</label>
          <input
            v-model="filters.companyNumber"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g., 12345678"
          >
        </div>
        <div class="col-6">
          <label class="form-label-sm">Jurisdiction</label>
          <select v-model="filters.jurisdiction" class="form-select form-select-sm">
            <option value="">Any</option>
            <option value="GB">United Kingdom (GB)</option>
            <option value="CYM">Cayman Islands (CYM)</option>
            <option value="JEY">Jersey (JEY)</option>
            <option value="GGY">Guernsey (GGY)</option>
            <option value="BMU">Bermuda (BMU)</option>
            <option value="VGB">British Virgin Islands (VGB)</option>
          </select>
        </div>
      </div>

      <!-- Address-Specific Filters -->
      <div v-if="selectedType === 'Address'" class="row g-2 mb-2">
        <div class="col-6">
          <label class="form-label-sm">Post Code</label>
          <input
            v-model="filters.postCode"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g., SW1A"
          >
        </div>
        <div class="col-6">
          <label class="form-label-sm">City</label>
          <input
            v-model="filters.city"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g., London"
          >
        </div>
      </div>

      <!-- Search Row: Limit and Button -->
      <div class="row g-2 mb-2">
        <div class="col-6">
          <label class="form-label-sm">Limit</label>
          <select v-model="resultLimit" class="form-select form-select-sm">
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="500">500</option>
          </select>
        </div>
        <div class="col-6">
          <label class="form-label-sm">&nbsp;</label>
          <button
            class="btn btn-primary btn-sm w-100"
            :disabled="!hasFilters"
            @click="executeSearch"
          >
            <i class="fa-solid fa-search me-1" />
            Search
          </button>
        </div>
      </div>

      <!-- Generated Query Display (Expandable) -->
      <div v-if="generatedQuery" class="generated-query-section">
        <div class="d-flex justify-content-between align-items-center">
          <button
            class="btn btn-link btn-sm p-0 text-decoration-none query-toggle"
            @click="showQuery = !showQuery"
          >
            <i :class="showQuery ? 'fa-chevron-down' : 'fa-chevron-right'" class="fa-solid me-1" />
            <span class="query-label">Show Generated Query</span>
          </button>
          <button
            v-if="showQuery"
            class="btn btn-sm btn-outline-secondary py-0"
            @click="copyQuery"
          >
            <i class="fa-solid fa-copy" />
          </button>
        </div>
        <div v-if="showQuery" class="generated-query mt-1">
          <code>{{ generatedQuery }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "NodeSearch",
  emits: ["executeQuery"],
  data() {
    return {
      selectedType: "Person",
      filters: {
        name: "",
        companyNumber: "",
        jurisdiction: "",
        postCode: "",
        city: "",
      },
      resultLimit: "25",
      generatedQuery: "",
      showQuery: false,
    };
  },
  computed: {
    hasFilters() {
      return Object.values(this.filters).some((v) => v !== "");
    },
    nameFieldLabel() {
      if (this.selectedType === 'Address') {
        return 'Address';
      }
      return 'Name';
    },
    nameFieldPlaceholder() {
      if (this.selectedType === 'Address') {
        return 'Search by address...';
      }
      return 'Search by name...';
    },
  },
  mounted() {
    // Delay loading from URL to ensure schema is ready
    this.$nextTick(() => {
      // Wait for schema to load before auto-executing URL searches
      setTimeout(() => {
        this.loadFromUrl();
      }, 500);
    });
  },
  methods: {
    loadFromUrl() {
      const params = new URLSearchParams(window.location.search);

      // Check if we have search parameters
      const type = params.get('type');
      if (!type) return;

      // Restore entity type
      this.selectedType = type;

      // Restore filters
      const name = params.get('name');
      const companyNumber = params.get('companyNumber');
      const jurisdiction = params.get('jurisdiction');
      const postCode = params.get('postCode');
      const city = params.get('city');
      const limit = params.get('limit');

      if (name) this.filters.name = name;
      if (companyNumber) this.filters.companyNumber = companyNumber;
      if (jurisdiction) this.filters.jurisdiction = jurisdiction;
      if (postCode) this.filters.postCode = postCode;
      if (city) this.filters.city = city;
      if (limit) this.resultLimit = limit;

      // Auto-execute search if we loaded from URL
      if (this.hasFilters) {
        this.$nextTick(() => {
          this.executeSearch();
        });
      }
    },
    updateUrl() {
      const params = new URLSearchParams();

      // Always include entity type
      params.set('type', this.selectedType);

      // Add filters if they have values
      if (this.filters.name) params.set('name', this.filters.name);
      if (this.filters.companyNumber) params.set('companyNumber', this.filters.companyNumber);
      if (this.filters.jurisdiction) params.set('jurisdiction', this.filters.jurisdiction);
      if (this.filters.postCode) params.set('postCode', this.filters.postCode);
      if (this.filters.city) params.set('city', this.filters.city);

      // Add limit if not default
      if (this.resultLimit !== "25") {
        params.set('limit', this.resultLimit);
      }

      // Update URL without page reload
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.pushState({}, '', newUrl);
    },
    resetFilters() {
      this.filters = {
        name: "",
        companyNumber: "",
        jurisdiction: "",
        postCode: "",
        city: "",
      };
      this.generatedQuery = "";
      // Clear URL parameters
      window.history.pushState({}, '', window.location.pathname);
    },
    generateQuery() {
      const type = this.selectedType;
      const conditions = [];
      const params = {};
      let nodeLabel = "";

      if (type === "Person") {
        nodeLabel = ":Person";
        if (this.filters.name) {
          conditions.push(`toLower(n.name) CONTAINS toLower($name)`);
          params.name = this.filters.name;
        }
      } else if (type === "Company") {
        nodeLabel = ":Company";
        if (this.filters.name) {
          conditions.push(`toLower(n.name) CONTAINS toLower($name)`);
          params.name = this.filters.name;
        }
        if (this.filters.companyNumber) {
          conditions.push(`toLower(n.company_number) = toLower($companyNumber)`);
          params.companyNumber = this.filters.companyNumber;
        }
        if (this.filters.jurisdiction) {
          conditions.push(`n.jurisdiction = $jurisdiction`);
          params.jurisdiction = this.filters.jurisdiction;
        }
      } else if (type === "Address") {
        nodeLabel = ":Address";
        if (this.filters.name) {
          conditions.push(`toLower(n.full) CONTAINS toLower($address)`);
          params.address = this.filters.name;
        }
        if (this.filters.postCode) {
          conditions.push(`toLower(n.post_code) CONTAINS toLower($postCode)`);
          params.postCode = this.filters.postCode;
        }
        if (this.filters.city) {
          conditions.push(`toLower(n.city) CONTAINS toLower($city)`);
          params.city = this.filters.city;
        }
      }

      let query = `MATCH (n${nodeLabel})`;
      if (conditions.length > 0) {
        query += `\nWHERE ${conditions.join(' AND\n      ')}`;
      }
      query += `\nRETURN n\nLIMIT ${this.resultLimit}`;

      return { query, params };
    },
    executeSearch() {
      const { query, params } = this.generateQuery();
      this.generatedQuery = query;
      this.updateUrl();
      this.$emit("executeQuery", { query, params });
    },
    copyQuery() {
      navigator.clipboard.writeText(this.generatedQuery);
    },
  },
};
</script>

<style lang="scss" scoped>
.node-search__wrapper {
  padding: 0.5rem 0.75rem;
  height: 100%;
  overflow-y: auto;
}

.node-search__form {
  max-width: 100%;
}

.form-label-sm {
  font-size: 0.75rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  display: block;
}

.generated-query-section {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--bs-border-color);
}

.query-toggle {
  color: var(--bs-body-color);

  &:hover {
    color: var(--bs-primary);
  }
}

.query-label {
  font-size: 0.75rem;
  font-weight: 500;
}

.generated-query {
  padding: 0.5rem;
  background-color: var(--bs-body-bg-secondary);
  border: 1px solid var(--bs-border-color);
  border-radius: 0.25rem;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", "Consolas", "source-code-pro", monospace;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 100px;
  overflow-y: auto;
}

button:disabled {
  cursor: not-allowed;
}
</style>
